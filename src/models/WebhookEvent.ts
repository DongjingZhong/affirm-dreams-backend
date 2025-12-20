// All comments in English only.

import { Schema, model, type Document } from "mongoose";

export interface WebhookEventDocument extends Document {
  provider: "revenuecat";
  eventId: string; // RevenueCat event.id
  eventType: string; // RevenueCat event.type
  userId?: string;
  receivedAt: Date;
  rawPayload?: any;
}

const webhookEventSchema = new Schema<WebhookEventDocument>(
  {
    provider: { type: String, required: true, default: "revenuecat" },
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true },
    userId: { type: String },
    receivedAt: { type: Date, required: true, default: Date.now },
    rawPayload: { type: Schema.Types.Mixed },
  },
  { timestamps: false }
);

export const WebhookEventModel = model<WebhookEventDocument>(
  "WebhookEvent",
  webhookEventSchema
);
