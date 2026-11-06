import { Router, type RequestHandler } from "express";
import { tinybarsToHbar } from "../config.js";
import { AppError } from "../errors.js";
import { MARKET_SNAPSHOT_PATH, receiptToJson } from "../integrations/hedera.js";
import { MARKET_SNAPSHOT } from "../services/marketSnapshot.js";
import type { Store } from "../store/store.js";

/**
 * GET /api/services/market-snapshot behind the x402 paywall.
 * `paywall` is null when Hedera is not configured; the route then returns 503 and serves nothing.
 */
export function servicesRouter(paywall: RequestHandler | null): Router {
  const router = Router();
  const notConfigured: RequestHandler = () => {
    throw new AppError(503, "HEDERA_NOT_CONFIGURED", "Hedera is not configured on the server.");
  };
  // Only reached after the paywall has verified the payment. Settlement happens when the response is sent.
  router.get(MARKET_SNAPSHOT_PATH, paywall ?? notConfigured, (_req, res) => {
    res.json(MARKET_SNAPSHOT);
  });
  return router;
}

/** GET /api/payments: every receipt, oldest first (MVP: in memory). */
export function paymentsRouter(store: Store): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    const receipts = await store.listReceipts();
    res.json({ receipts: receipts.map((r) => receiptToJson(r, tinybarsToHbar)) });
  });
  return router;
}
