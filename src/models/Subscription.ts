// src/models/Subscription.ts
import { Schema, model, type Document, Types } from "mongoose";

export type Plan = "free" | "monthly" | "yearly" | "lifetime";
export type SubStatus = "active" | "inactive" | "canceled" | "expired";
export type SubSource = "google_play" | "app_store" | "stripe" | "admin";

export interface SubscriptionDocument extends Document {
  userId: string;
  plan: Plan;
  status: SubStatus;
  source: SubSource;
  startedAt?: Date;
  renewsAt?: Date;
  canceledAt?: Date;
  latestPaymentId?: Types.ObjectId;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<SubscriptionDocument>(
  {
    userId: { type: String, required: true, unique: true },
    plan: {
      type: String,
      required: true,
      default: "free",
    },
    status: {
      type: String,
      required: true,
      default: "inactive",
    },
    source: {
      type: String,
      required: true,
      default: "admin",
    },
    startedAt: Date,
    renewsAt: Date,
    canceledAt: Date,
    latestPaymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const SubscriptionModel = model<SubscriptionDocument>(
  "Subscription",
  subscriptionSchema
);
