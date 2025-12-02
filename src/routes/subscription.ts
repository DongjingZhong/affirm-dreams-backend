// src/routes/subscription.ts
// All comments in English only.

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@clerk/express";

import {
  SubscriptionModel,
  type Plan,
  type SubSource,
  type SubscriptionDocument,
} from "../models/Subscription";
import { PaymentModel, type Platform, type Provider } from "../models/Payment";

const router = Router();

/**
 * Shape returned to the mobile app.
 * This mirrors the Subscription type used in the mobile app.
 * It is the single source of truth for the current subscription status.
 */
type ClientSubscription = {
  plan: Plan;
  status: "active" | "inactive" | "canceled" | "expired";
  autoRenew: boolean;
  periodEnd: number | null;
  storageLimitGb?: number | null;
};

function toClientShape(doc: SubscriptionDocument | null): ClientSubscription {
  if (!doc) {
    return {
      plan: "free",
      status: "inactive",
      autoRenew: false,
      periodEnd: null,
      storageLimitGb: null,
    };
  }

  const isLifetime = doc.plan === "lifetime";
  const periodEnd = doc.renewsAt ? doc.renewsAt.getTime() : null;

  // For monthly/yearly: auto-renew is true when status is active
  const autoRenew =
    !isLifetime && doc.plan !== "free" && doc.status === "active";

  return {
    plan: doc.plan,
    status: doc.status,
    autoRenew,
    periodEnd,
    storageLimitGb: isLifetime ? 10 : null,
  };
}

function getUserId(req: Request): string | null {
  const auth = (req as any).auth as { userId?: string | null } | undefined;
  return auth?.userId ?? null;
}

/* ------------ GET /subscription (current user) ------------ */
/**
 * This endpoint is used by the mobile app on login:
 * - syncSubscriptionOnLogin(token) calls this route
 * - The response is cached in AsyncStorage("subscription")
 * - UI components (TopBar, AffirmDetail, etc.) rely on that cache
 */
router.get(
  "/subscription",
  requireAuth(),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const doc = await SubscriptionModel.findOne({ userId }).exec();
    const payload = toClientShape(doc);
    return res.json(payload);
  }
);

/* ------------ POST /subscription/activate ------------ */

type ActivateBody = {
  plan: Plan;
  periodEnd?: number | null;
  amountCents: number;
  currency: string;
  productId: string;
  transactionId: string;
  platform: Platform;
  provider: Provider;
};

router.post(
  "/subscription/activate",
  requireAuth(),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body as ActivateBody;

    if (!body.plan || !body.amountCents || !body.currency) {
      return res.status(400).json({ error: "Missing plan or payment details" });
    }

    const now = new Date();
    const expiresAt =
      body.plan === "lifetime"
        ? undefined
        : body.periodEnd
        ? new Date(body.periodEnd)
        : undefined;

    // 1) Create payment record
    const payment = await PaymentModel.create({
      userId,
      platform: body.platform,
      provider: body.provider,
      productId: body.productId,
      transactionId: body.transactionId,
      amountCents: body.amountCents,
      currency: body.currency,
      purchasedAt: now,
      expiresAt,
      rawPayload: null,
    });

    // 2) Upsert subscription
    const source: SubSource = body.provider as any;

    const subDoc = await SubscriptionModel.findOneAndUpdate(
      { userId },
      {
        userId,
        plan: body.plan,
        status: "active",
        source,
        startedAt: now,
        // do NOT write null here, leave undefined when no expiry
        renewsAt: expiresAt,
        canceledAt: undefined,
        latestPaymentId: payment._id,
      },
      { upsert: true, new: true }
    ).exec();

    const payload = toClientShape(subDoc);
    return res.json(payload);
  }
);

/* ------------ POST /subscription/cancel-auto-renew ------------ */

type CancelAutoRenewBody = {
  periodEnd?: number | null;
};

router.post(
  "/subscription/cancel-auto-renew",
  requireAuth(),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body as CancelAutoRenewBody;

    const subDoc = await SubscriptionModel.findOne({ userId }).exec();
    if (!subDoc) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    // If client sends a period end, we keep it for reference.
    if (typeof body.periodEnd === "number") {
      subDoc.renewsAt = new Date(body.periodEnd);
    }

    subDoc.status = "canceled";
    subDoc.canceledAt = new Date();

    await subDoc.save();

    const payload = toClientShape(subDoc);
    return res.json(payload);
  }
);

/* ------------ POST /subscription/resume-auto-renew ------------ */

router.post(
  "/subscription/resume-auto-renew",
  requireAuth(),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const subDoc = await SubscriptionModel.findOne({ userId }).exec();
    if (!subDoc) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    subDoc.status = "active";
    // We keep existing renewsAt; if there is none, client can update later.
    subDoc.canceledAt = undefined;

    await subDoc.save();

    const payload = toClientShape(subDoc);
    return res.json(payload);
  }
);

/* ------------ POST /subscription/switch-to-free ------------ */

router.post(
  "/subscription/switch-to-free",
  requireAuth(),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let subDoc = await SubscriptionModel.findOne({ userId }).exec();
    const now = new Date();

    if (!subDoc) {
      // Create a new "free" subscription row if it does not exist.
      subDoc = new SubscriptionModel({
        userId,
        plan: "free",
        status: "inactive",
        source: "admin",
        startedAt: now,
        // omit renewsAt here instead of setting null
        canceledAt: now,
      });
    } else {
      subDoc.plan = "free";
      subDoc.status = "inactive";
      subDoc.source = "admin";
      subDoc.renewsAt = undefined; // do not set null, keep as undefined
      subDoc.canceledAt = now;
    }

    await subDoc.save();

    const payload = toClientShape(subDoc);
    return res.json(payload);
  }
);

export default router;
