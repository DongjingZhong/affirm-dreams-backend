import mongoose from "mongoose";
import { MONGODB_URI } from "./env";

export default async function connectDatabase(): Promise<void> {
  console.log("⏳ Connecting to MongoDB...");
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection error", err);
    process.exit(1);
  }
}
