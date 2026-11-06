import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createCoordinator } from "../../src/agents/coordinator.js";
import { type Config, ConfigError, loadConfig, loadLocalEnvFile } from "../../src/config.js";
import { createArkivService } from "../../src/integrations/arkiv.js";
import { createHederaBuyer, createMerchantPaywall } from "../../src/integrations/hedera.js";
import { createLlmService } from "../../src/integrations/llm.js";
import { MemoryStore } from "../../src/store/memoryStore.js";
import { startTestServer } from "../helpers.js";

/**
 * End-to-end Coordinator run on the real partners: LLM (OpenRouter), Hedera testnet x402 and
 * Arkiv Rabdi testnet. Nothing is mocked. Run: npm run test:live.
 * Costs one 0.01 testnet HBAR payment, a few small LLM calls and several Arkiv writes.
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
const c = config;
const skip = !c
  ? `config is invalid: ${configProblems.join("; ")}`
  : !(c.LLM_API_KEY && c.LLM_MODEL && c.HEDERA_AGENT_PRIVATE_KEY && c.ARKIV_ACCESS_KEY && c.ARKIV_SERVER_PRIVATE_KEY)
    ? "the LLM, Hedera and Arkiv (with the server key) must all be configured in .env"
    : false;

type View = {
  status: string;
  error: string | null;
  report: string | null;
  budget: Record<string, string | null>;
  steps: { id: string; agentId: string; status: string; llmRequestId: string | null }[];
  receipts: { hederaTxId?: string; hashScanUrl?: string; status: string }[];
  proof: {
    planRequestId: string | null;
    arkiv: {
      taskEntityKey?: string;
      taskTxHash?: string;
      statusTxHashes: { status: string; txHash: string }[];
      assignments: { agentId: string; entityKey: string; txHash: string }[];
    };
  };
};

describe("Coordinator live", { skip }, () => {
  const cfg = config as Config;
  let server: Awaited<ReturnType<typeof startTestServer>>;

  before(async () => {
    const store = new MemoryStore();
    const llm = createLlmService(cfg);
    const arkiv = createArkivService(cfg);
    await arkiv.checkChain();
    const buyer = createHederaBuyer(cfg, store);
    const coordinator = createCoordinator({ store, llm, arkiv, buyer });
    const env = { ...process.env, NODE_ENV: "test" } as Record<string, string>;
    server = await startTestServer(env, arkiv, llm, { store, paywall: createMerchantPaywall(cfg), buyer, coordinator });
  });
  after(async () => {
    await server?.close();
  });

  async function runToEnd(task: string, budgetHbar: string): Promise<View> {
    const res = await fetch(`${server.baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task, budgetHbar }),
    });
    assert.equal(res.status, 202);
    const { taskId } = (await res.json()) as { taskId: string };
    console.log(`  task ${taskId}`);
    let last = "";
    for (let i = 0; i < 150; i += 1) {
      const view = (await (await fetch(`${server.baseUrl}/api/tasks/${taskId}`)).json()) as View;
      const progress = `${view.status} ${view.steps.map((s) => `${s.id}:${s.status}`).join(" ")}`;
      if (progress !== last) console.log(`  ... ${progress}`);
      last = progress;
      if (view.status === "completed" || view.status === "failed") return view;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("task did not finish in 5 minutes");
  }

  it("budget 0.20: completes with a report, and every ID is real", async () => {
    const view = await runToEnd("Compare three AI coding tools on pricing and features.", "0.20");
    assert.equal(view.status, "completed", view.error ?? "");
    assert.ok(view.report && view.report.length > 200, "expected a real report");

    const a = view.proof.arkiv;
    assert.match(a.taskEntityKey ?? "", /^0x[0-9a-f]{64}$/);
    assert.match(a.taskTxHash ?? "", /^0x[0-9a-f]{64}$/);
    assert.deepEqual(a.statusTxHashes.map((s) => s.status), ["running", "completed"]);
    assert.equal(a.assignments.length, view.steps.length);
    assert.ok(view.proof.planRequestId, "plan request ID");
    for (const s of view.steps) assert.ok(s.llmRequestId, `request ID for ${s.id}`);
    const paid = view.receipts.filter((r) => r.status === "settled");
    assert.equal(paid.length, 1, "one real payment");
    assert.match(paid[0]?.hederaTxId ?? "", /^0\.0\.\d+@\d+\.\d+$/);

    console.log(`  budget: ${JSON.stringify(view.budget)}`);
    console.log(`  plan request ID: ${view.proof.planRequestId}`);
    for (const s of view.steps) console.log(`  ${s.id} ${s.agentId}: ${s.llmRequestId}`);
    console.log(`  Hedera tx: ${paid[0]?.hederaTxId}  ${paid[0]?.hashScanUrl}`);
    console.log(`  Arkiv task: ${a.taskEntityKey} (tx ${a.taskTxHash})`);
    for (const s of a.statusTxHashes) console.log(`  Arkiv status ${s.status}: tx ${s.txHash}`);
    for (const x of a.assignments) console.log(`  Arkiv assignment ${x.agentId}: ${x.entityKey}`);
    console.log(`  report starts: "${view.report.slice(0, 100).replace(/\s+/g, " ")}..."`);
  });

  it("budget 0.01: stops before paying and explains why", async () => {
    const view = await runToEnd("Compare three AI coding tools on pricing and features.", "0.01");
    assert.equal(view.status, "failed");
    assert.match(view.error ?? "", /above your budget of 0\.01 HBAR\. Nothing was paid/);
    assert.equal(view.receipts.length, 0);
    assert.equal(view.budget.spentHbar, "0");
    console.log(`  failed as expected: ${view.error}`);
  });
});
