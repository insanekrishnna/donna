import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildUserMessage, runSpecialist } from "../src/agents/runSpecialist.js";
import { loadConfig } from "../src/config.js";
import { AppError } from "../src/errors.js";
import { createLlmService } from "../src/integrations/llm.js";
import { BASE_TEST_ENV, FAKE_CREDENTIALS, startTestServer } from "./helpers.js";

/**
 * Unit tests against a local stand-in for an OpenAI-compatible provider. They check our own
 * handling (validation, retry, timeout, error mapping); the real provider is tested in test/live/.
 */
type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

let handler: Handler;
let requests: { path: string; auth: string | undefined; body: string }[] = [];
let fakeBaseUrl: string;
const fake = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requests.push({ path: req.url ?? "", auth: req.headers.authorization, body });
    handler(req, body, res);
  });
});

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

const completion = (content: string | null, id = "gen-test-123") => ({
  id,
  object: "chat.completion",
  model: "test-model-placeholder",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
});

before(async () => {
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  fakeBaseUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
});
after(() => new Promise<void>((resolve) => fake.close(() => resolve())));
/** The i-th request the fake provider received. Fails the test if there is none. */
function req(i: number) {
  const r = requests[i];
  assert.ok(r, `expected request #${i + 1}`);
  return r;
}

beforeEach(() => {
  requests = [];
});

const env = () => ({ ...BASE_TEST_ENV, ...FAKE_CREDENTIALS, LLM_BASE_URL: fakeBaseUrl });
const service = (timeoutMs?: number) => createLlmService(loadConfig(env()), { timeoutMs });

async function rejectsWithCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof AppError, "expected an AppError");
    assert.equal(err.code, code);
    assert.ok(!err.message.includes(FAKE_CREDENTIALS.LLM_API_KEY), "error must not contain the API key");
    return true;
  });
}

describe("LLM service", () => {
  it("returns the text and the real completion id, and sends the model and key", async () => {
    handler = (_req, _body, res) => json(res, 200, completion("  An answer.  "));
    const out = await service().complete({ system: "sys", user: "hello" });
    assert.deepEqual(out, { text: "An answer.", requestId: "gen-test-123", model: "test-model-placeholder" });
    assert.equal(requests.length, 1);
    assert.equal(req(0).path, "/v1/chat/completions");
    assert.equal(req(0).auth, `Bearer ${FAKE_CREDENTIALS.LLM_API_KEY}`);
    const sent = JSON.parse(req(0).body);
    assert.equal(sent.model, FAKE_CREDENTIALS.LLM_MODEL);
    assert.deepEqual(sent.messages, [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ]);
  });

  it("reports a null requestId when the provider sends no id, never an invented one", async () => {
    handler = (_req, _body, res) => {
      const { id: _id, ...noId } = completion("Text.");
      json(res, 200, noId);
    };
    const out = await service().complete({ system: "s", user: "u" });
    assert.equal(out.requestId, null);
  });

  it("retries once after a 500, then succeeds", async () => {
    let calls = 0;
    handler = (_req, _body, res) => (++calls === 1 ? json(res, 500, { error: "boom" }) : json(res, 200, completion("ok")));
    const out = await service().complete({ system: "s", user: "u" });
    assert.equal(out.text, "ok");
    assert.equal(requests.length, 2);
  });

  it("gives up after one retry and returns a plain-language error", async () => {
    handler = (_req, _body, res) => json(res, 500, { error: { message: "internal secret detail" } });
    await rejectsWithCode(service().complete({ system: "s", user: "u" }), "LLM_ERROR");
    assert.equal(requests.length, 2);
  });

  it("maps 401, 402 and 404 to clear errors without retrying", async () => {
    for (const [status, code] of [
      [401, "LLM_AUTH_FAILED"],
      [402, "LLM_NO_CREDITS"],
      [404, "LLM_MODEL_NOT_FOUND"],
    ] as const) {
      requests = [];
      handler = (_req, _body, res) => json(res, status, { error: { message: "nope" } });
      await rejectsWithCode(service().complete({ system: "s", user: "u" }), code);
      assert.equal(requests.length, 1, `HTTP ${status} must not be retried`);
    }
  });

  it("rejects a response with no choices or an empty answer", async () => {
    handler = (_req, _body, res) => json(res, 200, { id: "gen-x", choices: [] });
    await rejectsWithCode(service().complete({ system: "s", user: "u" }), "LLM_BAD_RESPONSE");
    handler = (_req, _body, res) => json(res, 200, completion("   "));
    await rejectsWithCode(service().complete({ system: "s", user: "u" }), "LLM_EMPTY_RESPONSE");
    handler = (_req, _body, res) => json(res, 200, completion(null));
    await rejectsWithCode(service().complete({ system: "s", user: "u" }), "LLM_EMPTY_RESPONSE");
  });

  it("times out, retries once, then reports LLM_TIMEOUT", async () => {
    handler = () => {
      /* never answer */
    };
    await rejectsWithCode(service(200).complete({ system: "s", user: "u" }), "LLM_TIMEOUT");
    assert.equal(requests.length, 2);
  });

  it("reports LLM_UNREACHABLE when nothing is listening", async () => {
    const cfg = loadConfig({ ...env(), LLM_BASE_URL: "http://127.0.0.1:1/v1" });
    await rejectsWithCode(createLlmService(cfg).complete({ system: "s", user: "u" }), "LLM_UNREACHABLE");
  });

  it("checkModel passes when LLM_MODEL is listed and fails clearly when it is not", async () => {
    handler = (_req, _body, res) =>
      json(res, 200, { object: "list", data: [{ id: "other/model", object: "model", created: 0, owned_by: "x" }] });
    await rejectsWithCode(service().checkModel(), "LLM_MODEL_NOT_FOUND");
    handler = (_req, _body, res) =>
      json(res, 200, {
        object: "list",
        data: [{ id: FAKE_CREDENTIALS.LLM_MODEL, object: "model", created: 0, owned_by: "x" }],
      });
    await service().checkModel();
    assert.equal(requests.at(-1)?.path, "/v1/models");
  });

  it("refuses to build without a key or model", () => {
    assert.throws(
      () => createLlmService(loadConfig(BASE_TEST_ENV)),
      (err: unknown) => err instanceof AppError && err.code === "LLM_NOT_CONFIGURED",
    );
  });
});

describe("runSpecialist", () => {
  it("uses the agent's own instructions and returns success with the request id", async () => {
    handler = (_req, _body, res) => json(res, 200, completion("Findings."));
    const out = await runSpecialist(service(), { agentId: "analyst", instruction: "Compare A and B.", context: "A is 1. B is 2." });
    assert.deepEqual(out, {
      success: true,
      agentId: "analyst",
      result: "Findings.",
      requestId: "gen-test-123",
      model: "test-model-placeholder",
    });
    const sent = JSON.parse(req(0).body);
    assert.match(sent.messages[0].content, /Data Analyst Agent/);
    assert.equal(sent.messages[1].content, buildUserMessage("Compare A and B.", "A is 1. B is 2."));
  });

  it("returns success: false with a clear error when the provider fails, with no result text", async () => {
    handler = (_req, _body, res) => json(res, 401, { error: { message: "bad key" } });
    const out = await runSpecialist(service(), { agentId: "writer", instruction: "Write it." });
    assert.equal(out.success, false);
    assert.ok(!("result" in out));
    if (!out.success) assert.equal(out.code, "LLM_AUTH_FAILED");
  });

  it("each specialist has distinct instructions", async () => {
    const prompts = new Set<string>();
    for (const agentId of ["research", "analyst", "writer"] as const) {
      requests = [];
      handler = (_req, _body, res) => json(res, 200, completion("x"));
      await runSpecialist(service(), { agentId, instruction: "Go." });
      prompts.add(JSON.parse(req(0).body).messages[0].content);
    }
    assert.equal(prompts.size, 3);
  });
});

describe("POST /api/dev/infer", () => {
  const post = (baseUrl: string, body: unknown) =>
    fetch(`${baseUrl}/api/dev/infer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns the specialist result with the request id", async () => {
    handler = (_req, _body, res) => json(res, 200, completion("Two paragraphs."));
    const server = await startTestServer(env(), null, service());
    try {
      const res = await post(server.baseUrl, { agentId: "research", instruction: "Research X." });
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.success, true);
      assert.equal(body.result, "Two paragraphs.");
      assert.equal(body.requestId, "gen-test-123");
    } finally {
      await server.close();
    }
  });

  it("returns 503 LLM_NOT_CONFIGURED when the API key is missing, not a fake answer", async () => {
    const server = await startTestServer(BASE_TEST_ENV, null, null);
    try {
      const res = await post(server.baseUrl, { agentId: "research", instruction: "Research X." });
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), {
        error: "The AI provider is not configured on the server.",
        code: "LLM_NOT_CONFIGURED",
      });
    } finally {
      await server.close();
    }
  });

  it("passes provider failures through as the error shape", async () => {
    handler = (_req, _body, res) => json(res, 401, { error: { message: "bad key" } });
    const server = await startTestServer(env(), null, service());
    try {
      const res = await post(server.baseUrl, { agentId: "research", instruction: "Research X." });
      assert.equal(res.status, 502);
      assert.equal(((await res.json()) as { code: string }).code, "LLM_AUTH_FAILED");
    } finally {
      await server.close();
    }
  });

  it("validates the body", async () => {
    const server = await startTestServer(env(), null, service());
    try {
      const res = await post(server.baseUrl, { agentId: "hacker", instruction: "", extra: 1 });
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as { code: string }).code, "INVALID_INPUT");
      assert.equal(requests.length, 0, "no provider call on invalid input");
    } finally {
      await server.close();
    }
  });

  it("is not available in production", async () => {
    const server = await startTestServer({ ...env(), NODE_ENV: "production" }, null, service());
    try {
      const res = await post(server.baseUrl, { agentId: "research", instruction: "Research X." });
      assert.equal(res.status, 404);
      assert.equal(((await res.json()) as { code: string }).code, "NOT_FOUND");
      assert.equal(requests.length, 0);
    } finally {
      await server.close();
    }
  });
});
