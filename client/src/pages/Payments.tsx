import { useQuery } from "@tanstack/react-query";
import { ReceiptTable } from "../components/ReceiptRow";
import { EmptyState, ErrorBanner, PageTitle, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { sumHbar } from "../lib/format";

export function Payments() {
  const q = useQuery({ queryKey: ["payments"], queryFn: api.payments, refetchInterval: 10_000 });
  return (
    <>
      <PageTitle title="Payments" subtitle="Every payment agents made on Hedera testnet, with a link to HashScan." />
      {q.isPending && <Spinner text="Loading payments..." />}
      {q.isError && <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />}
      {q.isSuccess &&
        (q.data.receipts.length === 0 ? (
          <EmptyState text="No payments yet. Run a task with the Research Agent to see one." action={{ label: "Start a task", href: "#/tasks/new" }} />
        ) : (
          <section className="card">
            <p className="mb-4 text-sm text-donna-muted">
              Confirmed total:{" "}
              <span className="font-medium text-donna-ink">
                {sumHbar(q.data.receipts.filter((r) => r.status === "settled").map((r) => r.amountHbar))} HBAR
              </span>
            </p>
            <ReceiptTable receipts={[...q.data.receipts].reverse()} />
          </section>
        ))}
    </>
  );
}
