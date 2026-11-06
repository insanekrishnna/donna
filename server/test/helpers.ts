import type { AddressInfo } from "node:net";
import { type AppDeps, createApp } from "../src/app.js";
import type { Store } from "../src/store/store.js";
import { loadConfig } from "../src/config.js";
import type { ArkivService } from "../src/integrations/arkiv.js";
import type { LlmService } from "../src/integrations/llm.js";
import { MemoryStore } from "../src/store/memoryStore.js";

/**
 * Required, non-secret configuration for tests. Partner credentials are left out,
 * so every partner group reports as missing.
 */
export const BASE_TEST_ENV = {
  NODE_ENV: "test",
  PORT: "4999",
  CLIENT_ORIGIN: "http://localhost:5173",
  LLM_BASE_URL: "https://openrouter.ai/api/v1",
  HEDERA_NETWORK: "hedera:testnet",
  HEDERA_FACILITATOR_URL: "https://x402.org/facilitator",
  MAX_PAYMENT_PER_CALL: "0.10",
  ARKIV_CHAIN_ID: "7794095",
} as const;

/**
 * Fake placeholder credentials. They match the format rules but are not real keys:
 * the hex keys are a repeated pattern and the account IDs are made up.
 */
export const FAKE_CREDENTIALS = {
  LLM_API_KEY: "llm-test-placeholder-not-a-real-key",
  LLM_MODEL: "test-model-placeholder",
  HEDERA_MERCHANT_ACCOUNT_ID: "0.0.1111111",
  HEDERA_AGENT_ACCOUNT_ID: "0.0.2222222",
  HEDERA_AGENT_PRIVATE_KEY: "0x" + "ab".repeat(32),
  HEDERA_MERCHANT_PRIVATE_KEY: "0x" + "cd".repeat(32),
  ARKIV_ACCESS_KEY: "test-access-key-placeholder",
  ARKIV_SERVER_PRIVATE_KEY: "0x" + "ef".repeat(32),
} as const;

/** Start the app on a random free port. Call `close()` when done. */
export async function startTestServer(
  env: Record<string, string>,
  arkiv: ArkivService | null = null,
  llm: LlmService | null = null,
  extra: Pick<AppDeps, "paywall" | "buyer" | "coordinator" | "taskRateLimit"> & { store?: Store } = {},
) {
  const { store = new MemoryStore(), ...hedera } = extra;
  const app = createApp({ config: loadConfig(env), store, arkiv, llm, ...hedera });
  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const s = app.listen(0, (err?: Error) => (err ? reject(err) : resolve(s)));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
