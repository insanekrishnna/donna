import { SPECIALISTS } from "../src/agents/registry.js";
import { bootstrapArkiv, runScript } from "./bootstrap.js";

/**
 * Seed the three platform-owned specialist listings (Research, Data Analyst, Report Writer).
 * Idempotent: a specialist is created only if no valid live listing with its agentId is owned by
 * the server address. Prices come from config, in tinybars.
 *
 * Run: npm run seed
 */
runScript(async () => {
  const { arkiv, serverAddress } = await bootstrapArkiv();

  let created = 0;
  for (const specialist of SPECIALISTS) {
    const existing = await arkiv.findAgent(specialist.agentId, serverAddress);
    if (existing) {
      console.log(`exists   ${specialist.agentId.padEnd(9)} ${existing.entityKey}`);
      continue;
    }
    const written = await arkiv.createAgentListing({
      agentId: specialist.agentId,
      category: specialist.category,
      data: {
        name: specialist.name,
        description: specialist.description,
        skills: specialist.skills,
        priceTinybars: specialist.priceTinybars.toString(),
        currency: "HBAR",
        createdAt: Math.floor(Date.now() / 1000),
      },
    });
    created += 1;
    console.log(`created  ${specialist.agentId.padEnd(9)} ${written.entityKey}  tx ${written.txHash}`);
  }
  console.log(`Seed done: ${created} created, ${SPECIALISTS.length - created} already existed.`);
});
