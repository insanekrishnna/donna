import { Wallet } from "lucide-react";
import { useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { shortAddress } from "../lib/format";
import { arkivChain } from "../lib/wagmi";
import { CopyButton } from "./ui";

export function useWallet() {
  const connection = useConnection();
  const onArkiv = connection.chainId === arkivChain.id;
  return { ...connection, onArkiv };
}

/**
 * Wallets the browser announced (EIP-6963), MetaMask first. The generic "Injected" entry is
 * whichever extension grabbed window.ethereum (often Phantom), so it is used only when no
 * wallet announced itself.
 */
function useWalletChoices() {
  const connectors = useConnectors();
  const announced = connectors.filter((c) => c.id !== "injected");
  const list = announced.length > 0 ? [...announced] : [...connectors];
  const isMetaMask = (c: (typeof list)[number]) => c.id === "io.metamask" || /metamask/i.test(c.name);
  return list.sort((a, b) => Number(isMetaMask(b)) - Number(isMetaMask(a)));
}

export function WalletButton() {
  const { address, isConnected, onArkiv, chain, connector } = useWallet();
  const choices = useWalletChoices();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const [open, setOpen] = useState(false);

  if (!isConnected || !address) {
    if (choices.length === 0) {
      return (
        <a className="btn-primary" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">
          <Wallet size={16} aria-hidden />
          Install MetaMask
        </a>
      );
    }
    return (
      <div className="relative flex flex-col items-end">
        <button
          type="button"
          className="btn-primary"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={connect.isPending}
          onClick={() => setOpen((o) => !o)}
        >
          <Wallet size={16} aria-hidden />
          {connect.isPending ? "Connecting..." : "Connect wallet"}
        </button>
        {open && (
          <div role="menu" className="absolute right-0 top-12 z-20 w-64 rounded-xl border border-donna-line bg-donna-surface p-2 shadow-sm">
            <p className="px-2 pb-2 text-xs text-donna-muted">Choose a wallet that supports custom EVM networks, like MetaMask.</p>
            {choices.map((c) => (
              <button
                key={c.uid}
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-donna-bg"
                onClick={() => {
                  setOpen(false);
                  connect.mutate({ connector: c });
                }}
              >
                {c.icon ? <img src={c.icon} alt="" className="h-5 w-5" /> : <Wallet size={16} aria-hidden />}
                {c.name}
              </button>
            ))}
          </div>
        )}
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
      ) : null}
      {!onArkiv && switchChain.error && (
        <span role="alert" className="max-w-56 text-xs text-donna-danger">
          {connector?.name ?? "This wallet"} could not switch to Arkiv. Disconnect and connect with MetaMask.
        </span>
      )}
      {onArkiv && (
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
