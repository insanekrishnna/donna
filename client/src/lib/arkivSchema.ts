import { bytes, defineSchema, str } from "@arkiv-network/sdk/schema";

/**
 * The agent listing schema the browser writes with, and the data encoder.
 *
 * This mirrors server/src/schemas/arkiv.ts. It is a copy, not an import, so the client builds
 * on its own (Vercel installs only client/ packages). test/schema.test.ts fails if the two drift.
 */
export const AgentListing = defineSchema("donna-agent", {
  agentId: str().indexed(),
  category: str().indexed(),
  data: bytes(),
});

/** Upper bound for one entity's `data` JSON. Same as the server. */
export const MAX_DATA_JSON_BYTES = 4096;

const utf8Encoder = new TextEncoder();

/** Encode a data object for the `data` bytes column. Throws if the JSON is larger than allowed. */
export function encodeDataJson(data: unknown): Uint8Array {
  const bytesOut = utf8Encoder.encode(JSON.stringify(data));
  if (bytesOut.length > MAX_DATA_JSON_BYTES) {
    throw new Error(`Entity data is larger than ${MAX_DATA_JSON_BYTES} bytes`);
  }
  return bytesOut;
}
