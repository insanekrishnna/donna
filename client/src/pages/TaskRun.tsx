import { ChevronDown } from "lucide-react";
import { ProgressTimeline, type TimelineItem } from "../components/ProgressTimeline";
import { ProofBadge } from "../components/ProofBadge";
import { AGENT_NAMES, ReceiptTable } from "../components/ReceiptRow";
import { ErrorBanner, PageTitle, Spinner } from "../components/ui";
import { useTask } from "../hooks/useTask";
import type { StepStatus, TaskView } from "../lib/api";
import { hbar } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { navigate } from "../lib/router";
import { ARKIV_EXPLORER } from "../lib/wagmi";
import { RERUN_KEY } from "./NewTask";

const arkivEntity = (key: string) => `${ARKIV_EXPLORER}/entity/${key}`;
const arkivTx = (hash: string) => `${ARKIV_EXPLORER}/tx/${hash}`;

/** Turn the polled task into timeline rows. Badges appear only once a real ID exists. */
export function buildTimeline(t: TaskView): TimelineItem[] {
  const failed = t.status === "failed";
  const finished = failed || t.status === "completed";
  const a = t.proof.arkiv;
  const planned = t.steps.length > 0;
  const budgetFailed = failed && !!t.error && /budget/i.test(t.error) && t.receipts.length === 0;
  const paidStep = t.steps.find((s) => s.needsPaidData);
  const settled = t.receipts.find((r) => r.status === "settled");
  const paymentFailed = t.receipts.some((r) => r.status === "failed") || (failed && !!t.error && /market data/i.test(t.error));

  const items: TimelineItem[] = [];
  items.push({
    key: "record",
    title: "Record the task on Arkiv",
    detail: "Public record with status and budget. Your task text stays private.",
    status: a.taskEntityKey ? "done" : failed ? "failed" : "running",
    extra: a.taskEntityKey ? (
      <ProofBadge label="Arkiv entity" value={a.taskEntityKey} href={arkivEntity(a.taskEntityKey)} />
    ) : undefined,
  });
  items.push({
    key: "plan",
    title: "Plan the work",
    detail: planned ? `${t.steps.length} ${t.steps.length === 1 ? "step" : "steps"} planned.` : undefined,
    status: planned ? "done" : failed ? "failed" : a.taskEntityKey ? "running" : "pending",
    extra: t.proof.planRequestId ? <ProofBadge label="Plan request ID" value={t.proof.planRequestId} /> : undefined,
  });
  items.push({
    key: "budget",
    title: "Check the budget",
    detail: t.budget.estimatedCostHbar
      ? `Plan costs ${hbar(t.budget.estimatedCostHbar)}. Your budget is ${hbar(t.budget.capHbar)}.`
      : undefined,
    status: budgetFailed ? "failed" : t.budget.estimatedCostHbar ? "done" : planned && !failed ? "running" : "pending",
  });
  if (paidStep) {
    items.push({
      key: "pay",
      title: "Pay for market data on Hedera",
      detail: settled ? `${AGENT_NAMES[settled.payerAgentId] ?? settled.payerAgentId} paid ${hbar(settled.amountHbar)}.` : undefined,
      status: settled ? "done" : paymentFailed ? "failed" : t.status === "running" ? "running" : "pending",
      extra:
        settled?.hederaTxId && settled.hashScanUrl ? (
          <ProofBadge label="Hedera tx" value={settled.hederaTxId} href={settled.hashScanUrl} />
        ) : undefined,
    });
  }
  for (const s of t.steps) {
    items.push({
      key: s.id,
      title: `${AGENT_NAMES[s.agentId] ?? s.agentId}: ${s.instruction}`,
      detail: s.error ?? undefined,
      status: s.status,
      extra: s.llmRequestId ? <ProofBadge label="AI request ID" value={s.llmRequestId} /> : undefined,
    });
  }
  const assignments = a.assignments;
  const finalStatus = a.statusTxHashes.find((x) => x.status === "completed" || x.status === "failed");
  const recordStatus: StepStatus =
    t.status === "completed" ? "done" : failed ? (assignments.length > 0 ? "failed" : "pending") : assignments.length > 0 ? "running" : "pending";
  items.push({
    key: "assign",
    title: "Record who did the work on Arkiv",
    status: recordStatus,
    extra:
      assignments.length || finalStatus ? (
        <>
          {assignments.map((x) => (
            <ProofBadge key={x.entityKey} label={`${x.agentId} assignment`} value={x.entityKey} href={arkivEntity(x.entityKey)} />
          ))}
          {finalStatus && <ProofBadge label={`Status: ${finalStatus.status}`} value={finalStatus.txHash} href={arkivTx(finalStatus.txHash)} />}
        </>
      ) : undefined,
  });
  if (finished && failed) items.forEach((it) => it.status === "running" && (it.status = "failed"));
  return items;
}

function StatusLine({ t }: { t: TaskView }) {
  const text: Record<TaskView["status"], string> = {
    planning: "Planning the work...",
    running: "Agents are working...",
    completed: "Done.",
    failed: "Stopped.",
  };
  const color = t.status === "completed" ? "text-donna-success" : t.status === "failed" ? "text-donna-danger" : "text-donna-warn";
  return <p className={`text-sm font-medium ${color}`}>{text[t.status]}</p>;
}

export function TaskRun({ id }: { id: string }) {
  const q = useTask(id);
  if (q.isPending) return <Spinner text="Loading the task..." />;
  if (q.isError)
    return (q.error as { status?: number }).status === 404 ? (
      <ErrorBanner message="This task does not exist on the server. Tasks are kept in memory, so a server restart clears them." />
    ) : (
      <ErrorBanner message={q.error.message} onRetry={() => void q.refetch()} />
    );

  const t = q.data;
  const done = t.status === "completed";
  const rerun = () => {
    try {
      sessionStorage.setItem(RERUN_KEY, t.task);
    } catch {
      // ignore: the form just starts empty
    }
    navigate("/tasks/new");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
      <div className="space-y-6">
        <div>
          <PageTitle title={done ? "Result" : "Task run"} subtitle={t.task} />
          <StatusLine t={t} />
        </div>
        {t.status === "failed" && t.error && <ErrorBanner message={t.error} onRetry={rerun} />}

        {done && t.report && (
          <section className="card" aria-labelledby="report">
            <h2 id="report" className="sr-only">
              Report
            </h2>
            <Markdown source={t.report} />
          </section>
        )}

        <section className="card" aria-labelledby="progress">
          <h2 id="progress" className="mb-4 font-semibold">
            Progress
          </h2>
          <ProgressTimeline items={buildTimeline(t)} />
        </section>

        {t.steps.some((s) => s.output) && (
          <section className="card space-y-2" aria-labelledby="log">
            <h2 id="log" className="mb-2 font-semibold">
              Agent messages
            </h2>
            {t.steps
              .filter((s) => s.output)
              .map((s) => (
                <details key={s.id} className="rounded-lg border border-donna-line">
                  <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium">
                    {AGENT_NAMES[s.agentId] ?? s.agentId}
                    <ChevronDown size={16} aria-hidden />
                  </summary>
                  <div className="border-t border-donna-line px-4 py-3">
                    <Markdown source={s.output ?? ""} />
                  </div>
                </details>
              ))}
          </section>
        )}
      </div>

      <aside className="space-y-6">
        <section className="card space-y-2 text-sm" aria-labelledby="budget">
          <h2 id="budget" className="font-semibold">
            Budget
          </h2>
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-donna-muted">Budget</dt>
            <dd className="text-right">{hbar(t.budget.capHbar)}</dd>
            <dt className="text-donna-muted">Plan cost</dt>
            <dd className="text-right">{hbar(t.budget.estimatedCostHbar)}</dd>
            <dt className="text-donna-muted">Paid on Hedera</dt>
            <dd className="text-right font-medium">{hbar(t.budget.spentHbar)}</dd>
            <dt className="text-donna-muted">Remaining</dt>
            <dd className="text-right">{hbar(t.budget.remainingHbar)}</dd>
          </dl>
          <p className="pt-2 text-xs text-donna-muted">
            Agent prices are listed prices. In this demo, the on-chain payment is the market data an agent buys.
          </p>
        </section>
        <section className="card text-sm" aria-labelledby="agents-used">
          <h2 id="agents-used" className="mb-2 font-semibold">
            Agents used
          </h2>
          <ul className="space-y-1">
            {[...new Set(t.steps.map((s) => s.agentId))].map((id) => (
              <li key={id}>{AGENT_NAMES[id] ?? id}</li>
            ))}
            {t.steps.length === 0 && <li className="text-donna-muted">Not planned yet.</li>}
          </ul>
        </section>
        {t.receipts.length > 0 && (
          <section className="card" aria-labelledby="receipts">
            <h2 id="receipts" className="mb-2 font-semibold">
              Payments
            </h2>
            <ReceiptTable receipts={t.receipts} />
          </section>
        )}
        {(done || t.status === "failed") && (
          <button type="button" className="btn-secondary w-full" onClick={rerun}>
            Run again
          </button>
        )}
      </aside>
    </div>
  );
}
