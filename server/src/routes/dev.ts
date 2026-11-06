import { Router } from "express";
import { runSpecialist, specialistInputSchema } from "../agents/runSpecialist.js";
import { AppError } from "../errors.js";
import type { LlmService } from "../integrations/llm.js";
import { parseBody } from "./validate.js";

/**
 * Dev-only routes. createApp mounts this router only when NODE_ENV is not "production",
 * so in production these paths fall through to the 404 handler.
 * `llm` is null when LLM_API_KEY or LLM_MODEL is not set.
 */
export function devRouter(llm: LlmService | null): Router {
  const router = Router();

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
