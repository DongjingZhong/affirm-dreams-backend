// src/models/User.ts
// All comments in English only.

import mongoose, { Document, Schema } from "mongoose";

export type AuthProviderType =
  | "google"
  | "apple"
  | "email"
  | "tiktok"
  | "unknown";

export interface IUser extends Document {
  authId: string; // Clerk user id / sub
  primaryEmail?: string;

  name?: string;
  username?: string;
  birthday?: Date;
  avatarUri?: string | null;
  avatarKey?: string | null;

  providers: {
    type: AuthProviderType;
    lastUsedAt: Date;
  }[];

  locale?: string;
  timezone?: string;

  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;

  lastDevice?: {
    platform?: string;
    osVersion?: string;
    appVersion?: string;
    deviceModel?: string;
  };
}

const ProviderSchema = new Schema(
  {
    type: { type: String, required: true },
    lastUsedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const DeviceSchema = new Schema(
  {
    platform: String,
    osVersion: String,
    appVersion: String,
    deviceModel: String,
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    authId: { type: String, required: true, unique: true, index: true },
    primaryEmail: { type: String },

    name: { type: String },
    username: { type: String },
    birthday: { type: Date },
    avatarUri: { type: String, default: null }, // public URL
    avatarKey: { type: String, default: null }, // S3 key, optional

    providers: { type: [ProviderSchema], default: [] },

    locale: { type: String },
    timezone: { type: String },

    lastLoginAt: { type: Date },
    lastDevice: { type: DeviceSchema },
  },
  { timestamps: true }
);

UserSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

export const UserModel =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
