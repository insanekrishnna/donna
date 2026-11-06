import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import type { StepStatus } from "../lib/api";

export interface TimelineItem {
  key: string;
  title: string;
  detail?: string;
  status: StepStatus;
  extra?: ReactNode;
}

function Dot({ status }: { status: StepStatus }) {
  if (status === "done")
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-donna-success text-white">
        <Check size={12} aria-hidden />
      </span>
    );
  if (status === "failed")
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-donna-danger text-white">
        <X size={12} aria-hidden />
      </span>
    );
  if (status === "running")
    return (
      <span className="relative flex h-5 w-5 items-center justify-center">
        <span className="absolute h-5 w-5 animate-ping rounded-full bg-donna-warn/40" />
        <span className="h-3 w-3 rounded-full bg-donna-warn" />
      </span>
    );
  return <span className="h-5 w-5 rounded-full border-2 border-donna-line bg-donna-surface" />;
}

const STATUS_TEXT: Record<StepStatus, string> = { pending: "Waiting", running: "Working", done: "Done", failed: "Failed" };

export function ProgressTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol>
      {items.map((it, i) => (
        <li key={it.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <Dot status={it.status} />
            {i < items.length - 1 && <span className="w-px flex-1 bg-donna-line" />}
          </div>
          <div className="min-w-0 flex-1 pb-6">
            <p className="font-medium">
              {it.title} <span className="sr-only">({STATUS_TEXT[it.status]})</span>
            </p>
            {it.detail && <p className="text-sm text-donna-muted">{it.detail}</p>}
            {it.extra && <div className="mt-2 flex flex-wrap gap-2">{it.extra}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
