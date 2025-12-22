// src\routes\revenuecatWebhook.ts
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

const LOG_TAG = "[revenuecat-webhook]";

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function normalizeAuthHeader(v: string): string {
  // Accept either raw secret or "Bearer <secret>"
  const s = (v || "").trim();
  if (!s) return "";
  if (s.toLowerCase().startsWith("bearer ")) return s.slice(7).trim();
  return s;
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

function subSourceFromProvider(provider: string): SubSource {
  if (provider === "google_play") return "google_play";
  if (provider === "app_store") return "app_store";
  if (provider === "stripe") return "stripe";
  return "admin";
}

function safeString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return undefined;
}

function pickCurrency(event: any): string {
  const c =
    safeString(event?.currency) ||
    safeString(event?.price_currency) ||
    safeString(event?.price_currency_code) ||
    safeString(event?.presented_currency) ||
    "USD";
  return c.toUpperCase();
}

function toCentsFromUnknown(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.round(v * 100);
  }
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return null;
}

function extractAmountCents(event: any): number | null {
  const candidates: unknown[] = [
    event?.price,
    event?.price_in_purchased_currency,
    event?.price_in_local_currency,
    event?.revenue,
  ];

  for (const c of candidates) {
    const cents = toCentsFromUnknown(c);
    if (typeof cents === "number" && Number.isFinite(cents) && cents >= 0) {
      return cents; // allow 0 for trials/promos
    }
  }
  return null;
}

function isPurchaseLikeEvent(type: string): boolean {
  return (
    type === "INITIAL_PURCHASE" ||
    type === "RENEWAL" ||
    type === "NON_RENEWING_PURCHASE" ||
    type === "UNCANCELLATION" ||
    type === "PRODUCT_CHANGE"
  );
}

function isRefundLikeEvent(type: string, cancelReason?: string): boolean {
  const r = String(cancelReason || "").toUpperCase();
  if (type === "REFUND" || type === "REVOCATION") return true;
  if (type === "CANCELLATION" && r === "CUSTOMER_SUPPORT") return true;
  return false;
}

function maskId(v?: string): string | null {
  if (!v) return null;
  if (v.length <= 8) return v;
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
}

/**
 * RevenueCat webhook endpoint.
 * Configure RevenueCat to POST to:
 *   https://<your-domain>/webhooks/revenuecat
 */
router.post("/webhooks/revenuecat", async (req: Request, res: Response) => {
  try {
    // 1) Verify Authorization header (recommended)
    const expectedRaw = process.env.REVENUECAT_WEBHOOK_AUTH;
    if (expectedRaw) {
      const expected = normalizeAuthHeader(expectedRaw);
      const got = normalizeAuthHeader(req.header("authorization") ?? "");

      if (!expected || !got || !timingSafeEqual(got, expected)) {
        console.warn(`${LOG_TAG} unauthorized`, {
          hasAuthHeader: Boolean(req.header("authorization")),
        });
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const event = (req.body as any)?.event;
    if (!event || !event.type) {
      console.warn(`${LOG_TAG} bad_request_missing_event`, {
        hasBody: Boolean(req.body),
      });
      return res.status(400).json({ error: "Missing event" });
    }

    const type = String(event.type);
    const userId = safeString(event.app_user_id);
    const productId = safeString(event.product_id);
    const transactionId = safeString(event.transaction_id);
    const originalTransactionId = safeString(event.original_transaction_id);
    const store = safeString(event.store);
    const cancelReason = safeString(event.cancel_reason);

    const expirationAtMs =
      typeof event.expiration_at_ms === "number"
        ? event.expiration_at_ms
        : null;
    const purchasedAtMs =
      typeof event.purchased_at_ms === "number" ? event.purchased_at_ms : null;

    const currency = pickCurrency(event);
    const amountCents = extractAmountCents(event);

    // Log the incoming event with key fields only (avoid huge payloads)
    console.log(`${LOG_TAG} incoming`, {
      type,
      eventId: safeString(event.id) ?? null,
      appUserId: maskId(userId),
      store: store ?? null,
      productId: productId ?? null,
      transactionId: maskId(transactionId),
      originalTransactionId: maskId(originalTransactionId),
      purchasedAtMs,
      expirationAtMs,
      currency,
      amountCents,
      cancelReason: cancelReason ?? null,
      environment: safeString(event.environment) ?? null,
    });

    if (!userId) {
      console.warn(`${LOG_TAG} skipped_missing_app_user_id`, {
        type,
        productId: productId ?? null,
      });
      return res.json({ ok: true, skipped: "missing app_user_id" });
    }

    const now = new Date();
    const plan = planFromProductId(productId);

    const renewsAt = expirationAtMs ? new Date(expirationAtMs) : undefined;
    const startedAt = purchasedAtMs ? new Date(purchasedAtMs) : now;

    const provider = providerFromStore(store);
    const source: SubSource = subSourceFromProvider(provider);

    // 2) Handle purchase-like events -> set subscription active
    if (isPurchaseLikeEvent(type)) {
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
            },
            $set: {
              amountCents: typeof amountCents === "number" ? amountCents : 0,
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

      console.log(`${LOG_TAG} applied_purchase_like`, {
        appUserId: maskId(userId),
        type,
        plan,
        status: "active",
        renewsAt: renewsAt ? renewsAt.toISOString() : null,
      });

      return res.json({ ok: true });
    }

    // 3) Refund-like -> revoke entitlements
    if (isRefundLikeEvent(type, cancelReason)) {
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

      console.log(`${LOG_TAG} applied_refund_like`, {
        appUserId: maskId(userId),
        type,
        status: "inactive",
      });

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

      console.log(`${LOG_TAG} applied_cancellation`, {
        appUserId: maskId(userId),
        plan,
        status: "canceled",
        renewsAt: renewsAt ? renewsAt.toISOString() : null,
      });

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

      console.log(`${LOG_TAG} applied_expiration`, {
        appUserId: maskId(userId),
        status: "expired",
      });

      return res.json({ ok: true, expired: true });
    }

    console.log(`${LOG_TAG} ignored`, { type });
    return res.json({ ok: true, ignored: type });
  } catch (err) {
    console.error(`${LOG_TAG} error`, err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
});

export default router;
