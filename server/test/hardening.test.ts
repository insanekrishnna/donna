import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import { type Coordinator, createCoordinator } from "../src/agents/coordinator.js";
import { AppError } from "../src/errors.js";
import type { LlmService } from "../src/integrations/llm.js";
import { rateLimit } from "../src/rateLimit.js";
import { MemoryStore } from "../src/store/memoryStore.js";
import { BASE_TEST_ENV, FAKE_CREDENTIALS, startTestServer } from "./helpers.js";

/** B6: input limits, rate limits, task concurrency cap, dev routes off in production. */

const post = (base: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A Coordinator stand-in that records starts and never runs anything. */
function stubCoordinator(): Coordinator & { starts: number } {
  const stub = {
    starts: 0,
    async start() {
      stub.starts += 1;
      return { id: "3f1c9a52-0000-4000-8000-000000000001", status: "planning" } as never;
    },
    async run() {
      throw new Error("not used");
    },
  };
  return stub;
}

describe("input limits", () => {
  it("oversized fields return 400 on every POST route", async () => {
    const server = await startTestServer({ ...BASE_TEST_ENV, ...FAKE_CREDENTIALS }, null, null, {
      coordinator: stubCoordinator(),
    });
    const long = (n: number) => "x".repeat(n);
    try {
      const cases: [string, unknown][] = [
        ["/api/tasks", { task: long(2001), budgetHbar: "0.2" }],
        ["/api/agents/prepare", { name: long(41), description: "d", category: "research", skills: ["a"], pricePerTask: "0.05" }],
        ["/api/agents/prepare", { name: "Agent", description: long(281), category: "research", skills: ["a"], pricePerTask: "0.05" }],
        ["/api/agents/prepare", { name: "Agent", description: "d", category: "research", skills: [long(25)], pricePerTask: "0.05" }],
        ["/api/agents/verify", { entityKey: "0x" + "a".repeat(200), address: "0x" + "b".repeat(40) }],
        ["/api/dev/infer", { agentId: "research", instruction: long(4001) }],
        ["/api/dev/infer", { agentId: "research", instruction: "ok", context: long(20_001) }],
      ];
      for (const [path, body] of cases) {
        const res = await post(server.baseUrl, path, body);
        assert.equal(res.status, 400, `${path} should reject an oversized field`);
        assert.equal(((await res.json()) as { code: string }).code, "INVALID_INPUT");
      }
    } finally {
      await server.close();
    }
  });

  it("a body over 64 KB is refused with 413 before any route runs", async () => {
    const coordinator = stubCoordinator();
    const server = await startTestServer(BASE_TEST_ENV, null, null, { coordinator });
    try {
      const res = await post(server.baseUrl, "/api/tasks", { task: "x".repeat(70_000), budgetHbar: "0.2" });
      assert.equal(res.status, 413);
      assert.equal(((await res.json()) as { code: string }).code, "PAYLOAD_TOO_LARGE");
      assert.equal(coordinator.starts, 0);
    } finally {
      await server.close();
    }
  });
});

describe("rate limit on POST /api/tasks", () => {
  it("rapid calls get 429 with Retry-After, and other routes are not limited", async () => {
    const coordinator = stubCoordinator();
    const server = await startTestServer(BASE_TEST_ENV, null, null, {
      coordinator,
      taskRateLimit: { windowMs: 60_000, max: 3 },
    });
    try {
      const body = { task: "Compare three AI coding tools.", budgetHbar: "0.2" };
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await post(server.baseUrl, "/api/tasks", body)).status);
      assert.deepEqual(statuses, [202, 202, 202, 429, 429]);
      assert.equal(coordinator.starts, 3, "limited calls never reach the Coordinator");

      const limited = await post(server.baseUrl, "/api/tasks", body);
      assert.ok(Number(limited.headers.get("retry-after")) > 0);
      assert.deepEqual(await limited.json(), {
        error: "Too many tasks started from your connection. Please wait a few minutes and try again.",
        code: "RATE_LIMITED",
      });
      assert.equal((await fetch(`${server.baseUrl}/api/health`)).status, 200);
    } finally {
      await server.close();
    }
  });

  it("the window resets, and each IP has its own count", () => {
    let t = 0;
    const limiter = rateLimit({ windowMs: 1000, max: 1, message: "slow down", now: () => t });
    const call = (ip: string) => {
      let err: unknown;
      const res = { setHeader() {} } as unknown as Response;
      limiter({ ip } as Request, res, (e?: unknown) => (err = e));
      return err instanceof AppError ? err.status : 200;
    };
    assert.equal(call("1.1.1.1"), 200);
    assert.equal(call("1.1.1.1"), 429);
    assert.equal(call("2.2.2.2"), 200);
    t = 1001;
    assert.equal(call("1.1.1.1"), 200);
  });
});

describe("task concurrency cap", () => {
  it("refuses a start over the cap with 503 TASKS_BUSY, and frees the slot when a task ends", async () => {
    const store = new MemoryStore();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    // The LLM waits on the gate, so started tasks stay running until we release them.
    const llm: LlmService = {
      async checkModel() {},
      async complete() {
        await gate;
        throw new AppError(502, "LLM_ERROR", "stop");
      },
    };
    const arkiv = {
      serverAddress: ("0x" + "a".repeat(40)) as `0x${string}`,
      async findAgent() {
        return undefined;
      },
      async writeTaskRecord() {
        return { entityKey: ("0x" + "1".repeat(64)) as `0x${string}`, txHash: ("0x" + "2".repeat(64)) as `0x${string}`, expiresAt: 1n };
      },
      async updateTaskStatus() {
        return { txHash: ("0x" + "3".repeat(64)) as `0x${string}` };
      },
      async writeAssignmentRecord() {
        throw new Error("not used");
      },
    };
    const buyer = {
      async buy() {
        throw new Error("not used");
      },
    };
    const coordinator = createCoordinator({ store, llm, arkiv, buyer, maxRunningTasks: 2 });
    const input = { task: "Compare tools.", budgetCapTinybars: 20_000_000n, agentIds: [], snapshotUrl: "http://x" };

    const a = await coordinator.start(input);
    await coordinator.start(input);
    await assert.rejects(coordinator.start(input), (e: unknown) => e instanceof AppError && e.code === "TASKS_BUSY");

    release();
    for (let i = 0; i < 50 && (await store.getTask(a.id))?.status !== "failed"; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 10));
    const again = await coordinator.start(input);
    assert.ok(again.id);
  });
});

describe("production mode", () => {
  it("dev routes return 404 and the market snapshot cannot be bought through them", async () => {
    const server = await startTestServer({ ...BASE_TEST_ENV, ...FAKE_CREDENTIALS, NODE_ENV: "production" });
    try {
      for (const path of ["/api/dev/infer", "/api/dev/buy-snapshot"]) {
        const res = await post(server.baseUrl, path, { agentId: "research", instruction: "x" });
        assert.equal(res.status, 404, path);
      }
    } finally {
      await server.close();
    }
  });
});
