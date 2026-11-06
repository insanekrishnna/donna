import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BASE_TEST_ENV, startTestServer } from "./helpers.js";

/** Route behavior that does not depend on Arkiv. Owner verification against real entities is in test/live/. */
describe("/api/agents without Arkiv configured", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    server = await startTestServer(BASE_TEST_ENV, null);
  });
  after(async () => {
    await server.close();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("GET /api/agents returns 503 in the error shape", async () => {
    const res = await fetch(`${server.baseUrl}/api/agents`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "Arkiv is not configured on the server.", code: "ARKIV_NOT_CONFIGURED" });
  });

  it("POST /api/agents/prepare returns normalized fields and writes nothing", async () => {
    const res = await post("/api/agents/prepare", {
      name: "Research Helper",
      description: "Summarizes sources.",
      category: "research",
      skills: ["summaries"],
      pricePerTask: "0.05",
    });
    assert.equal(res.status, 200);
    const { listing } = (await res.json()) as { listing: Record<string, unknown> & { data: Record<string, unknown> } };
    assert.equal(listing.agentId, "research-helper");
    assert.equal(listing.category, "research");
    assert.equal(listing.data.priceTinybars, "5000000");
    assert.equal(listing.data.currency, "HBAR");
    assert.ok(!("owner" in listing.data) && !("creatorAddress" in listing.data) && !("expiresAt" in listing.data));
  });

  it("POST /api/agents/prepare blocks an empty name and 9 skills with clear messages", async () => {
    const res = await post("/api/agents/prepare", {
      name: "",
      description: "Does things.",
      category: "research",
      skills: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      pricePerTask: "0.05",
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(body.code, "INVALID_INPUT");
    assert.match(body.error, /name: must be at least 3 characters/);
    assert.match(body.error, /skills: must have at most 6 skills/);
  });

  it("POST /api/agents/prepare rejects unknown fields, a bad category and a bad price", async () => {
    const res = await post("/api/agents/prepare", {
      name: "Valid Name",
      description: "Does things.",
      category: "crypto",
      skills: [],
      pricePerTask: "free",
      owner: "0x" + "1".repeat(40),
    });
    assert.equal(res.status, 400);
    const { error } = (await res.json()) as { error: string };
    assert.match(error, /category: must be one of/);
    assert.match(error, /pricePerTask: must be a decimal HBAR amount/);
    assert.match(error, /Unrecognized key/);
  });

  it("POST /api/agents/prepare names agentId when no slug can be made from the name", async () => {
    const res = await post("/api/agents/prepare", {
      name: "日本語の名前",
      description: "Does things.",
      category: "research",
      skills: [],
      pricePerTask: "0.05",
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(body.code, "INVALID_INPUT");
    assert.match(body.error, /^agentId: could not be made from the name/);
  });

  it("POST /api/agents/verify validates the body before touching Arkiv", async () => {
    const res = await post("/api/agents/verify", { entityKey: "0x123", address: "not-an-address" });
    assert.equal(res.status, 400);
    const { error, code } = (await res.json()) as { error: string; code: string };
    assert.equal(code, "INVALID_INPUT");
    assert.match(error, /entityKey: must be an Arkiv entity key/);
    assert.match(error, /address: must be a wallet address/);
  });

  it("POST /api/agents/verify returns 503 when Arkiv is not configured", async () => {
    const res = await post("/api/agents/verify", { entityKey: "0x" + "a".repeat(64), address: "0x" + "1".repeat(40) });
    assert.equal(res.status, 503);
  });
});
