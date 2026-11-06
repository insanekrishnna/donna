import { Wallet } from "lucide-react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { shortAddress } from "../lib/format";
import { arkivChain } from "../lib/wagmi";
import { CopyButton } from "./ui";

export function useWallet() {
  const connection = useConnection();
  const onArkiv = connection.chainId === arkivChain.id;
  return { ...connection, onArkiv };
}

export function WalletButton() {
  const { address, isConnected, onArkiv, chain } = useWallet();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const injectedConnector = connectors[0];

  if (!isConnected || !address) {
    const noWallet = !injectedConnector || typeof window === "undefined" || !("ethereum" in window);
    return (
      <div className="flex flex-col items-end">
        <button
          type="button"
          className="btn-primary"
          disabled={connect.isPending}
          onClick={() => {
            if (noWallet) {
              window.open("https://metamask.io/download/", "_blank", "noopener");
              return;
            }
            connect.mutate({ connector: injectedConnector });
          }}
        >
          <Wallet size={16} aria-hidden />
          {noWallet ? "Install a wallet" : connect.isPending ? "Connecting..." : "Connect wallet"}
        </button>
        {connect.error && <span className="mt-1 text-xs text-donna-danger">Connection was cancelled or failed.</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {!onArkiv ? (
        <button
          type="button"
          className="btn-secondary border-donna-warn text-donna-warn"
          disabled={switchChain.isPending}
          onClick={() => switchChain.mutate({ chainId: arkivChain.id })}
        >
          {switchChain.isPending ? "Switching..." : "Switch to Arkiv"}
        </button>
      ) : (
        <span className="hidden text-xs text-donna-muted sm:inline">{chain?.name ?? "Arkiv"} testnet</span>
      )}
      <span className="inline-flex items-center gap-1 rounded-lg border border-donna-line bg-donna-surface px-2 py-1 font-mono text-sm">
        {shortAddress(address)}
        <CopyButton value={address} label="Copy address" />
      </span>
      <button type="button" className="text-xs text-donna-muted underline" onClick={() => disconnect.mutate()}>
        Disconnect
      </button>
    </div>
  );
}
