// src/middleware/mockAuth.ts
// All comments in English only.

import type { NextFunction, Request, Response } from "express";

export interface AuthedRequest extends Request {
  userId: string;
}

/**
 * Lightweight auth middleware:
 * - Prefer explicit "x-user-id" header (Postman, manual tests).
 * - Otherwise, read "Authorization: Bearer <JWT>" and decode the payload.
 *   We use the `sub` claim (Clerk user id) as userId.
 *   If decoding fails, we fall back to using the raw token string.
 */
export function mockAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  let userId = (req.header("x-user-id") || "").trim();

  if (!userId) {
    const auth = req.header("authorization") || req.header("Authorization");
    if (auth && auth.startsWith("Bearer ")) {
      const token = auth.slice("Bearer ".length).trim();

      const parts = token.split(".");
      if (parts.length === 3) {
        try {
          const payloadJson = Buffer.from(parts[1], "base64").toString("utf8");
          const payload = JSON.parse(payloadJson);

          userId =
            payload.sub ||
            payload.user_id ||
            payload.sid ||
            payload.id ||
            token;
        } catch {
          userId = token;
        }
      } else {
        userId = token;
      }
    }
  }

  if (!userId) {
    res.status(401).json({ error: "Missing user identity" });
    return;
  }

  (req as AuthedRequest).userId = userId;
  next();
}
