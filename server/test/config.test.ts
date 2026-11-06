import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ConfigError,
  hbarToTinybars,
  loadConfig,
  maxPaymentPerCallTinybars,
  missingCredentials,
} from "../src/config.js";
import { BASE_TEST_ENV, FAKE_CREDENTIALS } from "./helpers.js";

const serverDir = fileURLToPath(new URL("..", import.meta.url));
const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

/** Run the real server entry point in a child process with exactly this environment. */
function runServer(env: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", entry], {
    cwd: serverDir,
    // SystemRoot is needed for Node to start on Windows; it is not app config.
    env: { ...env, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    encoding: "utf8",
    timeout: 30_000,
  });
}

describe("startup config (child process)", () => {
  it("exits with code 1 and names a missing required variable", () => {
    const { PORT: _omit, ...env } = BASE_TEST_ENV;
    const result = runServer(env);
    assert.equal(result.status, 1, `expected exit code 1, got ${result.status}. stderr: ${result.stderr}`);
    assert.match(result.stderr, /PORT is required/);
  });

  it("names a malformed variable without printing its value", () => {
    const badKey = "not-a-valid-key-SECRETVALUE123";
    const badOrigin = "ftp://SECRETORIGIN.example";
    const result = runServer({ ...BASE_TEST_ENV, CLIENT_ORIGIN: badOrigin, ARKIV_SERVER_PRIVATE_KEY: badKey });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CLIENT_ORIGIN must be an http\(s\) URL/);
    assert.match(result.stderr, /ARKIV_SERVER_PRIVATE_KEY must be 0x followed by 64 hex characters/);
    const output = result.stdout + result.stderr;
    assert.ok(!output.includes(badKey), "output must not contain the private key value");
    assert.ok(!output.includes("SECRETVALUE123"), "output must not contain any part of the value");
    assert.ok(!output.includes(badOrigin), "output must not contain the origin value");
  });

  it("exits with code 1 and does not claim to be listening when the port is taken", async () => {
    const { createServer } = await import("node:net");
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, resolve));
    const port = (blocker.address() as import("node:net").AddressInfo).port;
    try {
      const result = runServer({ ...BASE_TEST_ENV, PORT: String(port) });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Server failed to start/);
      assert.ok(!result.stdout.includes("listening"), "must not log listening on failure");
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("refuses a non-testnet Hedera network", () => {
    const result = runServer({ ...BASE_TEST_ENV, HEDERA_NETWORK: "hedera:mainnet" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HEDERA_NETWORK must be hedera:testnet/);
    assert.ok(!result.stderr.includes("hedera:mainnet"));
  });
});

describe("loadConfig", () => {
  it("accepts the base env and treats blank values as missing", () => {
    const config = loadConfig({ ...BASE_TEST_ENV, LLM_API_KEY: "", ARKIV_ACCESS_KEY: "   " });
    assert.equal(config.PORT, 4999);
    assert.equal(config.ARKIV_CHAIN_ID, 7794095);
    assert.equal(config.LLM_API_KEY, undefined);
    assert.equal(config.ARKIV_ACCESS_KEY, undefined);
  });

  it("lists every problem at once", () => {
    const { PORT: _p, CLIENT_ORIGIN: _c, ...env } = BASE_TEST_ENV;
    assert.throws(
      () => loadConfig(env),
      (err: unknown) =>
        err instanceof ConfigError &&
        err.problems.includes("PORT is required") &&
        err.problems.includes("CLIENT_ORIGIN is required"),
    );
  });

  it("rejects a CLIENT_ORIGIN with a path or trailing slash", () => {
    assert.throws(() => loadConfig({ ...BASE_TEST_ENV, CLIENT_ORIGIN: "http://localhost:5173/" }), ConfigError);
  });
});

describe("missingCredentials", () => {
  it("lists all partner groups when no credentials are set", () => {
    assert.deepEqual(missingCredentials(loadConfig(BASE_TEST_ENV)), ["LLM", "Hedera", "Arkiv"]);
  });

  it("lists none when all credentials are set", () => {
    assert.deepEqual(missingCredentials(loadConfig({ ...BASE_TEST_ENV, ...FAKE_CREDENTIALS })), []);
  });

  it("does not require the optional merchant private key", () => {
    const { HEDERA_MERCHANT_PRIVATE_KEY: _k, ...creds } = FAKE_CREDENTIALS;
    assert.deepEqual(missingCredentials(loadConfig({ ...BASE_TEST_ENV, ...creds })), []);
  });

  it("reports a group as missing when only part of it is set", () => {
    const config = loadConfig({ ...BASE_TEST_ENV, LLM_API_KEY: FAKE_CREDENTIALS.LLM_API_KEY });
    assert.ok(missingCredentials(config).includes("LLM"));
  });
});

describe("hbarToTinybars", () => {
  it("converts exactly, with no floating point error", () => {
    assert.equal(hbarToTinybars("0.10"), 10_000_000n);
    assert.equal(hbarToTinybars("1"), 100_000_000n);
    assert.equal(hbarToTinybars("0.00000001"), 1n);
    assert.equal(hbarToTinybars("0.3"), 30_000_000n);
    assert.equal(hbarToTinybars("123.45678901"), 12_345_678_901n);
  });

  it("rejects malformed amounts", () => {
    for (const bad of ["", "-1", "1.", ".5", "0.000000001", "1e3", "abc", "1,5"]) {
      assert.throws(() => hbarToTinybars(bad), Error, `should reject ${JSON.stringify(bad)}`);
    }
  });

  it("is used for MAX_PAYMENT_PER_CALL, which must be positive", () => {
    assert.equal(maxPaymentPerCallTinybars(loadConfig(BASE_TEST_ENV)), 10_000_000n);
    assert.throws(() => loadConfig({ ...BASE_TEST_ENV, MAX_PAYMENT_PER_CALL: "0" }), ConfigError);
    assert.throws(
      () => loadConfig({ ...BASE_TEST_ENV, MAX_PAYMENT_PER_CALL: "0.000000001" }),
      (err: unknown) =>
        err instanceof ConfigError &&
        err.problems.length === 1 &&
        /MAX_PAYMENT_PER_CALL must be a decimal HBAR amount/.test(err.problems[0] ?? ""),
    );
  });
});
