// src/routes/cloudAffirms.ts
// All comments in English only.

import { Types } from "mongoose";
import type { Application, Request, Response } from "express";
import { AffirmationModel } from "../models/Affirmation";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";

type RemoteAffirmationMeta = {
  id: string; // clientId from mobile app
  createdAt: number;
  updatedAt?: number;
  note: string;
  hasVideo: boolean;
  hasAudio: boolean;
  imageCount: number;
  remoteImageKeys?: string[];
  remoteVideoKey?: string | null;
  remoteAudioKey?: string | null;
};

/* ---------- S3 client ---------- */
const S3_REGION =
  process.env.AWS_S3_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const S3_BUCKET = process.env.AWS_S3_BUCKET ?? ""; // ⚠️ set in .env

const s3 = new S3Client({ region: S3_REGION });

export function registerCloudAffirmsRoutes(app: Application) {
  // List all cloud affirms for a user
  app.get("/cloud/affirms", async (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string | undefined) || "demo-user";

      const docs = await AffirmationModel.find({
        userId,
        archived: { $ne: true },
      })
        .sort({ createdAt: 1 })
        .lean();

      const metas: RemoteAffirmationMeta[] = docs.map((doc: any) => ({
        id: doc.clientId,
        createdAt: doc.createdAt ? doc.createdAt.getTime() : Date.now(),
        updatedAt: doc.updatedAt ? doc.updatedAt.getTime() : undefined,
        note: doc.text || "",
        hasVideo: !!doc.video,
        hasAudio: !!doc.audio,
        imageCount: doc.images?.length ?? 0,
        remoteImageKeys: (doc.images || []).map((img: any) => img.key),
        remoteVideoKey: doc.video?.key ?? null,
        remoteAudioKey: doc.audio?.key ?? null,
      }));

      console.log(
        "GET /cloud/affirms userId =",
        userId,
        "docs count =",
        docs.length
      );

      return res.json(metas);
    } catch (err) {
      console.error("GET /cloud/affirms error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Upsert cloud affirm metas from mobile
  app.post("/cloud/affirms/save", async (req: Request, res: Response) => {
    try {
      const { userId, items } = req.body as {
        userId?: string;
        items?: RemoteAffirmationMeta[];
      };

      console.log("POST /cloud/affirms/save body =", JSON.stringify(req.body));

      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "No items provided" });
      }

      const ops = items.map((m) => {
        const createdAt = new Date(m.createdAt);
        const updatedAt = new Date(m.updatedAt ?? Date.now());

        return {
          updateOne: {
            filter: { userId, clientId: m.id },
            update: {
              $set: {
                userId,
                clientId: m.id,
                text: m.note ?? "",
                images: (m.remoteImageKeys || []).map((key) => ({ key })),
                audio: m.remoteAudioKey ? { key: m.remoteAudioKey } : undefined,
                video: m.remoteVideoKey ? { key: m.remoteVideoKey } : undefined,
                archived: false,
                updatedAt,
              },
              $setOnInsert: { createdAt },
            },
            upsert: true,
          },
        };
      });

      await AffirmationModel.bulkWrite(ops);

      console.log(
        "POST /cloud/affirms/save upserted",
        items.length,
        "items for userId =",
        userId
      );

      return res.json({ ok: true, count: items.length });
    } catch (err) {
      console.error("POST /cloud/affirms/save error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete a single cloud affirm for a user (used when Pro users delete an item)
  app.post(
    "/cloud/affirms/delete",
    async (req: Request, res: Response): Promise<Response> => {
      try {
        console.log(
          "POST /cloud/affirms/delete body =",
          JSON.stringify(req.body)
        );

        const { userId, clientId, remoteId, ids } = req.body as {
          userId?: string;
          clientId?: string; // local/client id from mobile
          remoteId?: string; // Mongo _id (if mobile knows it)
          ids?: string[]; // optional legacy array
        };

        if (!userId) {
          return res.status(400).json({ error: "Missing userId" });
        }

        // Collect all identifiers into a unique list
        const allIdSet = new Set<string>();
        if (remoteId) allIdSet.add(String(remoteId));
        if (clientId) allIdSet.add(String(clientId));
        if (Array.isArray(ids)) {
          ids.filter(Boolean).forEach((v) => allIdSet.add(String(v)));
        }

        const allIds = Array.from(allIdSet);

        if (allIds.length === 0) {
          return res
            .status(400)
            .json({ error: "Missing clientId / remoteId / ids" });
        }

        let deletedCount = 0;
        const mediaKeySet = new Set<string>();

        // 1) For each id, find the doc (by _id or clientId), collect S3 keys, delete Mongo doc.
        for (const value of allIds) {
          let doc: any | null = null;

          if (Types.ObjectId.isValid(value)) {
            doc = await AffirmationModel.findOne({
              _id: value,
              userId,
            }).lean();
          }

          if (!doc) {
            doc = await AffirmationModel.findOne({
              clientId: value,
              userId,
            }).lean();
          }

          if (!doc) {
            console.log(
              "POST /cloud/affirms/delete no document found for value =",
              value
            );
            continue;
          }

          // Collect S3 keys
          (doc.images || []).forEach((img: any) => {
            if (img?.key) mediaKeySet.add(String(img.key));
          });
          if (doc.audio?.key) mediaKeySet.add(String(doc.audio.key));
          if (doc.video?.key) mediaKeySet.add(String(doc.video.key));

          // Delete the document itself
          const delRes = await AffirmationModel.deleteOne({
            _id: doc._id,
            userId,
          });

          if ((delRes as any).deletedCount) {
            deletedCount += (delRes as any).deletedCount ?? 0;
            console.log(
              "POST /cloud/affirms/delete deleted Mongo doc _id =",
              String(doc._id),
              "clientId =",
              doc.clientId
            );
          }
        }

        // 2) Delete media files from S3
        if (!S3_BUCKET) {
          console.warn(
            "POST /cloud/affirms/delete S3_BUCKET not set, skip S3 deletion."
          );
        } else if (mediaKeySet.size > 0) {
          const objects = Array.from(mediaKeySet).map((Key) => ({ Key }));

          const params = {
            Bucket: S3_BUCKET,
            Delete: {
              Objects: objects,
              Quiet: true,
            },
          };

          console.log(
            "POST /cloud/affirms/delete S3 deleteObjects params =",
            JSON.stringify({
              bucket: S3_BUCKET,
              keys: Array.from(mediaKeySet),
            })
          );

          try {
            await s3.send(new DeleteObjectsCommand(params));
            console.log(
              "POST /cloud/affirms/delete S3 deleteObjects success, keys count =",
              mediaKeySet.size
            );
          } catch (err) {
            console.error("POST /cloud/affirms/delete S3 delete error:", err);
          }
        } else {
          console.log(
            "POST /cloud/affirms/delete no media keys collected, skip S3 delete."
          );
        }

        console.log(
          "POST /cloud/affirms/delete userId =",
          userId,
          "ids =",
          allIds,
          "deletedCount =",
          deletedCount,
          "mediaKeys =",
          Array.from(mediaKeySet)
        );

        return res.json({
          ok: true,
          deleted: deletedCount,
          total: allIds.length,
        });
      } catch (err) {
        console.error("POST /cloud/affirms/delete error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    }
  );
}
