import { useMemo, useState } from "react";
import { AgentCard } from "../components/AgentCard";
import { TeamTray } from "../components/TeamTray";
import { EmptyState, ErrorBanner, PageTitle, Spinner } from "../components/ui";
import { useAgents } from "../hooks/useAgents";
import { CATEGORIES } from "../lib/agentForm";
import type { Agent } from "../lib/api";

export function Marketplace() {
  const agents = useAgents();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");

  const match = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (a: Agent) =>
      (category === "all" || a.category === category) &&
      (!q || [a.name, a.description, ...a.skills].some((t) => t.toLowerCase().includes(q)));
  }, [search, category]);

  return (
    <>
      <PageTitle title="Marketplace" subtitle="Agents listed on Arkiv. Add Donna's built-in agents to your team, then start a task." />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex-1">
          <span className="sr-only">Search agents</span>
          <input className="input" type="search" placeholder="Search by name, skill or description" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          {[{ value: "all", label: "All" }, ...CATEGORIES].map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={category === c.value}
              onClick={() => setCategory(c.value)}
              className={`rounded-full border px-3 py-1 text-sm ${category === c.value ? "border-donna-accent bg-donna-accent-soft text-donna-accent" : "border-donna-line bg-donna-surface text-donna-muted"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {agents.isPending && <Spinner text="Reading agent listings from Arkiv..." />}
      {agents.isError && <ErrorBanner message={agents.error.message} onRetry={() => void agents.refetch()} />}
      {agents.isSuccess && (
        <div className="space-y-10">
          <section aria-labelledby="built-in">
            <h2 id="built-in" className="mb-4 text-lg font-semibold">Built-in agents</h2>
            {agents.data.builtIn.filter(match).length === 0 ? (
              <EmptyState text="No built-in agents match your search." />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {agents.data.builtIn.filter(match).map((a) => (
                  <AgentCard key={a.entityKey} agent={a} builtIn />
                ))}
              </div>
            )}
          </section>
          <section aria-labelledby="community">
            <h2 id="community" className="mb-4 text-lg font-semibold">Published by people</h2>
            {agents.data.others.filter(match).length === 0 ? (
              <EmptyState text="No published agents match yet." action={{ label: "Create an agent", href: "#/create" }} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {agents.data.others.filter(match).map((a) => (
                  <AgentCard key={a.entityKey} agent={a} builtIn={false} />
                ))}
              </div>
            )}
          </section>
          {(agents.data.skippedCount > 0 || agents.data.truncated) && (
            <p className="text-xs text-donna-muted">
              {agents.data.skippedCount > 0 && `${agents.data.skippedCount} invalid listing(s) on Arkiv were skipped. `}
              {agents.data.truncated && "There are more listings than one page shows."}
            </p>
          )}
        </div>
      )}
      <TeamTray />
    </>
  );
}
