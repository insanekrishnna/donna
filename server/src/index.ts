import { createApp } from "./app.js";
import { ConfigError, loadConfig, loadLocalEnvFile, missingCredentials } from "./config.js";
import { AppError, redactProcessSecrets } from "./errors.js";
import { createHederaBuyer, createMerchantPaywall } from "./integrations/hedera.js";
import { createArkivService, describeArkivError, type ArkivService } from "./integrations/arkiv.js";
import { createLlmService, describeLlmError, type LlmService } from "./integrations/llm.js";
import { MemoryStore } from "./store/memoryStore.js";

// Tests set NODE_ENV=test and pass their own environment, so no local .env can leak into them.
if (process.env.NODE_ENV !== "test") loadLocalEnvFile();

async function start(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      console.error("Fix these in .env (see .env.example), then start the server again.");
      process.exit(1);
    }
    throw err;
  }

  // Arkiv reads need the access key. When it is set, confirm we are on the expected chain before serving.
  let arkiv: ArkivService | null = null;
  if (config.ARKIV_ACCESS_KEY) {
    try {
      arkiv = createArkivService(config);
      await arkiv.checkChain();
    } catch (err) {
      // AppError messages are written to be safe. Anything else is reduced to a redacted name and message.
      const detail = err instanceof AppError ? err.message : describeArkivError(err, config);
      console.error(`Arkiv startup check failed: ${detail}`);
      process.exit(1);
    }
  }

  // LLM calls need the key and model. When both are set, confirm the model exists before serving.
  let llm: LlmService | null = null;
  if (config.LLM_API_KEY && config.LLM_MODEL) {
    try {
      llm = createLlmService(config);
      await llm.checkModel();
    } catch (err) {
      const detail = err instanceof AppError ? err.message : describeLlmError(err, [config.LLM_API_KEY]).message;
      console.error(`LLM startup check failed: ${detail}`);
      process.exit(1);
    }
  }

  // Hedera x402: the merchant paywall and the agent's buyer. The paywall reads the facilitator's
  // /supported list at start. The buyer and /api/payments share one store, so receipts show up there.
  const store = new MemoryStore();
  let paywall = null;
  let buyer = null;
  if (config.HEDERA_MERCHANT_ACCOUNT_ID && config.HEDERA_AGENT_ACCOUNT_ID && config.HEDERA_AGENT_PRIVATE_KEY) {
    try {
      paywall = createMerchantPaywall(config);
      buyer = createHederaBuyer(config, store);
    } catch (err) {
      const detail = err instanceof AppError ? err.message : err instanceof Error ? err.name : "unknown error";
      console.error(redactProcessSecrets(`Hedera setup failed: ${detail}`));
      process.exit(1);
    }
  }

  const app = createApp({ config, store, arkiv, llm, paywall, buyer });
  // Express 5 calls this callback with an error when listening fails (for example, port in use).
  app.listen(config.PORT, (err?: Error) => {
    if (err) {
      console.error(`Server failed to start: ${err.message}`);
      process.exit(1);
    }
    const missing = missingCredentials(config);
    console.log(`Donna API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
    if (missing.length > 0) console.log(`Partner credentials not configured yet: ${missing.join(", ")}`);
  });
}

void start();
