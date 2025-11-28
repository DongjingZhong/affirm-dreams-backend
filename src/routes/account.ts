// src/routes/account.ts
// All comments in English only.

import { Router, type Request, type Response } from "express";
import { requireAuth, clerkClient } from "@clerk/express";

const router = Router();

/**
 * Placeholder for deleting all app data for a given user.
 *
 * Later you can move this into src/services/deleteUserData.ts if you want,
 * but for now keeping it in this file avoids path / module resolution issues.
 */
async function deleteAllUserData(userId: string): Promise<void> {
  console.log("[deleteAllUserData] placeholder for user:", userId);

  // TODO:
  // - Delete user profile in your DB
  // - Delete cloud affirm metadata
  // - Delete payment history / subscription records
  // - Optionally delete S3 media objects
  //
  // For now this is just a no-op so that /account DELETE works end-to-end.
}

/**
 * Delete the current authenticated user's entire account and data.
 *
 * IMPORTANT:
 * - Never accept userId from body/query.
 * - Always trust userId from Clerk auth (req.auth.userId).
 */
router.delete(
  "/account",
  requireAuth(), // ensure the request has a valid Clerk session
  async (req: Request, res: Response) => {
    // Clerk attaches `auth` to the request, but Express types do not know it,
    // so we use a small type assertion here.
    const auth = (req as any).auth as { userId?: string | null } | undefined;

    const userId = auth?.userId ?? null;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log("[DELETE /account] Deleting user:", userId);

    try {
      // 1) Delete all app data related to this user (Mongo/Dynamo/S3 etc.)
      await deleteAllUserData(userId);

      // 2) Delete Clerk user itself
      await clerkClient.users.deleteUser(userId);

      console.log("[DELETE /account] Completed for user:", userId);

      return res.json({ ok: true });
    } catch (err) {
      console.error("[DELETE /account] Failed:", err);
      return res.status(500).json({ error: "Failed to delete account" });
    }
  }
);

export default router;
