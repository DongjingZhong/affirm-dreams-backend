// src/routes/me.ts
// All comments in English only.

import express from "express";
import multer from "multer";
import { UserModel } from "../models/User";
import { uploadUserAvatarToS3 } from "../lib/s3";
import type { AuthedRequest } from "../middleware/mockAuth";

const router = express.Router();

// Use memory storage because we only need the buffer for S3 upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
});

// POST /me/avatar - upload and set avatar
router.post(
  "/avatar",
  upload.single("avatar"), // field name: "avatar"
  async (req, res) => {
    try {
      const authedReq = req as AuthedRequest & {
        file?: Express.Multer.File;
      };

      // Debug log: who is calling, has file or not
      console.log("POST /me/avatar headers =", {
        userId: authedReq.userId,
        contentType: req.headers["content-type"],
      });

      const userId = authedReq.userId;
      if (!userId) {
        console.error("POST /me/avatar -> missing userId");
        res.status(401).json({ error: "Missing userId" });
        return;
      }

      const file = authedReq.file;
      if (!file) {
        console.error("POST /me/avatar -> missing file");
        res.status(400).json({ error: "Missing avatar file" });
        return;
      }

      console.log("POST /me/avatar file info =", {
        originalname: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      });

      const { buffer, mimetype } = file;

      // 1) Upload to S3
      const { key, url } = await uploadUserAvatarToS3(userId, buffer, mimetype);

      console.log("POST /me/avatar S3 result =", { key, url });

      // 2) Save on user record
      const updated = await UserModel.findOneAndUpdate(
        { authId: userId },
        {
          $set: {
            avatarUri: url,
            avatarKey: key,
          },
          $setOnInsert: { authId: userId },
        },
        { new: true, upsert: true }
      );

      console.log("POST /me/avatar user updated =", {
        authId: updated?.authId,
        avatarUri: updated?.avatarUri,
      });

      res.json({
        avatarUri: updated?.avatarUri ?? url,
      });
    } catch (err) {
      console.error("Error in POST /me/avatar", err);
      res.status(500).json({ error: "Failed to upload avatar" });
    }
  }
);

export default router;
