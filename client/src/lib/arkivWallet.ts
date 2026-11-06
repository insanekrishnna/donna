import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { custom, type EIP1193Provider, type Hex } from "viem";
import { AgentListing, encodeDataJson } from "../../../server/src/schemas/arkiv";
import type { PreparedListing } from "./api";
import { ARKIV_RPC_URL, arkivChain } from "./wagmi";

/** Same lifetime as the server's listings (ARCHITECTURE.md 4.1). */
const LISTING_LIFETIME = ExpirationTime.fromDays(30);

/** Methods that need the user's wallet. Everything else is a read and goes to our RPC. */
const WALLET_METHODS = new Set([
  "eth_sendTransaction",
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
]);

let rpcId = 0;
async function rpcRead(method: string, params: unknown): Promise<unknown> {
  const res = await fetch(ARKIV_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params: params ?? [] }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
  if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code });
  return body.result;
}

/** Signing goes to the wallet; reads (gas, nonce, receipts) go to Arkiv with our browser key. */
function splitProvider(wallet: EIP1193Provider) {
  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      if (WALLET_METHODS.has(method)) return wallet.request({ method, params } as never);
      return rpcRead(method, params);
    },
  });
}

export interface PublishResult {
  entityKey: Hex;
  txHash: Hex;
}

/**
 * Write a listing to Arkiv from the user's wallet, so the wallet is the owner and creator.
 * The fields come from POST /api/agents/prepare, which already validated them.
 */
export async function publishListing(wallet: EIP1193Provider, address: Hex, listing: PreparedListing): Promise<PublishResult> {
  const client = createWalletClient({ chain: arkivChain, transport: splitProvider(wallet), account: address });
  const result = await client.createEntity(
    AgentListing,
    { agentId: listing.agentId, category: listing.category, data: encodeDataJson(listing.data) },
    { expiration: LISTING_LIFETIME },
  );
  return { entityKey: result.entityKey, txHash: result.txHash };
}

/** Plain-language message for a failed publish. Never shows raw errors. */
export function describePublishError(err: unknown): string {
  const e = err as { code?: number; name?: string; message?: string; shortMessage?: string; cause?: { code?: number } };
  const code = e?.code ?? e?.cause?.code;
  const text = `${e?.name ?? ""} ${e?.shortMessage ?? ""} ${e?.message ?? ""}`.toLowerCase();
  if (code === 4001 || text.includes("user rejected") || text.includes("denied")) {
    return "You cancelled the request in your wallet. Nothing was published.";
  }
  if (text.includes("insufficient funds")) {
    return "Your wallet has no tGLM for gas on Arkiv. Get free test tokens at hub.arkiv.network/faucet, then try again.";
  }
  if (text.includes("chain") && text.includes("mismatch")) {
    return "Your wallet is on a different network. Switch to Arkiv Rabdi and try again.";
  }
  return "Publishing to Arkiv failed. Check your wallet and try again.";
}
