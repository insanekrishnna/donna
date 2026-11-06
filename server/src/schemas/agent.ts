import { z } from "zod";
import { hbarToTinybars, tinybarsToHbar } from "../config.js";
import { AppError } from "../errors.js";
import { arkivStr, entityKeySchema, evmAddressSchema } from "./arkiv.js";

/** Agent listing rules (ARCHITECTURE.md section 4.1). Shared with the client wizard in B7. */

export const AGENT_CATEGORIES = ["research", "analysis", "writing", "other"] as const;
export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

export const MAX_SKILLS = 6;

/** Prices are capped so a typo cannot list an agent at an absurd amount. 1,000 HBAR. */
export const MAX_PRICE_TINYBARS = 100_000_000_000n;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const agentIdSchema = arkivStr
  .pipe(z.string().min(3, "must be at least 3 characters").max(40, "must be at most 40 characters"))
  .pipe(z.string().regex(SLUG, "must use lowercase letters, numbers and single hyphens"));

export const categorySchema = z.enum(AGENT_CATEGORIES, "must be one of research, analysis, writing, other");

const nameSchema = z
  .string()
  .trim()
  .min(3, "must be at least 3 characters")
  .max(40, "must be at most 40 characters");

const descriptionSchema = z
  .string()
  .trim()
  .min(1, "is required")
  .max(280, "must be at most 280 characters");

const skillSchema = z.string().trim().min(1, "must not be empty").max(24, "must be at most 24 characters");

const skillsSchema = z
  .array(skillSchema, "must be a list")
  .max(MAX_SKILLS, `must have at most ${MAX_SKILLS} skills`)
  .refine((skills) => new Set(skills.map((s) => s.toLowerCase())).size === skills.length, "must not repeat a skill");

const priceTinybarsSchema = z
  .string()
  // abort: Zod 4 otherwise still runs the refine below, where BigInt() would throw on bad input.
  .regex(/^[1-9]\d*$/, { error: "must be a whole number of tinybars greater than 0", abort: true })
  .refine((v) => BigInt(v) <= MAX_PRICE_TINYBARS, "must be at most 1000 HBAR");

const serviceUrlSchema = z
  .string()
  .max(200, "must be at most 200 characters")
  .regex(/^https?:\/\/\S+$/, "must be an http(s) URL");

/** The JSON stored in a listing's `data` column. Validated on write and on every read. */
export const agentDataSchema = z.strictObject({
  name: nameSchema,
  description: descriptionSchema,
  skills: skillsSchema,
  priceTinybars: priceTinybarsSchema,
  currency: z.literal("HBAR", "must be HBAR"),
  serviceUrl: serviceUrlSchema.optional(),
  createdAt: z.number().int().positive(),
});
export type AgentData = z.infer<typeof agentDataSchema>;

/** Values for the AgentListing schema's columns, before encoding `data`. */
export interface AgentListingInput {
  agentId: string;
  category: AgentCategory;
  data: AgentData;
}

/** What the browser's Create Agent wizard sends to POST /api/agents/prepare. */
export const prepareAgentBodySchema = z.strictObject({
  agentId: agentIdSchema.optional(),
  name: nameSchema,
  description: descriptionSchema,
  category: categorySchema,
  skills: skillsSchema,
  pricePerTask: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, { error: "must be a decimal HBAR amount with at most 8 decimals, like 0.05", abort: true })
    .refine((v) => hbarToTinybars(v) > 0n, "must be greater than 0")
    .refine((v) => hbarToTinybars(v) <= MAX_PRICE_TINYBARS, "must be at most 1000 HBAR"),
  serviceUrl: serviceUrlSchema.optional(),
});
export type PrepareAgentBody = z.infer<typeof prepareAgentBodySchema>;

/** Turn a name into a listing slug: "Research Agent" -> "research-agent". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * Normalize a validated wizard body into listing input.
 * Throws a 400 AppError when no agentId was given and none can be made from the name
 * (for example, a name with no Latin letters or digits).
 */
export function normalizeAgentInput(body: PrepareAgentBody, nowSeconds: number): AgentListingInput {
  const derived = agentIdSchema.safeParse(body.agentId ?? slugify(body.name));
  if (!derived.success) {
    throw new AppError(
      400,
      "INVALID_INPUT",
      "agentId: could not be made from the name. Please choose an agentId of 3-40 lowercase letters, numbers and hyphens.",
    );
  }
  const agentId = derived.data;
  const data = agentDataSchema.parse({
    name: body.name,
    description: body.description,
    skills: body.skills,
    priceTinybars: hbarToTinybars(body.pricePerTask).toString(),
    currency: "HBAR",
    ...(body.serviceUrl ? { serviceUrl: body.serviceUrl } : {}),
    createdAt: nowSeconds,
  });
  return { agentId, category: body.category, data };
}

/** A listing as the API returns it. Owner and expiry come from Arkiv, never from our data. */
export interface AgentListingView {
  entityKey: string;
  owner: string;
  creator: string;
  /** Block number at which Arkiv drops the entity (2-second blocks). */
  expiresAtBlock: string;
  agentId: string;
  category: AgentCategory;
  name: string;
  description: string;
  skills: string[];
  priceTinybars: string;
  priceHbar: string;
  currency: "HBAR";
  serviceUrl?: string;
  createdAt: number;
}

/** A row read back from Arkiv through the AgentListing schema, reduced to plain values. */
export interface RawAgentRow {
  entityKey: string;
  owner: string;
  creator: string;
  expiresAt: bigint;
  agentId: string;
  category: string;
  data: unknown;
}

/** Validate one raw row. Returns null when anything about it is invalid (it is then skipped). */
export function parseAgentRow(row: RawAgentRow): AgentListingView | null {
  const key = entityKeySchema.safeParse(row.entityKey);
  const owner = evmAddressSchema.safeParse(row.owner);
  const creator = evmAddressSchema.safeParse(row.creator);
  const agentId = agentIdSchema.safeParse(row.agentId);
  const category = categorySchema.safeParse(row.category);
  const data = agentDataSchema.safeParse(row.data);
  if (!key.success || !owner.success || !creator.success || !agentId.success || !category.success || !data.success) {
    return null;
  }
  return {
    entityKey: key.data,
    owner: owner.data,
    creator: creator.data,
    expiresAtBlock: row.expiresAt.toString(),
    agentId: agentId.data,
    category: category.data,
    name: data.data.name,
    description: data.data.description,
    skills: data.data.skills,
    priceTinybars: data.data.priceTinybars,
    priceHbar: tinybarsToHbar(BigInt(data.data.priceTinybars)),
    currency: data.data.currency,
    ...(data.data.serviceUrl ? { serviceUrl: data.data.serviceUrl } : {}),
    createdAt: data.data.createdAt,
  };
}

/** Validate a page of raw rows. Invalid rows are counted, never thrown. */
export function parseAgentRows(rows: readonly RawAgentRow[]): { agents: AgentListingView[]; invalid: number } {
  const agents: AgentListingView[] = [];
  let invalid = 0;
  for (const row of rows) {
    const parsed = parseAgentRow(row);
    if (parsed) agents.push(parsed);
    else invalid += 1;
  }
  return { agents, invalid };
}

export const verifyAgentBodySchema = z.strictObject({
  entityKey: entityKeySchema,
  address: evmAddressSchema,
});
