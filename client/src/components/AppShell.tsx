import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import type { Route } from "../lib/router";
import { WalletButton } from "./WalletButton";

const NAV: { href: string; label: string; pages: Route["page"][] }[] = [
  { href: "#/marketplace", label: "Marketplace", pages: ["marketplace"] },
  { href: "#/create", label: "Create Agent", pages: ["create"] },
  { href: "#/tasks/new", label: "Tasks", pages: ["new-task", "task"] },
  { href: "#/payments", label: "Payments", pages: ["payments"] },
];

function ServerStatus() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000, retry: false });
  if (health.isPending) return <span>Checking server...</span>;
  if (health.isError) return <span className="text-donna-danger">Server not reachable</span>;
  const missing = health.data.missing;
  return (
    <span className={missing.length ? "text-donna-warn" : "text-donna-success"}>
      {missing.length ? `Connected. Not configured: ${missing.join(", ")}` : "Connected"}
    </span>
  );
}

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-donna-line bg-donna-surface">
        <div className="mx-auto flex max-w-content flex-wrap items-center gap-4 px-4 py-3">
          <a href="#/" className="flex items-center gap-1 text-lg font-semibold">
            donna<span className="h-2 w-2 rounded-full bg-donna-accent" aria-hidden />
          </a>
          <nav aria-label="Main" className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {NAV.map((n) => {
              const active = n.pages.includes(route.page);
              return (
                <a
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-donna-accent-soft text-donna-accent" : "text-donna-muted hover:text-donna-ink"}`}
                >
                  {n.label}
                </a>
              );
            })}
          </nav>
          <div className="ml-auto">
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-content flex-1 px-4 py-8 pb-32">{children}</main>
      <footer className="border-t border-donna-line">
        <div className="mx-auto flex max-w-content flex-wrap justify-between gap-2 px-4 py-4 text-xs text-donna-muted">
          <span>Donna testnet demo. Listings on Arkiv, payments on Hedera testnet.</span>
          <ServerStatus />
        </div>
      </footer>
    </div>
  );
}
