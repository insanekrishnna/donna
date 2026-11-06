import { type Config, ConfigError, loadConfig, loadLocalEnvFile, missingCredentials } from "../src/config.js";
import { AppError, redactProcessSecrets } from "../src/errors.js";
import { type ArkivService, createArkivService } from "../src/integrations/arkiv.js";

/**
 * Shared setup for CLI scripts: load .env, validate config, require Arkiv credentials,
 * and confirm the chain. Prints only public values (chain ID, addresses). Never keys.
 */
export async function bootstrapArkiv(): Promise<{ config: Config; arkiv: ArkivService; serverAddress: `0x${string}` }> {
  loadLocalEnvFile();
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) fail(err.message);
    throw err;
  }
  if (missingCredentials(config).includes("Arkiv")) {
    fail("Arkiv is not configured: set ARKIV_ACCESS_KEY and ARKIV_SERVER_PRIVATE_KEY in .env.");
  }
  const arkiv = createArkivService(config); // throws a safe AppError for an invalid key
  const chainId = await arkiv.checkChain();
  if (!arkiv.serverAddress) fail("ARKIV_SERVER_PRIVATE_KEY is not set.");
  console.log(`Arkiv chain ${chainId}, server address ${arkiv.serverAddress}`);
  return { config, arkiv, serverAddress: arkiv.serverAddress };
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Run a script's main function and print a clean error (never a stack with request details). */
export function runScript(main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    if (err instanceof AppError) fail(`${err.code}: ${err.message}`);
    // Anything else may be a raw SDK error whose message holds the RPC URL: redact every secret.
    fail(redactProcessSecrets(`Script failed: ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"}`));
  });
}
