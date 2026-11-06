import { rabdi } from "@arkiv-network/sdk/chains";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

/**
 * Wallet setup for the Arkiv testnet (Rabdi, chain 7794095).
 *
 * Two RPC URLs, on purpose:
 * - Our reads use the browser access key (VITE_ARKIV_ACCESS_KEY, restricted to our origins).
 * - The chain we hand to the wallet (for "add network") uses the public endpoint, so the key is
 *   never stored in the user's wallet. Requests from a wallet extension do not carry our origin,
 *   so an origin-restricted key would be refused there anyway.
 */
const accessKey = (import.meta.env.VITE_ARKIV_ACCESS_KEY as string | undefined) ?? "";
const keyed = rabdi({ accessKey });

export const ARKIV_RPC_URL: string = keyed.rpcUrls.default.http[0];
const PUBLIC_RPC_URL = new URL(ARKIV_RPC_URL).origin;

export const arkivChain = {
  ...keyed,
  rpcUrls: { default: { http: [PUBLIC_RPC_URL] } },
} as const;

export const ARKIV_EXPLORER = keyed.blockExplorers.default.url;

export const wagmiConfig = createConfig({
  chains: [arkivChain],
  connectors: [injected()],
  transports: { [arkivChain.id]: http(ARKIV_RPC_URL) },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
