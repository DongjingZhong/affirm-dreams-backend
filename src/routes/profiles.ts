// src/routes/profiles.ts
// All comments in English only.

import { Router } from "express";
import type { Request, Response } from "express";
import type { AuthedRequest } from "../middleware/mockAuth";
import { UserModel } from "../models/User";

const router = Router();

/**
 * Helper: map Mongo UserDocument -> mobile app's profile DTO.
 */
function toProfileDto(user: any) {
  if (!user) {
    return {
      avatarUri: null,
      name: "",
      birthday: "2000-01-01",
      createdAt: Date.now(),
    };
  }

  const birthdayStr =
    user.birthday instanceof Date
      ? user.birthday.toISOString().slice(0, 10) // "YYYY-MM-DD"
      : typeof user.birthday === "string"
      ? user.birthday
      : "2000-01-01";

  return {
    avatarUri: user.avatarUri ?? null,
    name: user.name ?? "",
    birthday: birthdayStr,
    createdAt: user.createdAt ? new Date(user.createdAt).getTime() : Date.now(),
  };
}

/**
 * GET /profiles/me
 * Compatible with old AWS API: returns { profile: {...} }
 */
// src/routes/profiles.ts
// All comments in English only.

router.get("/me", async (req: Request, res: Response) => {
  try {
    const { userId } = req as AuthedRequest;
    if (!userId) {
      res.status(401).json({ error: "Missing user identity" });
      return;
    }

    const user = await UserModel.findOne({ authId: userId });

    // Do NOT auto-create here; this endpoint is read-only.
    if (!user) {
      res.json({
        profile: null,
        exists: false,
        profileCompleted: false,
      });
      return;
    }

    const profile = toProfileDto(user);
    const profileCompleted = Boolean(user.name);

    res.json({
      profile,
      exists: true,
      profileCompleted,
    });
  } catch (err) {
    console.error("Error in GET /profiles/me", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

/**
 * PUT /profiles
 * Upsert profile for current user, then return { profile: {...} }.
 */
// src/routes/profiles.ts
// All comments in English only.

router.put("/", async (req: Request, res: Response) => {
  try {
    const { userId } = req as AuthedRequest;
    if (!userId) {
      res.status(401).json({ error: "Missing user identity" });
      return;
    }

    const { name, birthday, avatarUri, createdAt } = req.body ?? {};

    const update: any = {
      name,
      avatarUri: avatarUri ?? null,
    };

    if (birthday) {
      update.birthday = new Date(birthday);
    }

    const user = await UserModel.findOneAndUpdate(
      { authId: userId },
      {
        $set: update,
        $setOnInsert: {
          authId: userId,
          primaryEmail: `${userId}@placeholder.local`,
          ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
        },
      },
      { new: true, upsert: true }
    );

    const profile = toProfileDto(user);
    const profileCompleted = Boolean(user?.name);

    res.json({ profile, profileCompleted });
  } catch (err) {
    console.error("😑Error in PUT /profiles", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

export default router;
