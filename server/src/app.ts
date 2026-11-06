import cors from "cors";
import express, { type Express } from "express";
import { type Config, missingCredentials } from "./config.js";
import { createErrorHandler, notFoundHandler } from "./errors.js";
import type { ArkivService } from "./integrations/arkiv.js";
import { agentsRouter } from "./routes/agents.js";
import type { Store } from "./store/store.js";

export interface AppDeps {
  config: Config;
  store: Store;
  /** Null when ARKIV_ACCESS_KEY is not set. */
  arkiv: ArkivService | null;
}

/** Build the Express app without listening, so tests can start it on a random port. */
export function createApp({ config, arkiv }: AppDeps): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: config.CLIENT_ORIGIN }));
  app.use(express.json({ limit: "100kb" }));

  // Reports which partner groups are not configured. Names only, never values.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", missing: missingCredentials(config) });
  });

  app.use("/api/agents", agentsRouter(arkiv));

  app.use(notFoundHandler);
  app.use(createErrorHandler());

  return app;
}
