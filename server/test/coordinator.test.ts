import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CoordinatorArkiv, createCoordinator, estimateCostTinybars } from "../src/agents/coordinator.js";
import { AppError } from "../src/errors.js";
import type { HederaBuyer } from "../src/integrations/hedera.js";
import type { CompletionInput, LlmService } from "../src/integrations/llm.js";
import { parsePlan, type Plan } from "../src/schemas/plan.js";
import type { AgentListingView } from "../src/schemas/agent.js";
import { MemoryStore } from "../src/store/memoryStore.js";
import type { TaskRun } from "../src/store/store.js";
import { BASE_TEST_ENV, startTestServer } from "./helpers.js";

/**
 * Coordinator logic with stand-ins for the three partners. Only the partner calls are replaced;
 * the plan validation, budget rules, ordering and failure handling are the real code.
 * The full run against the real LLM, Hedera and Arkiv is in test/live/coordinator.live.test.ts.
 */
const SERVER = "0x" + "a".repeat(40);
const hex64 = (n: number) => "0x" + n.toString(16).padStart(64, "0");

const GOOD_PLAN: Plan = {
  task: "Compare three AI coding tools on pricing and features.",
  subtasks: [
    { id: "s1", agentId: "research", instruction: "Research the tools.", needsPaidData: true },
    { id: "s2", agentId: "analyst", instruction: "Compare them.", dependsOn: ["s1"] },
    { id: "s3", agentId: "writer", instruction: "Write the report.", dependsOn: ["s1", "s2"] },
  ],
  estimatedCost: "about 0.11 HBAR",
};

function fakeLlm(planAnswers: string[]) {
  const calls: CompletionInput[] = [];
  let n = 0;
  const llm: LlmService = {
    async checkModel() {},
    async complete(input) {
      calls.push(input);
      n += 1;
      if (input.system.includes("Coordinator of Donna")) {
        const text = planAnswers.shift();
        if (text === undefined) throw new Error("no more plan answers");
        return { text, requestId: `gen-plan-${n}`, model: "m" };
      }
      const role = /You are the (\w+)/.exec(input.system)?.[1] ?? "x";
      return { text: `Output from ${role}.`, requestId: `gen-${role.toLowerCase()}-${n}`, model: "m" };
    },
  };
  return { llm, calls };
}

function fakeArkiv(missing: string[] = []) {
  const log: string[] = [];
  let k = 0;
  const arkiv: CoordinatorArkiv = {
    serverAddress: SERVER as `0x${string}`,
    async findAgent(agentId) {
      log.push(`find ${agentId}`);
      if (missing.includes(agentId)) return undefined;
      return { entityKey: hex64(100 + agentId.length), owner: SERVER, agentId } as unknown as AgentListingView;
    },
    async writeTaskRecord(input) {
      log.push(`task ${input.status}`);
      k += 1;
      return { entityKey: hex64(k) as `0x${string}`, txHash: hex64(1000 + k) as `0x${string}`, expiresAt: 1n };
    },
    async updateTaskStatus(_key, status) {
      log.push(`status ${status}`);
      k += 1;
      return { txHash: hex64(2000 + k) as `0x${string}` };
    },
    async writeAssignmentRecord(input) {
      log.push(`assignment ${input.agentId} ${input.status}`);
      k += 1;
      return { entityKey: hex64(3000 + k) as `0x${string}`, txHash: hex64(4000 + k) as `0x${string}`, expiresAt: 1n };
    },
  };
  return { arkiv, log };
}

function fakeBuyer(store: MemoryStore, fail = false) {
  const spy = { calls: 0 };
  const buyer: HederaBuyer = {
    async buy(_url, ctx) {
      spy.calls += 1;
      if (fail) throw new AppError(502, "PAYMENT_FAILED", "The payment could not be signed or sent.");
      const receipt = await store.addReceipt({
        ...ctx,
        amountTinybars: 1_000_000n,
        hederaTxId: "0.0.9185802@1794000000.1",
        hashScanUrl: "https://hashscan.io/testnet/transaction/0.0.9185802@1794000000.1",
        status: "settled",
        createdAt: Date.now(),
      });
      return { data: { label: "snapshot data" }, receipt };
    },
  };
  return { buyer, spy };
}

async function runTask(opts: {
  planAnswers: string[];
  budget?: bigint;
  missing?: string[];
  buyerFails?: boolean;
  agentIds?: ("research" | "analyst" | "writer")[];
  llmOverride?: LlmService;
}) {
  const store = new MemoryStore();
  const { llm, calls } = fakeLlm(opts.planAnswers);
  const { arkiv, log } = fakeArkiv(opts.missing);
  const { buyer, spy } = fakeBuyer(store, opts.buyerFails);
  const coordinator = createCoordinator({ store, llm: opts.llmOverride ?? llm, arkiv, buyer });
  const budget = opts.budget ?? 20_000_000n;
  const task: TaskRun = {
    id: "3f1c9a52-0000-4000-8000-000000000001",
    task: "Compare three AI coding tools on pricing and features.",
    agentIds: opts.agentIds ?? ["research", "analyst", "writer"],
    status: "planning",
    budgetCapTinybars: budget,
    steps: [],
    arkiv: { statusTxHashes: [], assignments: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await store.createLedger(task.id, budget);
  await store.saveTask(task);
  const result = await coordinator.run(task, "http://127.0.0.1:1/api/services/market-snapshot");
  return { result, store, calls, log, spy };
}

describe("plan validation", () => {
  const all = ["research", "analyst", "writer"] as const;

  it("accepts a good plan, including one wrapped in a ```json fence", () => {
    assert.ok(parsePlan(JSON.stringify(GOOD_PLAN), all).ok);
    assert.ok(parsePlan("Here you go:\n```json\n" + JSON.stringify(GOOD_PLAN) + "\n```", all).ok);
  });

  it("rejects non-JSON, wrong shapes and broken rules with clear reasons", () => {
    const bad = (p: unknown) => {
      const r = parsePlan(typeof p === "string" ? p : JSON.stringify(p), all);
      assert.equal(r.ok, false);
      return r.ok ? "" : r.problem;
    };
    assert.match(bad("I cannot help with that."), /not valid JSON/);
    assert.match(bad({ task: "x", subtasks: [] }), /subtasks/);
    assert.match(bad({ ...GOOD_PLAN, subtasks: [...GOOD_PLAN.subtasks, ...GOOD_PLAN.subtasks] }), /at most 4/);
    assert.match(bad({ ...GOOD_PLAN, subtasks: [{ ...GOOD_PLAN.subtasks[0], agentId: "hacker" }] }), /agentId/);
    assert.match(bad({ ...GOOD_PLAN, subtasks: GOOD_PLAN.subtasks.slice(0, 2) }), /exactly one writer/);
    assert.match(
      bad({ ...GOOD_PLAN, subtasks: [GOOD_PLAN.subtasks[2], GOOD_PLAN.subtasks[0]] }),
      /depends on s1, which is not an earlier subtask|writer subtask must be last/,
    );
    assert.match(
      bad({ ...GOOD_PLAN, subtasks: [GOOD_PLAN.subtasks[0], { ...GOOD_PLAN.subtasks[1], needsPaidData: true }, GOOD_PLAN.subtasks[2]] }),
      /only a research subtask can use paid data/,
    );
    const onlyWriter = parsePlan(JSON.stringify(GOOD_PLAN), ["writer"]);
    assert.equal(onlyWriter.ok, false);
    if (!onlyWriter.ok) assert.match(onlyWriter.problem, /was not selected/);
  });

  it("the server computes cost from config prices, not the model's estimate", () => {
    assert.equal(estimateCostTinybars({ ...GOOD_PLAN, estimatedCost: "free!" }), 11_000_000n); // 0.05+0.03+0.02+0.01
  });
});

describe("Coordinator", () => {
  it("runs plan -> pay -> specialists -> report, with every ID from the partner responses", async () => {
    const { result, store, calls, log, spy } = await runTask({ planAnswers: [JSON.stringify(GOOD_PLAN)] });
    assert.equal(result.status, "completed", result.error ?? "");
    assert.equal(result.report, "Output from Report.");
    assert.equal(result.planRequestId, "gen-plan-1");
    assert.deepEqual(
      result.steps.map((s) => [s.id, s.status, s.llmRequestId]),
      [
        ["s1", "done", "gen-research-2"],
        ["s2", "done", "gen-data-3"],
        ["s3", "done", "gen-report-4"],
      ],
    );
    assert.equal(spy.calls, 1);
    assert.equal(result.estimatedCostTinybars, 11_000_000n);
    assert.equal((await store.getLedger(result.id))?.spentTinybars, 1_000_000n);
    assert.equal((await store.listReceipts(result.id))[0]?.hederaTxId, "0.0.9185802@1794000000.1");

    // The analyst gets the paid snapshot and the research output; the writer gets everything earlier.
    assert.match(calls[2]?.user ?? "", /Paid market snapshot[\s\S]*snapshot data[\s\S]*Output from Research/);
    assert.match(calls[3]?.user ?? "", /Output from Research[\s\S]*Output from Data/);
    assert.doesNotMatch(calls[3]?.user ?? "", /Paid market snapshot/);

    assert.deepEqual(log, [
      "task planning",
      "find research",
      "find analyst",
      "find writer",
      "status running",
      "assignment research done",
      "assignment analyst done",
      "assignment writer done",
      "status completed",
    ]);
    assert.equal(result.arkiv.assignments.length, 3);
    assert.deepEqual(result.arkiv.statusTxHashes.map((s) => s.status), ["running", "completed"]);
  });

  it("a corrupted plan is rejected by Zod, retried once, then the task fails cleanly", async () => {
    const corrupted = JSON.stringify({ task: "x", subtasks: [{ id: "s1", agentId: "hacker", instruction: "rm -rf" }] });
    const { result, store, log, spy } = await runTask({ planAnswers: [corrupted, corrupted] });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /Planning failed after 2 attempts\. The plan was invalid: .*agentId/);
    assert.equal(result.steps.length, 0);
    assert.equal(spy.calls, 0, "nothing paid");
    assert.deepEqual(log, ["task planning", "status failed"]);
    const execs = await store.listExecutions(result.id);
    assert.deepEqual(
      execs.map((e) => [e.step, e.status]),
      [
        ["plan-1", "failed"],
        ["plan-2", "failed"],
      ],
    );
  });

  it("retries planning once and continues when the second plan is valid", async () => {
    const { result } = await runTask({ planAnswers: ["not json", JSON.stringify(GOOD_PLAN)] });
    assert.equal(result.status, "completed", result.error ?? "");
    assert.equal(result.planRequestId, "gen-plan-2");
  });

  it("budget 0.01 HBAR: stops before paying and explains why", async () => {
    const { result, store, spy, log } = await runTask({ planAnswers: [JSON.stringify(GOOD_PLAN)], budget: 1_000_000n });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /costs 0\.11 HBAR, which is above your budget of 0\.01 HBAR\. Nothing was paid/);
    assert.equal(spy.calls, 0);
    assert.equal((await store.getLedger(result.id))?.spentTinybars, 0n);
    assert.equal(log.at(-1), "status failed");
    assert.ok(result.steps.every((s) => s.status === "pending"));
  });

  it("fails when a planned agent is not listed on Arkiv", async () => {
    const { result, spy } = await runTask({ planAnswers: [JSON.stringify(GOOD_PLAN)], missing: ["analyst"] });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /analyst agent is not listed on Arkiv/);
    assert.equal(spy.calls, 0);
  });

  it("a failed payment fails the task, gives the budget back and runs no agents", async () => {
    const { result, store, calls } = await runTask({ planAnswers: [JSON.stringify(GOOD_PLAN)], buyerFails: true });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /Buying market data failed/);
    assert.equal((await store.getLedger(result.id))?.spentTinybars, 0n);
    assert.equal(calls.length, 1, "only the planning call ran");
  });

  it("a failed specialist fails the task, with no report and a failed assignment on Arkiv", async () => {
    const { llm } = fakeLlm([JSON.stringify(GOOD_PLAN)]);
    const failing: LlmService = {
      ...llm,
      async complete(input) {
        if (input.system.includes("Data Analyst")) {
          throw new AppError(502, "LLM_NO_CREDITS", "The AI provider account has no credits left for this model.");
        }
        return llm.complete(input);
      },
    };
    const { result, log } = await runTask({ planAnswers: [], llmOverride: failing });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /Step s2 \(analyst\) failed: .*no credits/);
    assert.equal(result.report, undefined);
    assert.deepEqual(
      result.steps.map((s) => s.status),
      ["done", "failed", "pending"],
    );
    assert.ok(log.includes("assignment analyst failed"));
    assert.equal(log.at(-1), "status failed");
  });
});

describe("Coordinator Arkiv writes", () => {
  it("never overlap, even with two tasks running at once (one server key, one nonce)", async () => {
    const store = new MemoryStore();
    const { arkiv } = fakeArkiv();
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
      async (...a: A): Promise<R> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        try {
          return await fn(...a);
        } finally {
          inFlight -= 1;
        }
      };
    const tracked: CoordinatorArkiv = {
      ...arkiv,
      writeTaskRecord: slow(arkiv.writeTaskRecord),
      updateTaskStatus: slow(arkiv.updateTaskStatus),
      writeAssignmentRecord: slow(arkiv.writeAssignmentRecord),
    };
    const { llm } = fakeLlm([JSON.stringify(GOOD_PLAN), JSON.stringify(GOOD_PLAN)]);
    const { buyer } = fakeBuyer(store);
    const coordinator = createCoordinator({ store, llm, arkiv: tracked, buyer });
    const make = (n: number): TaskRun => ({
      id: `3f1c9a52-0000-4000-8000-00000000000${n}`,
      task: "Compare three AI coding tools.",
      agentIds: ["research", "analyst", "writer"],
      status: "planning",
      budgetCapTinybars: 20_000_000n,
      steps: [],
      arkiv: { statusTxHashes: [], assignments: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    for (const n of [1, 2]) await store.createLedger(make(n).id, 20_000_000n);
    const [a, b] = await Promise.all([coordinator.run(make(1), "http://x"), coordinator.run(make(2), "http://x")]);
    assert.equal(a.status, "completed", a.error ?? "");
    assert.equal(b.status, "completed", b.error ?? "");
    assert.equal(maxInFlight, 1);
  });
});

describe("/api/tasks routes", () => {
  const post = (base: string, body: unknown) =>
    fetch(`${base}/api/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("validates the body before anything else", async () => {
    const server = await startTestServer(BASE_TEST_ENV);
    try {
      const res = await post(server.baseUrl, { task: "short", budgetHbar: "0", agentIds: ["hacker"] });
      assert.equal(res.status, 400);
      const { error } = (await res.json()) as { error: string };
      assert.match(error, /task must be at least 10 characters/);
      assert.match(error, /budgetHbar must be more than 0/);
      assert.match(error, /agentIds/);
    } finally {
      await server.close();
    }
  });

  it("returns 503 when the partners are not configured, and 404 for an unknown task", async () => {
    const server = await startTestServer(BASE_TEST_ENV);
    try {
      const res = await post(server.baseUrl, { task: "Compare three AI coding tools.", budgetHbar: "0.20" });
      assert.equal(res.status, 503);
      assert.equal(((await res.json()) as { code: string }).code, "TASKS_NOT_CONFIGURED");
      const missing = await fetch(`${server.baseUrl}/api/tasks/3f1c9a52-0000-4000-8000-000000000999`);
      assert.equal(missing.status, 404);
      assert.equal((await fetch(`${server.baseUrl}/api/tasks/not-a-uuid`)).status, 404);
    } finally {
      await server.close();
    }
  });

  it("POST starts a task and GET polls it to completion", async () => {
    const store = new MemoryStore();
    const { llm } = fakeLlm([JSON.stringify(GOOD_PLAN)]);
    const { arkiv } = fakeArkiv();
    const { buyer } = fakeBuyer(store);
    const coordinator = createCoordinator({ store, llm, arkiv, buyer });
    const server = await startTestServer(BASE_TEST_ENV, null, null, { store, coordinator });
    try {
      const res = await post(server.baseUrl, { task: "Compare three AI coding tools.", budgetHbar: "0.20" });
      assert.equal(res.status, 202);
      const { taskId } = (await res.json()) as { taskId: string };
      let view: { status: string; report: string | null; budget: Record<string, string>; receipts: unknown[] } | undefined;
      for (let i = 0; i < 50; i += 1) {
        view = (await (await fetch(`${server.baseUrl}/api/tasks/${taskId}`)).json()) as typeof view;
        if (view?.status === "completed" || view?.status === "failed") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(view?.status, "completed");
      assert.equal(view?.report, "Output from Report.");
      assert.deepEqual(view?.budget, { capHbar: "0.2", estimatedCostHbar: "0.11", spentHbar: "0.01", remainingHbar: "0.19" });
      assert.equal(view?.receipts.length, 1);
    } finally {
      await server.close();
    }
  });
});
