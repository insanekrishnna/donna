import { ExternalLink } from "lucide-react";
import type { Receipt } from "../lib/api";
import { hbar, shortAddress } from "../lib/format";

export const AGENT_NAMES: Record<string, string> = {
  research: "Research Agent",
  analyst: "Data Analyst Agent",
  writer: "Report Writer Agent",
  "market-snapshot": "Market data service",
};

export function ReceiptRow({ r }: { r: Receipt }) {
  return (
    <tr className="border-b border-donna-line text-sm">
      <td className="py-3 pr-3">
        {AGENT_NAMES[r.payerAgentId] ?? r.payerAgentId} <span className="text-donna-muted">paid</span>{" "}
        {AGENT_NAMES[r.payeeAgentId] ?? r.payeeAgentId}
      </td>
      <td className="py-3 pr-3 font-medium">{hbar(r.amountHbar)}</td>
      <td className="py-3 pr-3">
        <span className={r.status === "settled" ? "text-donna-success" : "text-donna-danger"}>
          {r.status === "settled" ? "Confirmed" : "Failed"}
        </span>
      </td>
      <td className="py-3 font-mono text-xs">
        {r.hederaTxId && r.hashScanUrl ? (
          <a
            href={r.hashScanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-donna-accent underline"
          >
            {shortAddress(r.hederaTxId, 12, 8)}
            <ExternalLink size={12} aria-hidden />
          </a>
        ) : (
          <span className="text-donna-muted">No transaction</span>
        )}
      </td>
    </tr>
  );
}

export function ReceiptTable({ receipts }: { receipts: Receipt[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead>
          <tr className="border-b border-donna-line text-left text-xs text-donna-muted">
            <th className="py-2 pr-3 font-medium">Payment</th>
            <th className="py-2 pr-3 font-medium">Amount</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 font-medium">Hedera tx</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <ReceiptRow key={r.id} r={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
