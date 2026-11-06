import { randomUUID } from "node:crypto";
import type {
  BudgetLedger,
  ExecutionRecord,
  ExecutionUpdate,
  NewExecutionRecord,
  NewPaymentReceipt,
  PaymentReceipt,
  Store,
} from "./store.js";

interface LedgerState {
  capTinybars: bigint;
  spentTinybars: bigint;
}

/**
 * In-memory Store for the MVP. Data is lost on restart.
 *
 * Atomicity: every method does its check and its write synchronously, with no
 * `await` in between, so no other request can run in the middle of a reserve.
 * Returned objects are copies, so callers cannot change stored state by mutation.
 */
export class MemoryStore implements Store {
  private readonly executions = new Map<string, ExecutionRecord>();
  private readonly receipts: PaymentReceipt[] = [];
  private readonly ledgers = new Map<string, LedgerState>();

  async addExecution(record: NewExecutionRecord): Promise<ExecutionRecord> {
    const stored: ExecutionRecord = { ...record, id: randomUUID() };
    this.executions.set(stored.id, stored);
    return { ...stored };
  }

  async updateExecution(id: string, update: ExecutionUpdate): Promise<ExecutionRecord> {
    const current = this.executions.get(id);
    if (!current) throw new Error(`Execution record ${id} does not exist`);
    const next: ExecutionRecord = { ...current, ...update };
    this.executions.set(id, next);
    return { ...next };
  }

  async listExecutions(taskId: string): Promise<ExecutionRecord[]> {
    return [...this.executions.values()].filter((r) => r.taskId === taskId).map((r) => ({ ...r }));
  }

  async addReceipt(receipt: NewPaymentReceipt): Promise<PaymentReceipt> {
    const stored: PaymentReceipt = { ...receipt, id: randomUUID() };
    this.receipts.push(stored);
    return { ...stored };
  }

  async listReceipts(taskId?: string): Promise<PaymentReceipt[]> {
    return this.receipts.filter((r) => taskId === undefined || r.taskId === taskId).map((r) => ({ ...r }));
  }

  async createLedger(taskId: string, capTinybars: bigint): Promise<BudgetLedger> {
    if (capTinybars < 0n) throw new Error("Budget cap cannot be negative");
    if (this.ledgers.has(taskId)) throw new Error(`Task ${taskId} already has a budget ledger`);
    const state: LedgerState = { capTinybars, spentTinybars: 0n };
    this.ledgers.set(taskId, state);
    return toLedger(taskId, state);
  }

  async getLedger(taskId: string): Promise<BudgetLedger | undefined> {
    const state = this.ledgers.get(taskId);
    return state ? toLedger(taskId, state) : undefined;
  }

  async reserve(taskId: string, amountTinybars: bigint): Promise<boolean> {
    const state = this.requireLedger(taskId);
    if (amountTinybars <= 0n) throw new Error("Reserve amount must be greater than 0");
    if (state.spentTinybars + amountTinybars > state.capTinybars) return false;
    state.spentTinybars += amountTinybars;
    return true;
  }

  async release(taskId: string, amountTinybars: bigint): Promise<BudgetLedger> {
    const state = this.requireLedger(taskId);
    if (amountTinybars <= 0n) throw new Error("Release amount must be greater than 0");
    if (amountTinybars > state.spentTinybars) throw new Error("Cannot release more than was reserved");
    state.spentTinybars -= amountTinybars;
    return toLedger(taskId, state);
  }

  private requireLedger(taskId: string): LedgerState {
    const state = this.ledgers.get(taskId);
    if (!state) throw new Error(`Task ${taskId} has no budget ledger`);
    return state;
  }
}

function toLedger(taskId: string, state: LedgerState): BudgetLedger {
  return {
    taskId,
    capTinybars: state.capTinybars,
    spentTinybars: state.spentTinybars,
    remainingTinybars: state.capTinybars - state.spentTinybars,
  };
}
