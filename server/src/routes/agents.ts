import { Router } from "express";
import type { ArkivService } from "../integrations/arkiv.js";
import { AppError } from "../errors.js";
import { normalizeAgentInput, prepareAgentBodySchema, verifyAgentBodySchema } from "../schemas/agent.js";
import { parseBody } from "./validate.js";

/**
 * /api/agents routes (ARCHITECTURE.md section 5).
 * `arkiv` is null when ARKIV_ACCESS_KEY is not set; the routes that read Arkiv then return 503.
 */
export function agentsRouter(arkiv: ArkivService | null): Router {
  const router = Router();

  function requireArkiv(): ArkivService {
    if (!arkiv) throw new AppError(503, "ARKIV_NOT_CONFIGURED", "Arkiv is not configured on the server.");
    return arkiv;
  }

  router.get("/", async (_req, res) => {
    const { agents, skippedCount, truncated } = await requireArkiv().listAgents();
    res.json({ agents, skippedCount, truncated });
  });

  // Validates and normalizes listing fields. It never writes and never builds a transaction:
  // the browser wallet calls createEntity itself, so the creator is the owner (B7).
  router.post("/prepare", (req, res) => {
    const body = parseBody(prepareAgentBodySchema, req.body);
    const listing = normalizeAgentInput(body, Math.floor(Date.now() / 1000));
    res.json({ listing });
  });

  router.post("/verify", async (req, res) => {
    const { entityKey, address } = parseBody(verifyAgentBodySchema, req.body);
    const result = await requireArkiv().getAgent(entityKey);
    if (result.status === "not_found") {
      throw new AppError(404, "AGENT_NOT_FOUND", "No live agent listing has this entity key. It may not exist or may have expired.");
    }
    if (result.status === "invalid") {
      throw new AppError(422, "INVALID_LISTING", "This entity is not a valid Donna agent listing.");
    }
    if (result.listing.owner.toLowerCase() !== address.toLowerCase()) {
      throw new AppError(403, "OWNER_MISMATCH", "This listing is owned by a different address than the one connected.");
    }
    res.json({ verified: true, listing: result.listing });
  });

  return router;
}
