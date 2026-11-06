import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { ClientHederaSigner } from "@x402/hedera";
import { loadConfig } from "../src/config.js";
import { AppError } from "../src/errors.js";
import { createHederaBuyer, hashScanUrl, MARKET_SNAPSHOT_PATH } from "../src/integrations/hedera.js";
import { MemoryStore } from "../src/store/memoryStore.js";
import { BASE_TEST_ENV, FAKE_CREDENTIALS, startTestServer } from "./helpers.js";

/**
 * Buyer-side checks against a local stand-in merchant. They prove what we refuse and how we
 * record failures. The real payment path (facilitator, chain) is covered in test/live/.
 */
const env = { ...BASE_TEST_ENV, ...FAKE_CREDENTIALS };
const cfg = loadConfig(env);
const MERCHANT = FAKE_CREDENTIALS.HEDERA_MERCHANT_ACCOUNT_ID;
const ctx = { taskId: "t1", payerAgentId: "research", payeeAgentId: "market-snapshot" };

type Behavior = { amount?: string; payTo?: string; status?: number; paidStatus?: number; settleHeader?: string | null };
let behavior: Behavior = {};

function requirements(b: Behavior) {
  return encodePaymentRequiredHeader({
    x402Version: 2,
    resource: { url: "http://local/snapshot", description: "test", mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "hedera:testnet",
        asset: "0.0.0",
        amount: b.amount ?? "1000000",
        payTo: b.payTo ?? MERCHANT,
        maxTimeoutSeconds: 60,
        extra: { feePayer: "0.0.9185802" },
      },
    ],
  });
}

const merchant = createServer((req, res: ServerResponse) => {
  const paid = Boolean(req.headers["payment-signature"] ?? req.headers["x-payment"]);
  if (!paid) {
    if (behavior.status && behavior.status !== 402) {
      res.writeHead(behavior.status).end("{}");
      return;
    }
    res.writeHead(402, { "PAYMENT-REQUIRED": requirements(behavior), "content-type": "application/json" }).end("{}");
    return;
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (behavior.settleHeader !== null) {
    headers["PAYMENT-RESPONSE"] =
      behavior.settleHeader ??
      encodePaymentResponseHeader({ success: true, transaction: "0.0.9185802@1794000000.123456789", network: "hedera:testnet" });
  }
  res.writeHead(behavior.paidStatus ?? 200, headers).end(JSON.stringify({ label: "data" }));
});
let url: string;
before(async () => {
  await new Promise<void>((r) => merchant.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(merchant.address() as AddressInfo).port}/snapshot`;
});
after(() => new Promise<void>((r) => merchant.close(() => r())));

/** A signer that counts calls and returns an opaque placeholder instead of a real signed transaction. */
function spySigner() {
  const spy = { calls: 0 };
  const signer: ClientHederaSigner = {
    accountId: FAKE_CREDENTIALS.HEDERA_AGENT_ACCOUNT_ID,
    async createPartiallySignedTransferTransaction() {
      spy.calls += 1;
      return Buffer.from("test-placeholder-not-a-transaction").toString("base64");
    },
  };
  return { spy, signer };
}

async function rejectsWithCode(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (err: unknown) => err instanceof AppError && err.code === code);
}

describe("Hedera buyer", () => {
  it("records a settled receipt with the transaction ID and HashScan link from PAYMENT-RESPONSE", async () => {
    behavior = {};
    const store = new MemoryStore();
    const { spy, signer } = spySigner();
    const { data, receipt } = await createHederaBuyer(cfg, store, { signer }).buy(url, ctx);
    assert.deepEqual(data, { label: "data" });
    assert.equal(spy.calls, 1);
    assert.equal(receipt.status, "settled");
    assert.equal(receipt.hederaTxId, "0.0.9185802@1794000000.123456789");
    assert.equal(receipt.hashScanUrl, "https://hashscan.io/testnet/transaction/0.0.9185802@1794000000.123456789");
    assert.equal(receipt.amountTinybars, 1_000_000n);
  });

  it("refuses a price above MAX_PAYMENT_PER_CALL before signing", async () => {
    behavior = { amount: "20000000" }; // 0.2 HBAR > 0.10 cap
    const store = new MemoryStore();
    const { spy, signer } = spySigner();
    await rejectsWithCode(createHederaBuyer(cfg, store, { signer }).buy(url, ctx), "PAYMENT_OVER_LIMIT");
    assert.equal(spy.calls, 0);
    assert.equal((await store.listReceipts()).length, 0);
  });

  it("refuses to pay an account other than the configured merchant", async () => {
    behavior = { payTo: "0.0.9999999" };
    const { spy, signer } = spySigner();
    await rejectsWithCode(createHederaBuyer(cfg, new MemoryStore(), { signer }).buy(url, ctx), "PAYMENT_WRONG_PAYEE");
    assert.equal(spy.calls, 0);
  });

  it("does not pay when the service does not ask for payment", async () => {
    behavior = { status: 200 };
    const { spy, signer } = spySigner();
    await rejectsWithCode(createHederaBuyer(cfg, new MemoryStore(), { signer }).buy(url, ctx), "PAYMENT_NOT_REQUESTED");
    assert.equal(spy.calls, 0);
  });

  it("never invents a transaction ID: no PAYMENT-RESPONSE means a failed receipt with no ID", async () => {
    behavior = { settleHeader: null };
    const store = new MemoryStore();
    const { signer } = spySigner();
    await rejectsWithCode(createHederaBuyer(cfg, store, { signer }).buy(url, ctx), "PAYMENT_UNCONFIRMED");
    const [r] = await store.listReceipts();
    assert.equal(r?.status, "failed");
    assert.equal(r?.hederaTxId, undefined);
  });

  it("rejects a PAYMENT-RESPONSE that is not a successful Hedera testnet settlement", async () => {
    for (const settle of [
      { success: false, transaction: "", network: "hedera:testnet" },
      { success: true, transaction: "not-a-tx-id", network: "hedera:testnet" },
      { success: true, transaction: "0.0.1@1.2", network: "hedera:mainnet" },
    ]) {
      behavior = { settleHeader: encodePaymentResponseHeader(settle as never) };
      const { signer } = spySigner();
      await rejectsWithCode(createHederaBuyer(cfg, new MemoryStore(), { signer }).buy(url, ctx), "PAYMENT_UNCONFIRMED");
    }
  });

  it("refuses to build without Hedera credentials", () => {
    assert.throws(
      () => createHederaBuyer(loadConfig(BASE_TEST_ENV), new MemoryStore()),
      (err: unknown) => err instanceof AppError && err.code === "HEDERA_NOT_CONFIGURED",
    );
  });

  it("hashScanUrl points at testnet", () => {
    assert.equal(hashScanUrl("0.0.1@2.3"), "https://hashscan.io/testnet/transaction/0.0.1@2.3");
  });
});

describe("payment routes", () => {
  it("the market snapshot returns 503 and no data when Hedera is not configured", async () => {
    const server = await startTestServer(BASE_TEST_ENV);
    try {
      const res = await fetch(`${server.baseUrl}${MARKET_SNAPSHOT_PATH}`);
      assert.equal(res.status, 503);
      assert.equal(((await res.json()) as { code: string }).code, "HEDERA_NOT_CONFIGURED");
    } finally {
      await server.close();
    }
  });

  it("GET /api/payments lists receipts with string amounts", async () => {
    const store = new MemoryStore();
    await store.addReceipt({ ...ctx, amountTinybars: 1_000_000n, status: "failed", createdAt: 1 });
    const server = await startTestServer(BASE_TEST_ENV, null, null, { store });
    try {
      const res = await fetch(`${server.baseUrl}/api/payments`);
      assert.equal(res.status, 200);
      const { receipts } = (await res.json()) as { receipts: Record<string, unknown>[] };
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0]?.amountTinybars, "1000000");
      assert.equal(receipts[0]?.amountHbar, "0.01");
    } finally {
      await server.close();
    }
  });

  it("POST /api/dev/buy-snapshot returns 503 without Hedera, and 404 in production", async () => {
    const dev = await startTestServer(BASE_TEST_ENV);
    const prod = await startTestServer({ ...BASE_TEST_ENV, NODE_ENV: "production" });
    try {
      assert.equal((await fetch(`${dev.baseUrl}/api/dev/buy-snapshot`, { method: "POST" })).status, 503);
      assert.equal((await fetch(`${prod.baseUrl}/api/dev/buy-snapshot`, { method: "POST" })).status, 404);
    } finally {
      await dev.close();
      await prod.close();
    }
  });
});
