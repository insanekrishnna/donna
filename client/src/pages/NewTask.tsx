import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useWallet } from "../components/WalletButton";
import { EmptyState, ErrorBanner, PageTitle } from "../components/ui";
import { useTeam } from "../hooks/useTeam";
import { api } from "../lib/api";
import { sumHbar } from "../lib/format";
import { navigate } from "../lib/router";

/** Market data the Research Agent buys over Hedera x402 (server: MARKET_SNAPSHOT_PRICE_TINYBARS). */
const MARKET_DATA_HBAR = "0.01";
export const RERUN_KEY = "donna.rerun";

export function NewTask() {
  const { team, remove } = useTeam();
  const wallet = useWallet();
  const [task, setTask] = useState(() => {
    try {
      const saved = sessionStorage.getItem(RERUN_KEY);
      sessionStorage.removeItem(RERUN_KEY);
      return saved ?? "";
    } catch {
      return "";
    }
  });
  const [budget, setBudget] = useState("0.20");
  const [formError, setFormError] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () =>
      api.startTask({
        task: task.trim(),
        budgetHbar: budget.trim(),
        agentIds: team.map((m) => m.agentId),
        ...(wallet.address ? { requesterAddress: wallet.address } : {}),
      }),
    onSuccess: ({ taskId }) => navigate(`/tasks/${taskId}`),
  });

  if (team.length === 0) {
    return (
      <>
        <PageTitle title="New task" />
        <EmptyState text="Your team is empty. Add agents from the marketplace first." action={{ label: "Explore agents", href: "#/marketplace" }} />
      </>
    );
  }

  const hasWriter = team.some((m) => m.agentId === "writer");
  const hasResearch = team.some((m) => m.agentId === "research");
  // Most a task can cost: every agent once, plus market data if Research is on the team.
  const maxCost = sumHbar([...team.map((m) => m.priceHbar), ...(hasResearch ? [MARKET_DATA_HBAR] : [])]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!hasWriter) return setFormError("Add the Report Writer Agent. It writes the final report.");
    if (task.trim().length < 10) return setFormError("Describe the task in at least 10 characters.");
    if (task.trim().length > 2000) return setFormError("Keep the task under 2000 characters.");
    if (!/^\d+(\.\d{1,8})?$/.test(budget.trim()) || !(Number(budget) > 0)) return setFormError("Enter a budget in HBAR, like 0.20.");
    if (Number(budget) > 10) return setFormError("The budget can be at most 10 HBAR.");
    setFormError(null);
    start.mutate();
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="New task" subtitle="Describe what you need. Donna plans it, hires the team, and pays for data within your budget." />
      <section className="card mb-6">
        <h2 className="mb-3 text-sm font-medium">Your team</h2>
        <ul className="space-y-2">
          {team.map((m) => (
            <li key={m.agentId} className="flex items-center justify-between text-sm">
              <span>{m.name}</span>
              <span className="flex items-center gap-3">
                <span className="text-donna-muted">{m.priceHbar} HBAR</span>
                <button type="button" className="text-xs underline" onClick={() => remove(m.agentId)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
          {hasResearch && (
            <li className="flex justify-between text-sm text-donna-muted">
              <span>Market data, paid on Hedera</span>
              <span>{MARKET_DATA_HBAR} HBAR</span>
            </li>
          )}
        </ul>
        <p className="mt-3 border-t border-donna-line pt-3 text-sm">
          Up to <span className="font-medium">{maxCost} HBAR</span> if every agent is used.{" "}
          <a href="#/marketplace" className="text-donna-accent underline">
            Change team
          </a>
        </p>
      </section>

      <form className="card space-y-5" onSubmit={submit} noValidate>
        <div>
          <label htmlFor="task" className="label">
            Task
          </label>
          <textarea
            id="task"
            className="input min-h-36"
            placeholder="Research five AI coding competitors and compare their pricing."
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
          <p className="mt-1 text-xs text-donna-muted">{task.trim().length} / 2000</p>
        </div>
        <div>
          <label htmlFor="budget" className="label">
            Budget (HBAR)
          </label>
          <input id="budget" className="input max-w-40" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
          <p className="mt-1 text-xs text-donna-muted">The most Donna may spend. If the plan costs more, it stops before paying.</p>
        </div>
        {formError && (
          <p role="alert" className="text-sm text-donna-danger">
            {formError}
          </p>
        )}
        {start.isError && <ErrorBanner message={start.error.message} />}
        <button type="submit" className="btn-primary w-full" disabled={start.isPending}>
          {start.isPending ? "Starting..." : "Start task"}
        </button>
      </form>
    </div>
  );
}
