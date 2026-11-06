import cors from "cors";
import express, { type Express, type RequestHandler } from "express";
import { type Config, missingCredentials } from "./config.js";
import { createErrorHandler, notFoundHandler } from "./errors.js";
import type { ArkivService } from "./integrations/arkiv.js";
import type { HederaBuyer } from "./integrations/hedera.js";
import type { LlmService } from "./integrations/llm.js";
import { agentsRouter } from "./routes/agents.js";
import { devRouter } from "./routes/dev.js";
import { paymentsRouter, servicesRouter } from "./routes/payments.js";
import type { Store } from "./store/store.js";

export interface AppDeps {
  config: Config;
  store: Store;
  /** Null when ARKIV_ACCESS_KEY is not set. */
  arkiv: ArkivService | null;
  /** Null (or absent) when LLM_API_KEY or LLM_MODEL is not set. */
  llm?: LlmService | null;
  /** x402 paywall for the market snapshot. Null (or absent) when Hedera is not configured. */
  paywall?: RequestHandler | null;
  /** Agent-side x402 buyer. Null (or absent) when Hedera is not configured. */
  buyer?: HederaBuyer | null;
}

/** Build the Express app without listening, so tests can start it on a random port. */
export function createApp({ config, store, arkiv, llm = null, paywall = null, buyer = null }: AppDeps): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: config.CLIENT_ORIGIN }));
  app.use(express.json({ limit: "100kb" }));

  // Reports which partner groups are not configured. Names only, never values.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", missing: missingCredentials(config) });
  });

  app.use("/api/agents", agentsRouter(arkiv));

  app.use(servicesRouter(paywall));
  app.use("/api/payments", paymentsRouter(store));

  // Dev-only routes are not mounted in production, so they return the normal 404.
  if (config.NODE_ENV !== "production") app.use("/api/dev", devRouter(llm, buyer));

  app.use(notFoundHandler);
  app.use(createErrorHandler());

  return app;
}
