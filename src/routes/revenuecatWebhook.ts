// src/routes/webhooksRevenuecat.ts
// All comments in English only.

import { Router, type Request, type Response } from "express";
import crypto from "crypto";

import { PaymentModel } from "../models/Payment";
import {
  SubscriptionModel,
  type Plan,
  type SubSource,
} from "../models/Subscription";

const router = Router();

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function planFromProductId(productId?: string): Plan {
  if (!productId) return "free";
  if (productId.includes(".monthly")) return "monthly";
  if (productId.includes(".yearly")) return "yearly";
  if (productId.includes(".lifetime")) return "lifetime";
  return "free";
}

function providerFromStore(
  store?: string
): "google_play" | "app_store" | "stripe" | "promo" {
  const s = String(store || "").toLowerCase();
  if (s.includes("play") || s.includes("google")) return "google_play";
  if (s.includes("app_store") || s.includes("apple") || s.includes("ios"))
    return "app_store";
  if (s.includes("stripe")) return "stripe";
  return "promo";
}

/**
 * RevenueCat webhook endpoint.
 * Configure RevenueCat to POST to:
 *   https://<your-domain>/webhooks/revenuecat
 */
router.post("/webhooks/revenuecat", async (req: Request, res: Response) => {
  try {
    // 1) Verify Authorization header (recommended)
    const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
    if (expected) {
      const got = req.header("authorization") ?? "";
      if (!timingSafeEqual(got, expected)) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const event = (req.body as any)?.event;
    if (!event || !event.type) {
      return res.status(400).json({ error: "Missing event" });
    }

    // RevenueCat sends your "app_user_id" (should match your Clerk userId if you set it that way)
    const userId = event.app_user_id as string | undefined;
    if (!userId) {
      // Do not fail the webhook; just skip.
      return res.json({ ok: true, skipped: "missing app_user_id" });
    }

    const type = String(event.type);
    const productId = (event.product_id as string | undefined) ?? undefined;
    const transactionId =
      (event.transaction_id as string | undefined) ?? undefined;
    const originalTransactionId =
      (event.original_transaction_id as string | undefined) ?? undefined;

    const expirationAtMs =
      typeof event.expiration_at_ms === "number"
        ? event.expiration_at_ms
        : null;
    const purchasedAtMs =
      typeof event.purchased_at_ms === "number" ? event.purchased_at_ms : null;

    const store = (event.store as string | undefined) ?? undefined;
    const currency = (event.currency as string | undefined) ?? "USD";

    // cancel_reason can help distinguish refund-like cancellations.
    // Some SDKs/libraries list cancellation reasons such as CUSTOMER_SUPPORT. :contentReference[oaicite:1]{index=1}
    const cancelReason =
      (event.cancel_reason as string | undefined) ?? undefined;

    const now = new Date();
    const plan = planFromProductId(productId);

    const renewsAt = expirationAtMs ? new Date(expirationAtMs) : undefined;
    const startedAt = purchasedAtMs ? new Date(purchasedAtMs) : now;

    const provider = providerFromStore(store);
    const source: SubSource =
      provider === "google_play"
        ? "google_play"
        : provider === "app_store"
        ? "app_store"
        : provider === "stripe"
        ? "stripe"
        : "admin";

    // 2) Handle purchase-like events -> set subscription active
    const isPurchaseLike =
      type === "INITIAL_PURCHASE" ||
      type === "RENEWAL" ||
      type === "NON_RENEWING_PURCHASE" ||
      type === "UNCANCELLATION" ||
      type === "PRODUCT_CHANGE";

    if (isPurchaseLike) {
      // Upsert payment record if we have a transactionId (idempotent)
      if (transactionId) {
        await PaymentModel.updateOne(
          { transactionId },
          {
            $setOnInsert: {
              userId,
              platform:
                provider === "app_store"
                  ? "ios"
                  : provider === "google_play"
                  ? "android"
                  : "web",
              provider,
              productId: productId ?? "unknown",
              transactionId,
              originalTransactionId,
              amountCents: 0,
              currency,
              purchasedAt: startedAt,
              expiresAt: renewsAt,
              rawPayload: req.body,
            },
          },
          { upsert: true }
        );
      }

      await SubscriptionModel.findOneAndUpdate(
        { userId },
        {
          userId,
          plan,
          status: "active",
          source,
          startedAt,
          renewsAt,
          canceledAt: undefined,
        },
        { upsert: true, new: true }
      ).exec();

      return res.json({ ok: true });
    }

    // 3) Cancellation / refund-like -> revoke entitlements if it is a true refund/chargeback
    // In many setups, refunds/chargebacks come through as a cancellation initiated by support.
    const looksLikeRefund =
      type === "CANCELLATION" && cancelReason === "CUSTOMER_SUPPORT";

    if (looksLikeRefund) {
      await SubscriptionModel.findOneAndUpdate(
        { userId },
        {
          userId,
          plan: "free",
          status: "inactive",
          source,
          renewsAt: undefined,
          canceledAt: now,
        },
        { upsert: true, new: true }
      ).exec();

      return res.json({ ok: true, revoked: true });
    }

    // 4) Normal cancellation (user turned off auto-renew)
    if (type === "CANCELLATION") {
      await SubscriptionModel.findOneAndUpdate(
        { userId },
        {
          userId,
          plan,
          status: "canceled",
          source,
          renewsAt,
          canceledAt: now,
        },
        { upsert: true, new: true }
      ).exec();

      return res.json({ ok: true, canceled: true });
    }

    // 5) Expiration -> expire and downgrade
    if (type === "EXPIRATION") {
      await SubscriptionModel.findOneAndUpdate(
        { userId },
        {
          userId,
          plan: "free",
          status: "expired",
          source,
          renewsAt: undefined,
          canceledAt: now,
        },
        { upsert: true, new: true }
      ).exec();

      return res.json({ ok: true, expired: true });
    }

    // 6) Other events: acknowledge
    return res.json({ ok: true, ignored: type });
  } catch (err) {
    console.error("[POST /webhooks/revenuecat] error:", err);
    // Always return 200 if possible to avoid retries storms, but 500 is ok during debugging.
    return res.status(500).json({ error: "Webhook handler failed" });
  }
});

export default router;
