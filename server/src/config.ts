import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

/**
 * Server configuration, loaded from environment variables (ARCHITECTURE.md section 9).
 *
 * Rules:
 * - Every variable is validated with Zod at startup.
 * - Error messages name the variable and the rule it broke. They never include the value.
 * - Partner credentials are optional until the phase that needs them. Use
 *   `missingCredentials()` as the gate before calling a partner.
 * - VITE_* variables belong to the client and are not read here.
 */

export const TINYBARS_PER_HBAR = 100_000_000n;

/**
 * Load the repo-root .env (one file for the whole project) into process.env.
 * Existing variables win. A missing file is fine: hosted deployments set variables in the dashboard.
 * Never logs anything.
 */
export function loadLocalEnvFile(): void {
  dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
}

/**
 * Testnet prices, in tinybars (1 HBAR = 100,000,000 tinybars). Placeholders, set here in config,
 * not sourced figures (ARCHITECTURE.md section 3). Never use floats for money.
 */
export const AGENT_PRICES_TINYBARS = {
  research: 5_000_000n, // 0.05 HBAR
  analyst: 3_000_000n, // 0.03 HBAR
  writer: 2_000_000n, // 0.02 HBAR
} as const;

/** Price of GET /api/services/market-snapshot: 0.01 HBAR. Testnet placeholder. */
export const MARKET_SNAPSHOT_PRICE_TINYBARS = 1_000_000n;

/** Format tinybars as a decimal HBAR string with no trailing zeros, for example 5000000n -> "0.05". */
export function tinybarsToHbar(tinybars: bigint): string {
  if (tinybars < 0n) throw new Error("Tinybar amount cannot be negative");
  const whole = tinybars / TINYBARS_PER_HBAR;
  const fraction = (tinybars % TINYBARS_PER_HBAR).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

const HBAR_DECIMAL = /^\d+(\.\d{1,8})?$/;

/**
 * Convert a decimal HBAR string (for example "0.10") to tinybars, exactly.
 * Uses integer math only, so no floating point rounding can change an amount.
 * Throws if the string is not a non-negative decimal with at most 8 fractional digits.
 */
export function hbarToTinybars(hbar: string): bigint {
  if (!HBAR_DECIMAL.test(hbar)) {
    throw new Error("HBAR amount must be a decimal string with at most 8 decimal places");
  }
  const [whole = "0", fraction = ""] = hbar.split(".");
  return BigInt(whole) * TINYBARS_PER_HBAR + BigInt(fraction.padEnd(8, "0"));
}

const required = (name: string) => z.string(`${name} is required`);
const optional = (schema: z.ZodString) => schema.optional();

const httpUrl = (name: string) =>
  required(name).regex(/^https?:\/\/\S+$/, `${name} must be an http(s) URL`);

const hederaAccountId = (name: string) =>
  z.string().regex(/^0\.0\.\d+$/, `${name} must be a Hedera account ID like 0.0.12345`);

// Hedera portal keys are shown as hex, with or without 0x, raw (64 hex chars) or DER-encoded (longer).
const hederaPrivateKey = (name: string) =>
  z.string().regex(/^(0x)?[0-9a-fA-F]{64,}$/, `${name} must be a hex-encoded ECDSA private key`);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"], "NODE_ENV must be development, production or test")
    .default("development"),

  // App
  PORT: required("PORT")
    .regex(/^\d{1,5}$/, "PORT must be a whole number")
    .transform(Number)
    .refine((port) => port >= 1 && port <= 65535, "PORT must be between 1 and 65535"),
  CLIENT_ORIGIN: httpUrl("CLIENT_ORIGIN").regex(
    /^[^/]+\/\/[^/]+$/,
    "CLIENT_ORIGIN must be an origin with no path or trailing slash, like http://localhost:5173",
  ),

  // LLM: any OpenAI-compatible endpoint (OpenRouter for now). LLM_API_KEY is a server-only secret.
  LLM_BASE_URL: httpUrl("LLM_BASE_URL"),
  // At least 16 characters, so log redaction (which ignores very short strings) always applies.
  LLM_API_KEY: optional(z.string().regex(/^\S{16,}$/, "LLM_API_KEY must be at least 16 characters with no spaces")),
  LLM_MODEL: optional(z.string().regex(/^\S+$/, "LLM_MODEL must not contain spaces")),

  // Hedera testnet
  HEDERA_NETWORK: z.literal("hedera:testnet", "HEDERA_NETWORK must be hedera:testnet (testnet only)"),
  HEDERA_FACILITATOR_URL: httpUrl("HEDERA_FACILITATOR_URL"),
  HEDERA_MERCHANT_ACCOUNT_ID: optional(hederaAccountId("HEDERA_MERCHANT_ACCOUNT_ID")),
  HEDERA_MERCHANT_PRIVATE_KEY: optional(hederaPrivateKey("HEDERA_MERCHANT_PRIVATE_KEY")),
  HEDERA_AGENT_ACCOUNT_ID: optional(hederaAccountId("HEDERA_AGENT_ACCOUNT_ID")),
  HEDERA_AGENT_PRIVATE_KEY: optional(hederaPrivateKey("HEDERA_AGENT_PRIVATE_KEY")),
  MAX_PAYMENT_PER_CALL: required("MAX_PAYMENT_PER_CALL")
    // abort: Zod 4 otherwise still runs the refine below on a malformed value, and hbarToTinybars would throw.
    .regex(HBAR_DECIMAL, {
      error: "MAX_PAYMENT_PER_CALL must be a decimal HBAR amount with at most 8 decimals, like 0.10",
      abort: true,
    })
    .refine((v) => hbarToTinybars(v) > 0n, "MAX_PAYMENT_PER_CALL must be greater than 0"),

  // Arkiv (Rabdi testnet)
  ARKIV_CHAIN_ID: z.literal("7794095", "ARKIV_CHAIN_ID must be 7794095 (Arkiv Rabdi testnet)").transform(Number),
  // At least 16 characters, so log redaction (which ignores very short strings) always applies.
  ARKIV_ACCESS_KEY: optional(z.string().regex(/^\S{16,}$/, "ARKIV_ACCESS_KEY must be at least 16 characters with no spaces")),
  ARKIV_SERVER_PRIVATE_KEY: optional(
    z.string().regex(/^0x[0-9a-fA-F]{64}$/, "ARKIV_SERVER_PRIVATE_KEY must be 0x followed by 64 hex characters"),
  ),
});

export type Config = z.infer<typeof envSchema>;

export type PartnerGroup = "LLM" | "Hedera" | "Arkiv";

/** Thrown by loadConfig. `problems` holds "VARIABLE: rule" lines, never values. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid server configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/**
 * Validate an environment object. Empty or whitespace-only values count as missing,
 * so a copied .env.example with blank lines behaves the same as unset variables.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const input: Record<string, string> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") input[key] = value.trim();
  }

  const result = envSchema.safeParse(input);
  if (!result.success) {
    // Only the variable name and our own message. Zod issues also carry the raw input; never print it.
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.map(String).join(".") || "environment";
      return issue.message.startsWith(name) ? issue.message : `${name}: ${issue.message}`;
    });
    throw new ConfigError([...new Set(problems)]);
  }
  return result.data;
}

/** Partner groups whose credentials are not fully configured yet. */
export function missingCredentials(config: Config): PartnerGroup[] {
  const missing: PartnerGroup[] = [];
  if (!config.LLM_API_KEY || !config.LLM_MODEL) missing.push("LLM");
  if (!config.HEDERA_MERCHANT_ACCOUNT_ID || !config.HEDERA_AGENT_ACCOUNT_ID || !config.HEDERA_AGENT_PRIVATE_KEY) {
    missing.push("Hedera");
  }
  if (!config.ARKIV_ACCESS_KEY || !config.ARKIV_SERVER_PRIVATE_KEY) missing.push("Arkiv");
  return missing;
}

/** MAX_PAYMENT_PER_CALL in tinybars. */
export function maxPaymentPerCallTinybars(config: Config): bigint {
  return hbarToTinybars(config.MAX_PAYMENT_PER_CALL);
}
