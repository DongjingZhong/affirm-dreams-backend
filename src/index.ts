// src/index.ts
import express from "express";
import cors from "cors";
import connectDatabase from "./config/db";
import { PORT } from "./config/env";
import profilesRoutes from "./routes/profiles";
import meRouter from "./routes/me";
import { mockAuth as authMiddleware } from "./middleware/mockAuth";
import { registerCloudAffirmsRoutes } from "./routes/cloudAffirms";
import accountRouter from "./routes/account";
import billingRouter from "./routes/billing";
import { clerkMiddleware } from "@clerk/express";
import subscriptionRouter from "./routes/subscription";
import revenuecatWebhookRouter from "./routes/revenuecatWebhook";

async function bootstrap() {
  console.log("🚀 Starting backend bootstrap...");
  await connectDatabase();

  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(clerkMiddleware());
  app.use(subscriptionRouter);
  app.use(revenuecatWebhookRouter);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // All /me and /profiles routes require mockAuth (x-user-id or Bearer token)
  app.use("/me", authMiddleware, meRouter);
  app.use("/profiles", authMiddleware, profilesRoutes);
  app.use(accountRouter); // so DELETE /account is reachable
  app.use(billingRouter);
  registerCloudAffirmsRoutes(app);

  app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("❌ Failed to start server", err);
});
