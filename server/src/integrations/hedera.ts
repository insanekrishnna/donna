import type { RequestHandler } from "express";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { type ClientHederaSigner, createClientHederaSigner, ExactHederaScheme, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme as ExactHederaServerScheme } from "@x402/hedera/exact/server";
import { z } from "zod";
import { type Config, MARKET_SNAPSHOT_PRICE_TINYBARS, maxPaymentPerCallTinybars } from "../config.js";
import { AppError, redactSecretValues } from "../errors.js";
import type { PaymentReceipt, Store } from "../store/store.js";

/**
 * Hedera x402 payments (ARCHITECTURE.md section 7).
 *
 * Merchant: GET /api/services/market-snapshot is protected by the x402 middleware. Without a
 * payment it answers 402 with the payment requirements; the facilitator verifies and settles.
 *
 * Buyer: an agent pays with HEDERA_AGENT_PRIVATE_KEY. Before anything is signed we read the 402
 * requirements and refuse if the price is above MAX_PAYMENT_PER_CALL, or if the request is for
 * a different network, asset or payee. The SDK's spend controls enforce the same cap as a backstop.
 *
 * Receipts hold only real values: the transaction ID comes from the PAYMENT-RESPONSE header.
 */

export const HEDERA_NETWORK = "hedera:testnet" as const;
export const HBAR_ASSET = "0.0.0";
export const MARKET_SNAPSHOT_PATH = "/api/services/market-snapshot";
/** The paid service's ID in receipts: who was paid. */
export const MARKET_SNAPSHOT_PAYEE = "market-snapshot";

/** Only called with IDs that passed HEDERA_TX_ID, so the raw form (with "@") is safe in the path. */
export function hashScanUrl(transactionId: string): string {
  return `https://hashscan.io/testnet/transaction/${transactionId}`;
}

/** Hedera transaction ID, for example 0.0.9185802@1793986270.286756205. */
const HEDERA_TX_ID = /^0\.0\.\d+@\d+\.\d+$/;

const settleSchema = z.object({
  success: z.literal(true),
  transaction: z.string().regex(HEDERA_TX_ID, "not a Hedera transaction ID"),
  network: z.literal(HEDERA_NETWORK),
});

// ---------------------------------------------------------------- merchant

/** x402 middleware for the market snapshot route. Requires HEDERA_MERCHANT_ACCOUNT_ID. */
export function createMerchantPaywall(config: Config): RequestHandler {
  const payTo = config.HEDERA_MERCHANT_ACCOUNT_ID;
  if (!payTo) throw new AppError(503, "HEDERA_NOT_CONFIGURED", "Hedera is not configured on the server.");

  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: config.HEDERA_FACILITATOR_URL })).register(
    HEDERA_NETWORK,
    new ExactHederaServerScheme(),
  );

  return paymentMiddleware(
    {
      [`GET ${MARKET_SNAPSHOT_PATH}`]: {
        accepts: {
          scheme: "exact",
          network: HEDERA_NETWORK,
          payTo,
          // Never a "$" money string: that converts to USDC. HBAR is given in tinybars.
          price: { asset: HBAR_ASSET, amount: MARKET_SNAPSHOT_PRICE_TINYBARS.toString() },
        },
        description: "Donna market snapshot (static demo dataset)",
        mimeType: "application/json",
      },
    },
    server,
  );
}

// ---------------------------------------------------------------- buyer

export interface BuyContext {
  taskId: string;
  payerAgentId: string;
  payeeAgentId: string;
}

export interface PaidResult {
  data: unknown;
  receipt: PaymentReceipt;
}

export interface HederaBuyer {
  /** GET a paid URL: handle the 402, check the price, sign, retry, and record the receipt. */
  buy(url: string, ctx: BuyContext): Promise<PaidResult>;
}

export interface HederaBuyerOptions {
  /** Tests only: replace the SDK signer. */
  signer?: ClientHederaSigner;
  fetch?: typeof globalThis.fetch;
}

const requirementSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  asset: z.string(),
  amount: z.string().regex(/^\d+$/, "amount must be an integer string"),
  payTo: z.string(),
});

export function createHederaBuyer(config: Config, store: Store, options: HederaBuyerOptions = {}): HederaBuyer {
  const accountId = config.HEDERA_AGENT_ACCOUNT_ID;
  const privateKey = config.HEDERA_AGENT_PRIVATE_KEY;
  const merchant = config.HEDERA_MERCHANT_ACCOUNT_ID;
  if (!accountId || !privateKey || !merchant) {
    throw new AppError(503, "HEDERA_NOT_CONFIGURED", "Hedera is not configured on the server.");
  }
  const secrets = [privateKey, config.HEDERA_MERCHANT_PRIVATE_KEY];
  const capTinybars = maxPaymentPerCallTinybars(config);
  const baseFetch = options.fetch ?? globalThis.fetch;

  const signer =
    options.signer ?? createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(privateKey), { network: HEDERA_NETWORK });

  const client = x402Client.fromConfig({
    schemes: [{ network: HEDERA_NETWORK, client: new ExactHederaScheme(signer) }],
    // Without this entry the default spend controls reject HBAR. The cap is a backstop for our own check.
    spendControls: {
      allowedAssets: [{ network: HEDERA_NETWORK, asset: HBAR_ASSET, maxAmountPerPayment: capTinybars.toString() }],
    },
  });
  const payingFetch = wrapFetchWithPayment(baseFetch, client);

  function fail(code: string, message: string, status = 502): AppError {
    return new AppError(status, code, message);
  }

  /** Read the 402 requirements and refuse anything we would not pay. Nothing is signed here. */
  async function checkRequirements(url: string): Promise<bigint> {
    let res: Response;
    try {
      res = await baseFetch(url);
    } catch {
      throw fail("PAYMENT_SERVICE_UNREACHABLE", "The paid service could not be reached.");
    }
    if (res.status !== 402) {
      throw fail("PAYMENT_NOT_REQUESTED", `The paid service answered HTTP ${res.status} instead of 402 Payment Required.`);
    }
    const header = res.headers.get("PAYMENT-REQUIRED");
    if (!header) throw fail("PAYMENT_REQUIREMENTS_MISSING", "The paid service sent 402 without payment requirements.");

    let accepts: unknown;
    try {
      accepts = decodePaymentRequiredHeader(header).accepts;
    } catch {
      throw fail("PAYMENT_REQUIREMENTS_INVALID", "The paid service sent unreadable payment requirements.");
    }
    const parsed = z.array(requirementSchema).min(1).safeParse(accepts);
    if (!parsed.success) throw fail("PAYMENT_REQUIREMENTS_INVALID", "The paid service sent unreadable payment requirements.");

    const option = parsed.data.find((r) => r.network === HEDERA_NETWORK && r.asset === HBAR_ASSET && r.scheme === "exact");
    if (!option) throw fail("PAYMENT_UNSUPPORTED", "The paid service does not accept HBAR on Hedera testnet.");
    if (option.payTo !== merchant) {
      throw fail("PAYMENT_WRONG_PAYEE", "The paid service asked to be paid to an unexpected account. Nothing was signed.");
    }
    const amount = BigInt(option.amount);
    if (amount > capTinybars) {
      throw fail(
        "PAYMENT_OVER_LIMIT",
        `The price (${option.amount} tinybars) is above MAX_PAYMENT_PER_CALL (${capTinybars} tinybars). Nothing was signed.`,
        402,
      );
    }
    return amount;
  }

  return {
    async buy(url, ctx) {
      const amountTinybars = await checkRequirements(url);

      const recordFailure = () =>
        store.addReceipt({ ...ctx, amountTinybars, status: "failed", createdAt: Date.now() });

      let res: Response;
      try {
        res = await payingFetch(url);
      } catch (err) {
        const detail = err instanceof Error ? `${err.name}: ${err.message}` : "non-Error value thrown";
        console.error(redactSecretValues(`x402 payment failed: ${detail}`, secrets));
        await recordFailure();
        throw fail("PAYMENT_FAILED", "The payment could not be signed or sent. No data was received.");
      }

      if (res.status !== 200) {
        await recordFailure();
        throw fail("PAYMENT_REJECTED", `The paid service did not accept the payment (HTTP ${res.status}).`);
      }

      const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
      let settled: z.infer<typeof settleSchema>;
      try {
        if (!header) throw new Error("missing");
        settled = settleSchema.parse(decodePaymentResponseHeader(header));
      } catch {
        await recordFailure();
        throw fail("PAYMENT_UNCONFIRMED", "The service answered, but no Hedera settlement was confirmed. The receipt is marked failed.");
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      const receipt = await store.addReceipt({
        ...ctx,
        amountTinybars,
        hederaTxId: settled.transaction,
        hashScanUrl: hashScanUrl(settled.transaction),
        status: "settled",
        createdAt: Date.now(),
      });
      return { data, receipt };
    },
  };
}

/** Receipts as JSON: bigint amounts become strings, plus a decimal HBAR value for display. */
export function receiptToJson(r: PaymentReceipt, toHbar: (t: bigint) => string) {
  return { ...r, amountTinybars: r.amountTinybars.toString(), amountHbar: toHbar(r.amountTinybars) };
}
