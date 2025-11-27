// src/models/Affirmation.ts
// All comments in English only.

import { Schema, model, type Document } from "mongoose";

interface MediaImage {
  key: string;
  width?: number;
  height?: number;
}

interface MediaAudio {
  key: string;
  durationSec?: number;
}

interface MediaVideo {
  key: string;
  durationSec?: number;
  thumbnailKey?: string;
}

export interface AffirmationDocument extends Document {
  userId: string; // Clerk userId or other backend user id
  clientId: string; // local id from the mobile app
  title?: string;
  text: string;
  tags?: string[];
  images?: MediaImage[];
  audio?: MediaAudio;
  video?: MediaVideo;
  isFavorite?: boolean;
  archived?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const imageSchema = new Schema<MediaImage>(
  {
    key: { type: String, required: true },
    width: Number,
    height: Number,
  },
  { _id: false }
);

const audioSchema = new Schema<MediaAudio>(
  {
    key: { type: String, required: true },
    durationSec: Number,
  },
  { _id: false }
);

const videoSchema = new Schema<MediaVideo>(
  {
    key: { type: String, required: true },
    durationSec: Number,
    thumbnailKey: String,
  },
  { _id: false }
);

const affirmationSchema = new Schema<AffirmationDocument>(
  {
    userId: { type: String, required: true, index: true },
    clientId: { type: String, required: true, index: true }, // local id from app
    title: String,
    text: { type: String, required: true },
    tags: [String],
    images: [imageSchema],
    audio: audioSchema,
    video: videoSchema,
    isFavorite: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Ensure one mobile id per user
affirmationSchema.index({ userId: 1, clientId: 1 }, { unique: true });

export const AffirmationModel = model<AffirmationDocument>(
  "Affirmation",
  affirmationSchema
);
