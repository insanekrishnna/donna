/**
 * Server-side records (ARCHITECTURE.md section 4.2).
 *
 * The app talks to this interface only, so a database can replace the
 * in-memory implementation later without changing callers. Methods are async
 * for that reason, even though MemoryStore resolves immediately.
 *
 * Money is always an integer amount of tinybars (bigint). Never use floats for money.
 */

export type ExecutionStatus = "pending" | "running" | "done" | "failed";

export interface ExecutionRecord {
  id: string;
  taskId: string;
  step: string;
  agentId: string;
  /**
   * The LLM provider's ID for this completion, copied from the real response. Optional: some
   * providers (OpenRouter included) may not return one. Never invented or filled in.
   */
  llmRequestId?: string;
  status: ExecutionStatus;
  /** Plain-language error, set when status is "failed". */
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export type NewExecutionRecord = Omit<ExecutionRecord, "id">;
export type ExecutionUpdate = Partial<Pick<ExecutionRecord, "llmRequestId" | "status" | "error" | "finishedAt">>;

export type PaymentStatus = "settled" | "failed";

export interface PaymentReceipt {
  id: string;
  taskId: string;
  payerAgentId: string;
  payeeAgentId: string;
  amountTinybars: bigint;
  /** Real Hedera transaction ID from the PAYMENT-RESPONSE header. Absent when the payment failed. */
  hederaTxId?: string;
  hashScanUrl?: string;
  status: PaymentStatus;
  createdAt: number;
}

export type NewPaymentReceipt = Omit<PaymentReceipt, "id">;

export interface BudgetLedger {
  taskId: string;
  capTinybars: bigint;
  spentTinybars: bigint;
  remainingTinybars: bigint;
}

export interface Store {
  // Execution records
  addExecution(record: NewExecutionRecord): Promise<ExecutionRecord>;
  updateExecution(id: string, update: ExecutionUpdate): Promise<ExecutionRecord>;
  listExecutions(taskId: string): Promise<ExecutionRecord[]>;

  // Payment receipts
  addReceipt(receipt: NewPaymentReceipt): Promise<PaymentReceipt>;
  /** All receipts, or only one task's receipts. Oldest first. */
  listReceipts(taskId?: string): Promise<PaymentReceipt[]>;

  // Budget ledgers
  /** Create a ledger with a cap. Throws if the task already has one or the cap is negative. */
  createLedger(taskId: string, capTinybars: bigint): Promise<BudgetLedger>;
  getLedger(taskId: string): Promise<BudgetLedger | undefined>;
  /**
   * Reserve `amountTinybars` against the task's cap.
   * Returns true and records the spend only if spent + amount <= cap.
   * Returns false and changes nothing otherwise. Check and record happen atomically.
   * Throws if the ledger does not exist or the amount is not positive.
   */
  reserve(taskId: string, amountTinybars: bigint): Promise<boolean>;
  /**
   * Give back a reservation whose payment did not settle.
   * Throws if the ledger does not exist, the amount is not positive, or it exceeds what was spent.
   */
  release(taskId: string, amountTinybars: bigint): Promise<BudgetLedger>;
}
