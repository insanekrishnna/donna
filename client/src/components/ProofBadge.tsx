import { ExternalLink } from "lucide-react";
import { shortAddress } from "../lib/format";
import { CopyButton } from "./ui";

/** A real ID from a partner, with a link where one exists. Only ever rendered with a real value. */
export function ProofBadge({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-lg border border-donna-line bg-donna-accent-soft px-2 py-1 text-xs">
      <span className="font-medium text-donna-accent">{label}</span>
      <span className="truncate font-mono" title={value}>
        {shortAddress(value, 10, 6)}
      </span>
      <CopyButton value={value} label={`Copy ${label}`} />
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label}`} className="text-donna-accent">
          <ExternalLink size={12} aria-hidden />
        </a>
      )}
    </span>
  );
}
