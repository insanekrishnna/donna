import { ConfigError, loadConfig, loadLocalEnvFile, tinybarsToHbar } from "../src/config.js";
import { AppError } from "../src/errors.js";
import { createHederaBuyer, MARKET_SNAPSHOT_PATH, MARKET_SNAPSHOT_PAYEE } from "../src/integrations/hedera.js";
import { MemoryStore } from "../src/store/memoryStore.js";

/**
 * Buyer script (PHASES.md B4): the Research Agent pays for the market snapshot on a running server.
 * Start the server first (npm run dev), then: npm run buy:snapshot [-- <base URL>]
 * Pays 0.01 testnet HBAR. Prints public values only.
 */
loadLocalEnvFile();
try {
  const config = loadConfig();
  const base = process.argv[2] ?? `http://localhost:${config.PORT}`;
  const buyer = createHederaBuyer(config, new MemoryStore());
  const { data, receipt } = await buyer.buy(`${base}${MARKET_SNAPSHOT_PATH}`, {
    taskId: "script",
    payerAgentId: "research",
    payeeAgentId: MARKET_SNAPSHOT_PAYEE,
  });
  console.log("Paid and received HTTP 200.");
  console.log(`  amount:    ${tinybarsToHbar(receipt.amountTinybars)} HBAR`);
  console.log(`  Hedera tx: ${receipt.hederaTxId}`);
  console.log(`  HashScan:  ${receipt.hashScanUrl}`);
  console.log(`  data:      ${JSON.stringify(data).slice(0, 120)}...`);
} catch (err) {
  if (err instanceof ConfigError) console.error(err.message);
  else if (err instanceof AppError) console.error(`Payment failed (${err.code}): ${err.message}`);
  else console.error(`Payment failed: ${err instanceof Error ? err.name : "unknown error"}`);
  process.exit(1);
}
