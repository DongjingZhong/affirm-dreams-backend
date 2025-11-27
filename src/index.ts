// src/index.ts
import express from "express";
import cors from "cors";
import connectDatabase from "./config/db";
import { PORT } from "./config/env";
import profilesRoutes from "./routes/profiles";
import meRouter from "./routes/me";
import { mockAuth as authMiddleware } from "./middleware/mockAuth";
import { registerCloudAffirmsRoutes } from "./routes/cloudAffirms";

async function bootstrap() {
  console.log("🚀 Starting backend bootstrap...");
  await connectDatabase();

  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // All /me and /profiles routes require mockAuth (x-user-id or Bearer token)
  app.use("/me", authMiddleware, meRouter);
  app.use("/profiles", authMiddleware, profilesRoutes);
  registerCloudAffirmsRoutes(app);

  app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("❌ Failed to start server", err);
});
