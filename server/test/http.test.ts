import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BASE_TEST_ENV, FAKE_CREDENTIALS, startTestServer } from "./helpers.js";

describe("GET /api/health", () => {
  it("returns ok and lists every partner group when none is configured", async () => {
    const server = await startTestServer(BASE_TEST_ENV);
    try {
      const res = await fetch(`${server.baseUrl}/api/health`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: "ok", missing: ["0G", "Hedera", "Arkiv"] });
    } finally {
      await server.close();
    }
  });

  it("returns an empty missing list and never contains any env value", async () => {
    const env = { ...BASE_TEST_ENV, ...FAKE_CREDENTIALS };
    const server = await startTestServer(env);
    try {
      const res = await fetch(`${server.baseUrl}/api/health`);
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(text), { status: "ok", missing: [] });
      for (const [name, value] of Object.entries(env)) {
        if (["test", "hedera:testnet"].includes(value)) continue; // too generic to search for
        assert.ok(!text.includes(value), `health response must not contain the value of ${name}`);
      }
    } finally {
      await server.close();
    }
  });
});

describe("errors and CORS", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    server = await startTestServer(BASE_TEST_ENV);
  });
  after(async () => {
    await server.close();
  });

  it("returns 404 in the error shape for an unknown route", async () => {
    const res = await fetch(`${server.baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "This route does not exist.", code: "NOT_FOUND" });
  });

  it("returns 400 in the error shape for malformed JSON, with no stack trace", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const text = await res.text();
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(text), { error: "The request body is not valid JSON.", code: "INVALID_JSON" });
    assert.ok(!text.includes(" at "), "response must not contain a stack trace");
  });

  it("allows only CLIENT_ORIGIN", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`, { headers: { origin: "https://evil.example" } });
    assert.equal(res.headers.get("access-control-allow-origin"), BASE_TEST_ENV.CLIENT_ORIGIN);
    assert.equal(res.headers.get("x-powered-by"), null);
  });
});
