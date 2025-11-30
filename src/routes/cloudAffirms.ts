// src/routes/cloudAffirms.ts
// All comments in English only.

import type { Application, Request, Response } from "express";
import { AffirmationModel } from "../models/Affirmation";

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

export function registerCloudAffirmsRoutes(app: Application) {
  // List all cloud affirms for a user
  app.get("/cloud/affirms", async (req: Request, res: Response) => {
    try {
      // For now we use a simple userId. Later we can read from auth.
      const userId = (req.query.userId as string | undefined) || "demo-user";

      const docs = await AffirmationModel.find({
        userId,
        archived: { $ne: true },
      })
        .sort({ createdAt: 1 })
        .lean();

      const metas: RemoteAffirmationMeta[] = docs.map((doc) => ({
        // Return the clientId so mobile can use it as `id`
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
        const { userId, id } = req.body as {
          userId?: string;
          id?: string;
        };

        // We require an explicit userId and clientId from the mobile app
        if (!userId || !id) {
          return res
            .status(400)
            .json({ error: "Missing userId or id (clientId)" });
        }

        // Delete by (userId + clientId) to avoid touching other users' data
        const result = await AffirmationModel.deleteOne({
          userId,
          clientId: id,
        });

        // It is safe to return ok even if nothing was deleted (already gone)
        return res.json({
          ok: true,
          deletedCount: (result as any).deletedCount ?? 0,
        });
      } catch (err) {
        console.error("POST /cloud/affirms/delete error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    }
  );
}
