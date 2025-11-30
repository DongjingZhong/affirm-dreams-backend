// src/routes/billing.ts
// All comments in English only.

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@clerk/express";

import { PaymentModel, type PaymentDocument } from "../models/Payment";

const router = Router();

/**
 * Map productId into our plan type.
 */
function planFromProductId(
  productId?: string
): "free" | "monthly" | "yearly" | "lifetime" {
  if (!productId) return "free";
  if (productId.includes(".monthly")) return "monthly";
  if (productId.includes(".yearly")) return "yearly";
  if (productId.includes(".lifetime")) return "lifetime";
  return "free";
}

/**
 * Map provider into store value used by the mobile app.
 */
function storeFromProvider(
  provider?: string
): "apple" | "google" | "stripe" | "promo" | "test" | "other" {
  if (provider === "app_store") return "apple";
  if (provider === "google_play") return "google";
  if (provider === "stripe") return "stripe";
  if (provider === "promo") return "promo";
  return "other";
}

/**
 * Get payment history for the CURRENT authenticated user
 * directly from MongoDB `Payment` collection.
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

    try {
      console.log(
        "[GET /billing/history] Loading from Mongo for user:",
        userId
      );

      const docs = await PaymentModel.find({ userId })
        .sort({ purchasedAt: -1 })
        .lean<PaymentDocument[]>()
        .exec();

      const items = docs.map((doc) => {
        const plan = planFromProductId(doc.productId);
        const store = storeFromProvider(doc.provider);

        return {
          id: (doc as any)._id.toString(),
          userId: doc.userId,
          plan,
          amount: (doc.amountCents ?? 0) / 100, // cents -> dollars
          currency: doc.currency ?? "USD",
          platform: (doc.platform ?? "web") as
            | "ios"
            | "android"
            | "web"
            | "unknown",
          store,
          storeTransactionId: doc.transactionId ?? null,
          purchasedAt: new Date(doc.purchasedAt).getTime(),
          expiresAt: doc.expiresAt ? new Date(doc.expiresAt).getTime() : null,
          status: "paid" as const,
        };
      });

      return res.json({ items });
    } catch (err) {
      console.error("[GET /billing/history] Error:", err);
      return res.status(500).json({ error: "Failed to load payment history" });
    }
  }
);

export default router;
