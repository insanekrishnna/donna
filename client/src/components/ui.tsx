import { AlertTriangle, Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-donna-muted hover:text-donna-ink"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

export function Spinner({ text }: { text: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-donna-muted">
      <Loader2 size={16} className="animate-spin" aria-hidden />
      {text}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-donna-danger/30 bg-donna-surface p-4 sm:flex-row sm:items-center">
      <AlertTriangle size={18} className="shrink-0 text-donna-danger" aria-hidden />
      <p className="flex-1 text-sm">{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ text, action }: { text: string; action?: { label: string; href: string } }) {
  return (
    <div className="card flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-donna-muted">{text}</p>
      {action && (
        <a className="btn-primary" href={action.href}>
          {action.label}
        </a>
      )}
    </div>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      {subtitle && <p className="mt-2 text-donna-muted">{subtitle}</p>}
    </div>
  );
}
