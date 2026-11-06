import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runSpecialist } from "../../src/agents/runSpecialist.js";
import { type Config, ConfigError, loadConfig, loadLocalEnvFile } from "../../src/config.js";
import { AppError } from "../../src/errors.js";
import { createLlmService } from "../../src/integrations/llm.js";
import { startTestServer } from "../helpers.js";

/**
 * Live tests against the real LLM provider (LLM_BASE_URL). Nothing is mocked.
 * Run: npm run test:live. Skipped when LLM_API_KEY or LLM_MODEL is absent.
 * Each run makes two small paid completions. Logs print the request ID and model only, never the key.
 */
loadLocalEnvFile();
let configProblems: string[] = [];
const config: Config | undefined = (() => {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) configProblems = err.problems;
    else throw err;
    return undefined;
  }
})();
const skip = !config
  ? `config is invalid: ${configProblems.join("; ")}`
  : !config.LLM_API_KEY || !config.LLM_MODEL
    ? "LLM_API_KEY and LLM_MODEL must be set in .env"
    : false;

describe("LLM live", { skip }, () => {
  const cfg = config as Config;

  it("LLM_MODEL is offered by the provider", async () => {
    await createLlmService(cfg).checkModel();
  });

  it("POST /api/dev/infer returns real text and a real request ID", async () => {
    const server = await startTestServer({ ...process.env, NODE_ENV: "test" } as Record<string, string>, null, createLlmService(cfg));
    try {
      const res = await fetch(`${server.baseUrl}/api/dev/infer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "research", instruction: "Research the Indian EV market in two paragraphs." }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
      assert.equal(body.success, true);
      assert.equal(body.agentId, "research");
      assert.ok(typeof body.result === "string" && body.result.length > 200, "expected a real answer");
      assert.ok(typeof body.requestId === "string" && body.requestId.length > 0, "expected a request ID from the provider");
      console.log(`  requestId: ${body.requestId}`);
      console.log(`  model:     ${body.model}`);
      console.log(`  answer:    ${(body.result as string).length} chars, starts "${(body.result as string).slice(0, 80).replace(/\s+/g, " ")}..."`);
    } finally {
      await server.close();
    }
  });

  it("a wrong API key gives a clear error, not a fake answer", async () => {
    const bad = createLlmService({ ...cfg, LLM_API_KEY: "sk-or-v1-" + "0".repeat(64) });
    const out = await runSpecialist(bad, { agentId: "research", instruction: "Say hi." });
    assert.equal(out.success, false);
    assert.ok(!("result" in out));
    if (!out.success) {
      assert.equal(out.code, "LLM_AUTH_FAILED");
      console.log(`  wrong key -> ${out.code}: ${out.error}`);
    }
  });

  it("a missing API key is refused before any call", () => {
    assert.throws(
      () => createLlmService({ ...cfg, LLM_API_KEY: undefined }),
      (err: unknown) => err instanceof AppError && err.code === "LLM_NOT_CONFIGURED",
    );
  });
});
