// src/routes/billing.ts
// All comments in English only.

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@clerk/express";

const router = Router();

// Legacy billing API that already returns payment history by userId.
// Later you can replace this with a MongoDB query if you want.
const LEGACY_BILLING_URL =
  process.env.LEGACY_BILLING_URL ||
  "https://rn5t3relei.execute-api.us-east-1.amazonaws.com/billing";

/**
 * Get payment history for the CURRENT authenticated user.
 *
 * IMPORTANT:
 * - We NEVER read userId from query/body.
 * - We ALWAYS trust Clerk (req.auth.userId).
 */
router.get(
  "/billing/history",
  requireAuth(),
  async (req: Request, res: Response) => {
    const auth = (req as any).auth as { userId?: string | null } | undefined;
    const userId = auth?.userId ?? null;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const url = `${LEGACY_BILLING_URL}?userId=${encodeURIComponent(userId)}`;

    try {
      console.log("[GET /billing/history] Fetching for user:", userId);

      const upstream = await fetch(url);

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        console.error(
          "[GET /billing/history] Upstream failed:",
          upstream.status,
          text
        );
        return res
          .status(502)
          .json({ error: "Upstream billing service failed" });
      }

      const json = await upstream.json();

      // Return whatever the legacy billing service returns.
      // Typically: { items: PaymentRecord[] }
      return res.json(json);
    } catch (err) {
      console.error("[GET /billing/history] Error:", err);
      return res.status(500).json({ error: "Failed to load payment history" });
    }
  }
);

export default router;
