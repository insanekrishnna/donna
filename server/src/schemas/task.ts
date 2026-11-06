import { z } from "zod";
import { agentIdSchema, categorySchema } from "./agent.js";
import { arkivStr, entityKeySchema, evmAddressSchema } from "./arkiv.js";

/**
 * Public task coordination records (ARCHITECTURE.md section 4.1). Written by the server key.
 * Never put the task's private text, specialist outputs, or reports in these records.
 */

export const TASK_STATUSES = ["open", "planning", "running", "completed", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ASSIGNMENT_STATUSES = ["assigned", "done", "failed"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

const tinybarsString = z.string().regex(/^(0|[1-9]\d*)$/, "must be a whole number of tinybars");

export const taskIdSchema = arkivStr.pipe(
  z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "must be 1-64 letters, numbers, hyphens or underscores"),
);

export const taskRecordInputSchema = z.strictObject({
  taskId: taskIdSchema,
  status: z.enum(TASK_STATUSES),
  requesterAddress: evmAddressSchema.optional(),
  data: z.strictObject({
    category: categorySchema,
    budgetCapTinybars: tinybarsString,
    createdAt: z.number().int().positive(),
  }),
});
export type TaskRecordInput = z.infer<typeof taskRecordInputSchema>;

export const assignmentRecordInputSchema = z.strictObject({
  taskId: taskIdSchema,
  agentId: agentIdSchema,
  status: z.enum(ASSIGNMENT_STATUSES),
  data: z.strictObject({
    agentEntityKey: entityKeySchema,
    creatorAddress: evmAddressSchema,
    amountTinybars: tinybarsString,
  }),
});
export type AssignmentRecordInput = z.infer<typeof assignmentRecordInputSchema>;
