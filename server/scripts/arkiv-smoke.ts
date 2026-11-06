import { ExpirationTime } from "@arkiv-network/sdk";
import { bootstrapArkiv, fail, runScript } from "./bootstrap.js";

/**
 * Arkiv smoke test: write one real listing with the server key, read it back, print the proof.
 * The listing is clearly labeled and expires after 1 hour, so it does not linger in the marketplace.
 *
 * Run: npm run smoke:arkiv
 */
runScript(async () => {
  const { arkiv, serverAddress } = await bootstrapArkiv();

  const createdAt = Math.floor(Date.now() / 1000);
  const input = {
    agentId: `smoke-test-${createdAt}`,
    category: "other" as const,
    data: {
      name: "Smoke Test Listing",
      description: "Temporary listing written by scripts/arkiv-smoke.ts. Expires after one hour.",
      skills: ["smoke test"],
      priceTinybars: "1",
      currency: "HBAR" as const,
      createdAt,
    },
  };

  const written = await arkiv.createAgentListing(input, { expiration: ExpirationTime.fromHours(1) });
  console.log(`entityKey:  ${written.entityKey}`);
  console.log(`txHash:     ${written.txHash}`);
  console.log(`expiresAt:  block ${written.expiresAt}`);

  const read = await arkiv.getAgent(written.entityKey);
  if (read.status !== "found") fail(`Read-back failed: ${read.status}`);
  console.log(`$owner:     ${read.listing.owner}`);
  console.log(`$creator:   ${read.listing.creator}`);
  console.log(`agentId:    ${read.listing.agentId}`);
  console.log(`name:       ${read.listing.name}`);

  const ownerMatches = read.listing.owner.toLowerCase() === serverAddress.toLowerCase();
  const dataMatches =
    read.listing.agentId === input.agentId &&
    read.listing.name === input.data.name &&
    read.listing.description === input.data.description &&
    read.listing.priceTinybars === input.data.priceTinybars;
  console.log(`$owner equals writing address: ${ownerMatches}`);
  console.log(`read-back matches written data: ${dataMatches}`);
  if (!ownerMatches || !dataMatches) fail("Smoke test FAILED");
  console.log("Smoke test passed");
});
