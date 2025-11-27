// src/models/Payment.ts
import { Schema, model, type Document, Types } from "mongoose";

export type Platform = "android" | "ios" | "web";
export type Provider = "google_play" | "app_store" | "stripe" | "promo";

export interface PaymentDocument extends Document {
  userId: string;
  platform: Platform;
  provider: Provider;
  productId: string;
  transactionId: string;
  originalTransactionId?: string;
  amountCents: number;
  currency: string;
  purchasedAt: Date;
  expiresAt?: Date;
  rawPayload?: any;
  createdAt: Date;
}

const paymentSchema = new Schema<PaymentDocument>(
  {
    userId: { type: String, required: true, index: true },
    platform: { type: String, required: true },
    provider: { type: String, required: true },
    productId: { type: String, required: true },
    transactionId: { type: String, required: true, unique: true },
    originalTransactionId: { type: String },
    amountCents: { type: Number, required: true },
    currency: { type: String, required: true },
    purchasedAt: { type: Date, required: true },
    expiresAt: { type: Date },
    rawPayload: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const PaymentModel = model<PaymentDocument>("Payment", paymentSchema);
