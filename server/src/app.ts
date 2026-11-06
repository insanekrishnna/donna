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
import { tasksRouter } from "./routes/tasks.js";
import type { Coordinator } from "./agents/coordinator.js";
import { rateLimit } from "./rateLimit.js";
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
  /** Null (or absent) unless the LLM, Hedera and Arkiv (with the server key) are all configured. */
  coordinator?: Coordinator | null;
  /** Per-IP limit on starting tasks. Tests pass a small window. */
  taskRateLimit?: { windowMs: number; max: number };
}

/** Largest JSON body accepted. The biggest legitimate body (a dev call with full context) fits. */
export const MAX_BODY = "64kb";
/** Default: each IP may start 5 tasks per 10 minutes. Every task spends testnet HBAR and LLM quota. */
export const TASK_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };

/** Build the Express app without listening, so tests can start it on a random port. */
export function createApp({
  config,
  store,
  arkiv,
  llm = null,
  paywall = null,
  buyer = null,
  coordinator = null,
  taskRateLimit = TASK_RATE_LIMIT,
}: AppDeps): Express {
  const app = express();

  app.disable("x-powered-by");
  // In production the app runs behind one hosting proxy (Render). Trust exactly that hop, so
  // req.ip is the client's address for rate limiting and cannot be spoofed with extra headers.
  if (config.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(cors({ origin: config.CLIENT_ORIGIN }));
  app.use(express.json({ limit: MAX_BODY }));

  // Reports which partner groups are not configured. Names only, never values.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", missing: missingCredentials(config) });
  });

  app.use("/api/agents", agentsRouter(arkiv));

  app.use(servicesRouter(paywall));
  app.use("/api/payments", paymentsRouter(store));
  app.post(
    "/api/tasks",
    rateLimit({
      ...taskRateLimit,
      message: "Too many tasks started from your connection. Please wait a few minutes and try again.",
    }),
  );
  app.use("/api/tasks", tasksRouter(coordinator, store));

  // Dev-only routes are not mounted in production, so they return the normal 404.
  if (config.NODE_ENV !== "production") app.use("/api/dev", devRouter(llm, buyer));

  app.use(notFoundHandler);
  app.use(createErrorHandler());

  return app;
}
