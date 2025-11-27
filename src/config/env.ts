// src/config/env.ts
import dotenv from "dotenv";

dotenv.config();

const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  throw new Error("MONGODB_URI is not defined in .env");
}

export const MONGODB_URI: string = mongoUri;
export const PORT = process.env.PORT || "4000";
