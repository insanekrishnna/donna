import { Router } from "express";
import { runSpecialist, specialistInputSchema } from "../agents/runSpecialist.js";
import { tinybarsToHbar } from "../config.js";
import { AppError } from "../errors.js";
import { type HederaBuyer, MARKET_SNAPSHOT_PATH, MARKET_SNAPSHOT_PAYEE, receiptToJson } from "../integrations/hedera.js";
import type { LlmService } from "../integrations/llm.js";
import { parseBody } from "./validate.js";

/**
 * Dev-only routes. createApp mounts this router only when NODE_ENV is not "production",
 * so in production these paths fall through to the 404 handler.
 * `llm` is null when LLM_API_KEY or LLM_MODEL is not set.
 */
export function devRouter(llm: LlmService | null, buyer: HederaBuyer | null = null): Router {
  const router = Router();

  // The Research Agent buys the market snapshot from this same server, with a real testnet payment.
  router.post("/buy-snapshot", async (req, res) => {
    if (!buyer) throw new AppError(503, "HEDERA_NOT_CONFIGURED", "Hedera is not configured on the server.");
    // Call ourselves on the port this request arrived on (not the Host header, which the client controls).
    const url = `http://127.0.0.1:${req.socket.localPort}${MARKET_SNAPSHOT_PATH}`;
    const { data, receipt } = await buyer.buy(url, {
      taskId: "dev",
      payerAgentId: "research",
      payeeAgentId: MARKET_SNAPSHOT_PAYEE,
    });
    res.json({ data, receipt: receiptToJson(receipt, tinybarsToHbar) });
  });

  // One specialist call. Body: { agentId, instruction, context? }.
  router.post("/infer", async (req, res) => {
    const input = parseBody(specialistInputSchema, req.body);
    if (!llm) throw new AppError(503, "LLM_NOT_CONFIGURED", "The AI provider is not configured on the server.");

    const result = await runSpecialist(llm, input);
    if (!result.success) throw new AppError(result.status, result.code, result.error);
    res.json(result);
  });

  return router;
}
