import { z } from "zod";
import type { SpecialistId } from "../agents/types.js";

/**
 * The Coordinator's plan (ARCHITECTURE.md section 4.3). It is AI output, so it is validated
 * here before anything runs. The model's `estimatedCost` is informational only: the server
 * computes the real cost from config prices.
 */

export const MAX_SUBTASKS = 4;
export const SPECIALIST_IDS = ["research", "analyst", "writer"] as const satisfies readonly SpecialistId[];

const subtaskSchema = z.object({
  id: z.string().regex(/^s[1-9]$/, "subtask id must be s1 to s9"),
  agentId: z.enum(SPECIALIST_IDS, "agentId must be research, analyst or writer"),
  instruction: z.string().trim().min(1, "instruction must not be empty").max(2000, "instruction is too long"),
  needsPaidData: z.boolean().optional(),
  dependsOn: z.array(z.string()).max(MAX_SUBTASKS).optional(),
});

export const planSchema = z.object({
  task: z.string().trim().min(1).max(2000),
  subtasks: z.array(subtaskSchema).min(1).max(MAX_SUBTASKS, `a plan has at most ${MAX_SUBTASKS} subtasks`),
  estimatedCost: z.string().max(100).optional(),
});

export type Plan = z.infer<typeof planSchema>;
export type Subtask = Plan["subtasks"][number];

/**
 * Rules the shape alone cannot express:
 * - ids are unique, and dependsOn only names earlier subtasks (so plan order is a valid run order);
 * - only the agents the user selected are used;
 * - exactly one writer, and it is the last subtask (it produces the report);
 * - at most one subtask needs paid data, and only a research subtask can.
 * Returns a list of problems; empty means valid.
 */
export function planRuleProblems(plan: Plan, allowedAgents: readonly SpecialistId[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  plan.subtasks.forEach((s) => {
    if (seen.has(s.id)) problems.push(`duplicate subtask id ${s.id}`);
    for (const dep of s.dependsOn ?? []) {
      if (!seen.has(dep)) problems.push(`${s.id} depends on ${dep}, which is not an earlier subtask`);
    }
    seen.add(s.id);
    if (!allowedAgents.includes(s.agentId)) problems.push(`${s.id} uses ${s.agentId}, which was not selected`);
    if (s.needsPaidData && s.agentId !== "research") problems.push(`${s.id}: only a research subtask can use paid data`);
  });
  const writers = plan.subtasks.filter((s) => s.agentId === "writer");
  if (writers.length !== 1) problems.push("the plan must have exactly one writer subtask");
  if (plan.subtasks.at(-1)?.agentId !== "writer") problems.push("the writer subtask must be last");
  if (plan.subtasks.filter((s) => s.needsPaidData).length > 1) problems.push("at most one subtask can use paid data");
  return problems;
}

/** Pull the JSON object out of a model answer (it may wrap it in a ```json fence or add text around it). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(body.slice(start, end + 1));
}

export type PlanParseResult = { ok: true; plan: Plan } | { ok: false; problem: string };

/** Parse and fully validate a model answer as a plan. Never throws. */
export function parsePlan(text: string, allowedAgents: readonly SpecialistId[]): PlanParseResult {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    return { ok: false, problem: "the answer was not valid JSON" };
  }
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`);
    return { ok: false, problem: [...new Set(issues)].join("; ") };
  }
  const problems = planRuleProblems(parsed.data, allowedAgents);
  if (problems.length > 0) return { ok: false, problem: problems.join("; ") };
  return { ok: true, plan: parsed.data };
}
