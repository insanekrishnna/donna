import { Router } from "express";
import { z } from "zod";
import type { Coordinator } from "../agents/coordinator.js";
import { hbarToTinybars, tinybarsToHbar } from "../config.js";
import { AppError } from "../errors.js";
import { MARKET_SNAPSHOT_PATH, receiptToJson } from "../integrations/hedera.js";
import { evmAddressSchema } from "../schemas/arkiv.js";
import { SPECIALIST_IDS } from "../schemas/plan.js";
import type { Store, TaskRun } from "../store/store.js";
import { parseBody } from "./validate.js";

/** Largest budget a single task may set: 10 HBAR (testnet). */
const MAX_BUDGET_TINYBARS = 1_000_000_000n;

export const createTaskBodySchema = z.strictObject({
  task: z.string().trim().min(10, "task must be at least 10 characters").max(2000, "task must be at most 2000 characters"),
  budgetHbar: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, "budgetHbar must be a decimal HBAR amount like 0.20")
    .refine((v) => {
      const t = hbarToTinybars(v);
      return t > 0n && t <= MAX_BUDGET_TINYBARS;
    }, "budgetHbar must be more than 0 and at most 10"),
  agentIds: z.array(z.enum(SPECIALIST_IDS, "agentIds may only contain research, analyst, writer")).max(3).optional(),
  requesterAddress: evmAddressSchema.optional(),
});

/** The polling view of a task: status, steps, outputs, receipts and every proof ID. */
async function taskView(task: TaskRun, store: Store) {
  const [ledger, receipts, executions] = await Promise.all([
    store.getLedger(task.id),
    store.listReceipts(task.id),
    store.listExecutions(task.id),
  ]);
  const hbar = (t: bigint | undefined) => (t === undefined ? null : tinybarsToHbar(t));
  return {
    id: task.id,
    status: task.status,
    error: task.error ?? null,
    task: task.task,
    agentIds: task.agentIds,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    budget: {
      capHbar: hbar(task.budgetCapTinybars),
      estimatedCostHbar: hbar(task.estimatedCostTinybars),
      spentHbar: hbar(ledger?.spentTinybars),
      remainingHbar: hbar(ledger?.remainingTinybars),
    },
    steps: task.steps.map((s) => ({
      id: s.id,
      agentId: s.agentId,
      instruction: s.instruction,
      dependsOn: s.dependsOn,
      needsPaidData: s.needsPaidData,
      status: s.status,
      output: s.output ?? null,
      llmRequestId: s.llmRequestId ?? null,
      error: s.error ?? null,
    })),
    report: task.report ?? null,
    receipts: receipts.map((r) => receiptToJson(r, tinybarsToHbar)),
    proof: {
      planRequestId: task.planRequestId ?? null,
      llmCalls: executions.map((e) => ({
        step: e.step,
        agentId: e.agentId,
        status: e.status,
        llmRequestId: e.llmRequestId ?? null,
      })),
      arkiv: task.arkiv,
    },
  };
}

/**
 * POST /api/tasks and GET /api/tasks/:id (the polling endpoint).
 * `coordinator` is null when the LLM, Hedera or Arkiv (with the server key) is not configured.
 */
export function tasksRouter(coordinator: Coordinator | null, store: Store): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const body = parseBody(createTaskBodySchema, req.body);
    if (!coordinator) {
      throw new AppError(503, "TASKS_NOT_CONFIGURED", "Tasks need the LLM, Hedera and Arkiv (with the server key) configured.");
    }
    const task = await coordinator.start({
      task: body.task,
      budgetCapTinybars: hbarToTinybars(body.budgetHbar),
      agentIds: body.agentIds ?? [],
      ...(body.requesterAddress ? { requesterAddress: body.requesterAddress } : {}),
      // The paid service is on this same server: use the port this request arrived on.
      snapshotUrl: `http://127.0.0.1:${req.socket.localPort}${MARKET_SNAPSHOT_PATH}`,
    });
    res.status(202).json({ taskId: task.id, status: task.status });
  });

  router.get("/:id", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const task = id.success ? await store.getTask(id.data) : undefined;
    if (!task) throw new AppError(404, "TASK_NOT_FOUND", "No task has this ID.");
    res.json(await taskView(task, store));
  });

  return router;
}
