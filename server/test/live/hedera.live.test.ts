import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { type Config, ConfigError, loadConfig, loadLocalEnvFile, MARKET_SNAPSHOT_PRICE_TINYBARS } from "../../src/config.js";
import { AppError } from "../../src/errors.js";
import {
  createHederaBuyer,
  createMerchantPaywall,
  HEDERA_NETWORK,
  MARKET_SNAPSHOT_PATH,
} from "../../src/integrations/hedera.js";
import { MemoryStore } from "../../src/store/memoryStore.js";
import { startTestServer } from "../helpers.js";

/**
 * Live tests on Hedera testnet through the real x402 facilitator. Nothing is mocked.
 * Run: npm run test:live. Skipped when the Hedera variables are absent.
 * Each run pays 0.01 testnet HBAR once. Logs print public IDs only.
 */
loadLocalEnvFile();
let configProblems: string[] = [];
const config: Config | undefined = (() => {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) configProblems = err.problems;
    else throw err;
    return undefined;
  }
})();
const skip = !config
  ? `config is invalid: ${configProblems.join("; ")}`
  : !config.HEDERA_MERCHANT_ACCOUNT_ID || !config.HEDERA_AGENT_ACCOUNT_ID || !config.HEDERA_AGENT_PRIVATE_KEY
    ? "HEDERA_MERCHANT_ACCOUNT_ID, HEDERA_AGENT_ACCOUNT_ID and HEDERA_AGENT_PRIVATE_KEY must be set in .env"
    : false;

const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

/** 0.0.123@1700000000.123456789 -> 0.0.123-1700000000-123456789 (mirror node format). */
const toMirrorId = (txId: string) => txId.replace("@", "-").replace(/\.(\d+)$/, "-$1");

describe("Hedera x402 live", { skip }, () => {
  const cfg = config as Config;
  const store = new MemoryStore();
  let server: Awaited<ReturnType<typeof startTestServer>>;
  let url: string;
  let txId: string;

  before(async () => {
    const env = { ...process.env, NODE_ENV: "test" } as Record<string, string>;
    server = await startTestServer(env, null, null, {
      store,
      paywall: createMerchantPaywall(cfg),
      buyer: createHederaBuyer(cfg, store),
    });
    url = `${server.baseUrl}${MARKET_SNAPSHOT_PATH}`;
  });
  after(async () => {
    await server?.close();
  });

  it("1. a plain GET returns 402 with the payment requirements", async () => {
    const res = await fetch(url);
    assert.equal(res.status, 402);
    const header = res.headers.get("PAYMENT-REQUIRED");
    assert.ok(header, "PAYMENT-REQUIRED header expected");
    const option = decodePaymentRequiredHeader(header).accepts[0];
    assert.ok(option);
    assert.equal(option.network, HEDERA_NETWORK);
    assert.equal(option.asset, "0.0.0");
    assert.equal(option.amount, MARKET_SNAPSHOT_PRICE_TINYBARS.toString());
    assert.equal(option.payTo, cfg.HEDERA_MERCHANT_ACCOUNT_ID);
    console.log(`  402: pay ${option.amount} tinybars to ${option.payTo} on ${option.network}`);
  });

  it("2-3. the agent pays, gets HTTP 200 with the data, and a Hedera transaction ID", async () => {
    const res = await fetch(`${server.baseUrl}/api/dev/buy-snapshot`, { method: "POST" });
    const body = (await res.json()) as {
      data: { label: string };
      receipt: { hederaTxId: string; hashScanUrl: string; status: string; amountHbar: string };
    };
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.match(body.data.label, /Static demo snapshot/);
    assert.equal(body.receipt.status, "settled");
    assert.match(body.receipt.hederaTxId, /^0\.0\.\d+@\d+\.\d+$/);
    assert.equal(body.receipt.amountHbar, "0.01");
    txId = body.receipt.hederaTxId;
    console.log(`  Hedera tx: ${txId}`);
    console.log(`  HashScan:  ${body.receipt.hashScanUrl}`);

    const listed = (await (await fetch(`${server.baseUrl}/api/payments`)).json()) as { receipts: { hederaTxId?: string }[] };
    assert.ok(listed.receipts.some((r) => r.hederaTxId === txId), "receipt listed in GET /api/payments");
  });

  it("4. the transaction is on Hedera testnet and moved 0.01 HBAR from the agent to the merchant", async () => {
    assert.ok(txId, "needs test 2-3");
    // The mirror node lags consensus by a few seconds.
    let tx: { result: string; transfers: { account: string; amount: number }[] } | undefined;
    for (let i = 0; i < 15 && !tx; i += 1) {
      const res = await fetch(`${MIRROR}/transactions/${toMirrorId(txId)}`);
      if (res.ok) tx = ((await res.json()) as { transactions: (typeof tx)[] }).transactions[0];
      else await new Promise((r) => setTimeout(r, 2000));
    }
    assert.ok(tx, "transaction not found on the testnet mirror node");
    assert.equal(tx.result, "SUCCESS");
    const amount = Number(MARKET_SNAPSHOT_PRICE_TINYBARS);
    assert.ok(tx.transfers.some((t) => t.account === cfg.HEDERA_AGENT_ACCOUNT_ID && t.amount === -amount), "agent debited");
    assert.ok(tx.transfers.some((t) => t.account === cfg.HEDERA_MERCHANT_ACCOUNT_ID && t.amount === amount), "merchant credited");
    console.log(`  mirror node: ${tx.result}, agent -${amount}, merchant +${amount} tinybars`);
  });

  it("5. with MAX_PAYMENT_PER_CALL below the price, the buyer refuses and signs nothing", async () => {
    let signed = 0;
    const lowCap = createHederaBuyer({ ...cfg, MAX_PAYMENT_PER_CALL: "0.001" }, store, {
      signer: {
        accountId: cfg.HEDERA_AGENT_ACCOUNT_ID as string,
        async createPartiallySignedTransferTransaction() {
          signed += 1;
          throw new Error("must not sign");
        },
      },
    });
    const before = (await store.listReceipts()).length;
    await assert.rejects(
      lowCap.buy(url, { taskId: "live", payerAgentId: "research", payeeAgentId: "market-snapshot" }),
      (err: unknown) => err instanceof AppError && err.code === "PAYMENT_OVER_LIMIT",
    );
    assert.equal(signed, 0);
    assert.equal((await store.listReceipts()).length, before, "no receipt for a refused payment");
    console.log("  cap 0.001 HBAR < price 0.01 HBAR -> PAYMENT_OVER_LIMIT, nothing signed");
  });
});
