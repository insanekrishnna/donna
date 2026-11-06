import cors from "cors";
import express, { type Express } from "express";
import { type Config, missingCredentials } from "./config.js";
import { createErrorHandler, notFoundHandler } from "./errors.js";
import type { Store } from "./store/store.js";

export interface AppDeps {
  config: Config;
  store: Store;
}

/** Build the Express app without listening, so tests can start it on a random port. */
export function createApp({ config }: AppDeps): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: config.CLIENT_ORIGIN }));
  app.use(express.json({ limit: "100kb" }));

  // Reports which partner groups are not configured. Names only, never values.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", missing: missingCredentials(config) });
  });

  app.use(notFoundHandler);
  app.use(createErrorHandler());

  return app;
}
