import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import * as client from "../src/lib/arkivSchema";

/**
 * The client's copy of the listing schema must match the server's exactly, or listings written
 * from the browser would fail the server's checks. Skipped where server/ is not installed
 * (for example, a client-only build on Vercel).
 */
const serverInstalled = existsSync(new URL("../../server/node_modules/@arkiv-network/sdk", import.meta.url));

describe("client Arkiv schema matches the server", { skip: !serverInstalled && "server/ packages are not installed" }, () => {
  it("same schema name, columns, size cap and encoding", async () => {
    const server = await import("../../server/src/schemas/arkiv");
    assert.deepEqual(client.AgentListing.tag, server.AgentListing.tag);
    assert.equal(JSON.stringify(client.AgentListing), JSON.stringify(server.AgentListing));
    assert.equal(client.MAX_DATA_JSON_BYTES, server.MAX_DATA_JSON_BYTES);
    const sample = { name: "Agent", description: "Ünïcode ✓", skills: ["a"], priceTinybars: "5000000", currency: "HBAR", createdAt: 1 };
    assert.deepEqual([...client.encodeDataJson(sample)], [...server.encodeDataJson(sample)]);
    const tooBig = { x: "y".repeat(5000) };
    assert.throws(() => client.encodeDataJson(tooBig));
    assert.throws(() => server.encodeDataJson(tooBig));
  });
});
