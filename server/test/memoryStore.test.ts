import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryStore } from "../src/store/memoryStore.js";

describe("MemoryStore budget ledger", () => {
  it("reserve succeeds up to the cap exactly", async () => {
    const store = new MemoryStore();
    await store.createLedger("t1", 20_000_000n);
    assert.equal(await store.reserve("t1", 15_000_000n), true);
    assert.equal(await store.reserve("t1", 5_000_000n), true);
    assert.deepEqual(await store.getLedger("t1"), {
      taskId: "t1",
      capTinybars: 20_000_000n,
      spentTinybars: 20_000_000n,
      remainingTinybars: 0n,
    });
  });

  it("reserve refuses overspend and changes nothing", async () => {
    const store = new MemoryStore();
    await store.createLedger("t1", 10_000_000n);
    assert.equal(await store.reserve("t1", 6_000_000n), true);
    assert.equal(await store.reserve("t1", 4_000_001n), false);
    assert.equal((await store.getLedger("t1"))?.spentTinybars, 6_000_000n);
    assert.equal(await store.reserve("t1", 1n), true);
  });

  it("refuses a single reservation larger than the cap", async () => {
    const store = new MemoryStore();
    await store.createLedger("t1", 1_000_000n);
    assert.equal(await store.reserve("t1", 1_000_001n), false);
    assert.equal((await store.getLedger("t1"))?.spentTinybars, 0n);
  });

  it("never overspends under concurrent reservations", async () => {
    const store = new MemoryStore();
    await store.createLedger("t1", 10n);
    const results = await Promise.all(Array.from({ length: 25 }, () => store.reserve("t1", 1n)));
    assert.equal(results.filter(Boolean).length, 10);
    assert.equal((await store.getLedger("t1"))?.spentTinybars, 10n);
  });

  it("rejects zero, negative, and unknown-ledger reservations", async () => {
    const store = new MemoryStore();
    await store.createLedger("t1", 10n);
    await assert.rejects(store.reserve("t1", 0n));
    await assert.rejects(store.reserve("t1", -1n));
    await assert.rejects(store.reserve("missing", 1n));
  });

  it("rejects duplicate and negative-cap ledgers", async () => {
    const store = new MemoryStore();
    await store.createLedger("t1", 10n);
    await assert.rejects(store.createLedger("t1", 10n));
    await assert.rejects(store.createLedger("t2", -1n));
  });

  it("release gives back a reservation but never more than was spent", async () => {
    const store = new MemoryStore();
    await store.createLedger("t1", 10n);
    await store.reserve("t1", 7n);
    assert.equal((await store.release("t1", 7n)).remainingTinybars, 10n);
    await assert.rejects(store.release("t1", 1n));
  });
});

describe("MemoryStore records", () => {
  it("stores and updates execution records per task", async () => {
    const store = new MemoryStore();
    const rec = await store.addExecution({ taskId: "t1", step: "s1", agentId: "research", status: "running", startedAt: 1 });
    await store.addExecution({ taskId: "t2", step: "s1", agentId: "writer", status: "pending", startedAt: 2 });
    const updated = await store.updateExecution(rec.id, { status: "done", ogRequestId: "req-1", finishedAt: 3 });
    assert.equal(updated.status, "done");
    const list = await store.listExecutions("t1");
    assert.equal(list.length, 1);
    assert.equal(list[0]?.ogRequestId, "req-1");
    await assert.rejects(store.updateExecution("missing", { status: "failed" }));
  });

  it("stores receipts and filters by task", async () => {
    const store = new MemoryStore();
    await store.addReceipt({ taskId: "t1", payerAgentId: "research", payeeAgentId: "market-snapshot", amountTinybars: 1n, status: "failed", createdAt: 1 });
    await store.addReceipt({ taskId: "t2", payerAgentId: "research", payeeAgentId: "market-snapshot", amountTinybars: 2n, status: "failed", createdAt: 2 });
    assert.equal((await store.listReceipts()).length, 2);
    assert.equal((await store.listReceipts("t2"))[0]?.amountTinybars, 2n);
  });

  it("returns copies, so callers cannot mutate stored state", async () => {
    const store = new MemoryStore();
    const rec = await store.addExecution({ taskId: "t1", step: "s1", agentId: "research", status: "running", startedAt: 1 });
    rec.status = "failed";
    assert.equal((await store.listExecutions("t1"))[0]?.status, "running");
  });
});
