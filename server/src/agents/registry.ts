import { AGENT_PRICES_TINYBARS } from "../config.js";
import type { AgentCategory } from "../schemas/agent.js";

/**
 * The three MVP specialists (ARCHITECTURE.md section 3). These are the platform-owned listings
 * the seed script writes to Arkiv with the server key.
 *
 * Only public listing fields live here. System instructions are added in B3 in each agent's own
 * file and are never written to Arkiv.
 */
export interface SpecialistListing {
  agentId: "research" | "analyst" | "writer";
  name: string;
  description: string;
  category: AgentCategory;
  skills: string[];
  priceTinybars: bigint;
}

export const SPECIALISTS: readonly SpecialistListing[] = [
  {
    agentId: "research",
    name: "Research Agent",
    description: "Finds and summarizes information on a topic.",
    category: "research",
    skills: ["web research", "summaries", "market data"],
    priceTinybars: AGENT_PRICES_TINYBARS.research,
  },
  {
    agentId: "analyst",
    name: "Data Analyst Agent",
    description: "Compares items and produces structured findings.",
    category: "analysis",
    skills: ["comparison", "structured findings", "pricing analysis"],
    priceTinybars: AGENT_PRICES_TINYBARS.analyst,
  },
  {
    agentId: "writer",
    name: "Report Writer Agent",
    description: "Combines findings into one readable report.",
    category: "writing",
    skills: ["reports", "markdown", "editing"],
    priceTinybars: AGENT_PRICES_TINYBARS.writer,
  },
];
