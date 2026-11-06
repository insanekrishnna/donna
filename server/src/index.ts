import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { ConfigError, loadConfig, missingCredentials } from "./config.js";
import { MemoryStore } from "./store/memoryStore.js";

// Local development reads the repo-root .env (one file for the whole project).
// Tests set NODE_ENV=test and pass their own environment, so no local .env can leak into them.
// Hosted deployments set variables in the dashboard; a missing file is fine.
if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
}

function start(): void {
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

  const app = createApp({ config, store: new MemoryStore() });
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

start();
