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

const LOG_TAG = "[subscription]";

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

function planFromProductId(productId?: string): Plan {
  if (!productId) return "free";
  if (productId.includes(".monthly")) return "monthly";
  if (productId.includes(".yearly")) return "yearly";
  if (productId.includes(".lifetime")) return "lifetime";
  return "free";
}

function subSourceFromProvider(provider?: Provider): SubSource {
  if (provider === "google_play") return "google_play";
  if (provider === "app_store") return "app_store";
  if (provider === "stripe") return "stripe";
  return "admin";
}

function maskId(v?: string): string | null {
  if (!v) return null;
  if (v.length <= 8) return v;
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
}

router.get(
  "/subscription",
  requireAuth(),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const doc = await SubscriptionModel.findOne({ userId }).exec();
    const payload = toClientShape(doc);

    console.log(`${LOG_TAG} get`, {
      userId: maskId(userId),
      plan: payload.plan,
      status: payload.status,
      autoRenew: payload.autoRenew,
      periodEnd: payload.periodEnd,
    });

    return res.json(payload);
  }
);

type ActivateBody = {
  plan?: Plan;
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
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const body = req.body as ActivateBody;

    if (
      !body.productId ||
      !body.transactionId ||
      !body.provider ||
      !body.platform
    ) {
      console.warn(`${LOG_TAG} activate_bad_request`, {
        userId: maskId(userId),
        hasProductId: Boolean(body.productId),
        hasTransactionId: Boolean(body.transactionId),
        provider: body.provider ?? null,
        platform: body.platform ?? null,
      });
      return res
        .status(400)
        .json({ error: "Missing productId/transactionId/provider/platform" });
    }

    if (
      typeof body.amountCents !== "number" ||
      !Number.isFinite(body.amountCents) ||
      body.amountCents < 0
    ) {
      console.warn(`${LOG_TAG} activate_invalid_amount`, {
        userId: maskId(userId),
        amountCents: body.amountCents,
      });
      return res.status(400).json({ error: "Invalid amountCents" });
    }

    if (!body.currency) {
      return res.status(400).json({ error: "Missing currency" });
    }

    const derivedPlan = planFromProductId(body.productId);
    const plan: Plan =
      derivedPlan !== "free" ? derivedPlan : body.plan ?? "free";

    console.log(`${LOG_TAG} activate_incoming`, {
      userId: maskId(userId),
      plan,
      productId: body.productId,
      transactionId: maskId(body.transactionId),
      provider: body.provider,
      platform: body.platform,
      amountCents: body.amountCents,
      currency: String(body.currency).toUpperCase(),
      periodEnd: typeof body.periodEnd === "number" ? body.periodEnd : null,
    });

    const now = new Date();
    const expiresAt =
      plan === "lifetime"
        ? undefined
        : typeof body.periodEnd === "number"
        ? new Date(body.periodEnd)
        : undefined;

    await PaymentModel.updateOne(
      { transactionId: body.transactionId },
      {
        $setOnInsert: {
          userId,
          platform: body.platform,
          provider: body.provider,
          productId: body.productId,
          transactionId: body.transactionId,
        },
        $set: {
          amountCents: body.amountCents,
          currency: String(body.currency).toUpperCase(),
          purchasedAt: now,
          expiresAt,
          rawPayload: body,
        },
      },
      { upsert: true }
    );

    const paymentDoc = await PaymentModel.findOne({
      transactionId: body.transactionId,
    }).exec();

    const source: SubSource = subSourceFromProvider(body.provider);

    const subDoc = await SubscriptionModel.findOneAndUpdate(
      { userId },
      {
        userId,
        plan,
        status: "active",
        source,
        startedAt: now,
        renewsAt: expiresAt,
        canceledAt: undefined,
        latestPaymentId: paymentDoc ? (paymentDoc as any)._id : undefined,
      },
      { upsert: true, new: true }
    ).exec();

    const payload = toClientShape(subDoc);

    console.log(`${LOG_TAG} activate_applied`, {
      userId: maskId(userId),
      plan: payload.plan,
      status: payload.status,
      autoRenew: payload.autoRenew,
      periodEnd: payload.periodEnd,
    });

    return res.json(payload);
  }
);

router.post(
  "/subscription/cancel-auto-renew",
  requireAuth(),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const body = req.body as { periodEnd?: number | null };

    const subDoc = await SubscriptionModel.findOne({ userId }).exec();
    if (!subDoc)
      return res.status(404).json({ error: "Subscription not found" });

    if (typeof body.periodEnd === "number") {
      subDoc.renewsAt = new Date(body.periodEnd);
    }

    subDoc.status = "canceled";
    subDoc.canceledAt = new Date();
    await subDoc.save();

    const payload = toClientShape(subDoc);

    console.log(`${LOG_TAG} cancel_auto_renew`, {
      userId: maskId(userId),
      status: payload.status,
      periodEnd: payload.periodEnd,
    });

    return res.json(payload);
  }
);

router.post(
  "/subscription/resume-auto-renew",
  requireAuth(),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const subDoc = await SubscriptionModel.findOne({ userId }).exec();
    if (!subDoc)
      return res.status(404).json({ error: "Subscription not found" });

    subDoc.status = "active";
    subDoc.canceledAt = undefined;
    await subDoc.save();

    const payload = toClientShape(subDoc);

    console.log(`${LOG_TAG} resume_auto_renew`, {
      userId: maskId(userId),
      status: payload.status,
      periodEnd: payload.periodEnd,
    });

    return res.json(payload);
  }
);

router.post(
  "/subscription/switch-to-free",
  requireAuth(),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    let subDoc = await SubscriptionModel.findOne({ userId }).exec();
    const now = new Date();

    if (!subDoc) {
      subDoc = new SubscriptionModel({
        userId,
        plan: "free",
        status: "inactive",
        source: "admin",
        startedAt: now,
        canceledAt: now,
      });
    } else {
      subDoc.plan = "free";
      subDoc.status = "inactive";
      subDoc.source = "admin";
      subDoc.renewsAt = undefined;
      subDoc.canceledAt = now;
    }

    await subDoc.save();
    const payload = toClientShape(subDoc);

    console.log(`${LOG_TAG} switch_to_free`, {
      userId: maskId(userId),
      plan: payload.plan,
      status: payload.status,
    });

    return res.json(payload);
  }
);

export default router;
