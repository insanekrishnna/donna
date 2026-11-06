import { addr, bytes, defineSchema, str } from "@arkiv-network/sdk/schema";
import { getAddress, type Hex, hexToBytes } from "viem";
import { z } from "zod";

/**
 * Arkiv entity schemas (ARCHITECTURE.md section 4.1), verified against @arkiv-network/sdk 1.0.1.
 *
 * - A named schema tags each entity with an indexed `arkiv.schema` attribute, and
 *   `select().from(Schema)` filters on it. We store no "type" field of our own.
 * - Indexed `str`/`addr` columns only for fields we filter on. Everything else lives in the
 *   `data` bytes column as UTF-8 JSON, validated with Zod on write and on read.
 * - Owner, creator and expiry come from the SDK system fields `$owner`, `$creator`, `$expiresAt`.
 *
 * This module is shared with the client in B7 (the browser calls createEntity with AgentListing).
 */

export const AgentListing = defineSchema("donna-agent", {
  agentId: str().indexed(),
  category: str().indexed(),
  data: bytes(),
});

export const TaskRecord = defineSchema("donna-task", {
  taskId: str().indexed(),
  status: str().indexed(),
  requesterAddress: addr().indexed().optional(),
  data: bytes(),
});

export const AssignmentRecord = defineSchema("donna-assignment", {
  taskId: str().indexed(),
  agentId: str().indexed(),
  status: str().indexed(),
  data: bytes(),
});

/** Arkiv `str` values are at most 128 UTF-8 bytes (MAX_STRING_BYTES in the SDK). */
export const ARKIV_MAX_STRING_BYTES = 128;

/** Upper bound we allow for one entity's `data` JSON. Far below the SDK's 128 KiB limit. */
export const MAX_DATA_JSON_BYTES = 4096;

// This module is shared with the browser (B7), so it uses TextEncoder/TextDecoder and viem, never Node's Buffer.
const utf8Encoder = new TextEncoder();

export function utf8Bytes(value: string): number {
  return utf8Encoder.encode(value).length;
}

/** Zod string for an Arkiv `str` column: rejects anything over 128 UTF-8 bytes before any write. */
export const arkivStr = z
  .string()
  .refine((v) => utf8Bytes(v) <= ARKIV_MAX_STRING_BYTES, `must be at most ${ARKIV_MAX_STRING_BYTES} bytes`);

/** Entity keys are bytes32 hex. */
export const entityKeySchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be an Arkiv entity key: 0x followed by 64 hex characters");

/**
 * A wallet address, normalized to its EIP-55 checksummed form. Letter case in the input is not
 * trusted (the SDK's addr() rejects a mixed-case address with a wrong checksum), so it is
 * lowercased and re-checksummed here, before it can reach Arkiv.
 */
export const evmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, { error: "must be a wallet address: 0x followed by 40 hex characters", abort: true })
  .transform((v) => getAddress(v.toLowerCase()));

/** Encode a data object for the `data` bytes column. Throws if the JSON is larger than allowed. */
export function encodeDataJson(data: unknown): Uint8Array {
  const json = JSON.stringify(data);
  const bytes = utf8Encoder.encode(json);
  if (bytes.length > MAX_DATA_JSON_BYTES) {
    throw new Error(`Entity data is larger than ${MAX_DATA_JSON_BYTES} bytes`);
  }
  return bytes;
}

/**
 * Decode the `data` column (read back as 0x-hex) into an unknown JSON value.
 * Returns undefined for anything that is not valid hex, valid UTF-8 JSON, or within the size cap.
 * Callers must validate the result with Zod.
 */
export function decodeDataJson(hex: string): unknown {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) return undefined;
  // Check the size from the hex length before decoding, so an oversized value is never copied.
  if ((hex.length - 2) / 2 > MAX_DATA_JSON_BYTES) return undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(hex as Hex));
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
