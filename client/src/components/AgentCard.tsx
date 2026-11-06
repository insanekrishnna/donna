import type { Agent } from "../lib/api";
import { hbar, shortAddress } from "../lib/format";
import { type TeamMember, useTeam } from "../hooks/useTeam";
import { CopyButton } from "./ui";

export function AgentCard({ agent, builtIn }: { agent: Agent; builtIn: boolean }) {
  const { has, add, remove } = useTeam();
  const selected = builtIn && has(agent.agentId);
  return (
    <article className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold">{agent.name}</h2>
        <span className="chip shrink-0">{agent.category}</span>
      </div>
      <p className="text-sm text-donna-muted">{agent.description}</p>
      {agent.skills.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Skills">
          {agent.skills.map((s) => (
            <li key={s} className="rounded-full border border-donna-line px-2 py-0.5 text-xs">
              {s}
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-auto grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-donna-muted">Price per task</dt>
        <dd className="text-right font-medium">{hbar(agent.priceHbar)}</dd>
        <dt className="text-donna-muted">Creator</dt>
        <dd className="flex items-center justify-end gap-1 font-mono text-xs">
          {shortAddress(agent.owner)}
          <CopyButton value={agent.owner} label="Copy creator address" />
        </dd>
        <dt className="text-donna-muted">Arkiv entity</dt>
        <dd className="flex items-center justify-end gap-1 font-mono text-xs">
          {shortAddress(agent.entityKey, 8, 6)}
          <CopyButton value={agent.entityKey} label="Copy entity key" />
        </dd>
      </dl>
      {builtIn ? (
        <button
          type="button"
          className={selected ? "btn-secondary" : "btn-primary"}
          aria-pressed={selected}
          onClick={() =>
            selected
              ? remove(agent.agentId)
              : add({
                  agentId: agent.agentId as TeamMember["agentId"],
                  name: agent.name,
                  priceHbar: agent.priceHbar,
                  entityKey: agent.entityKey,
                })
          }
        >
          {selected ? "Remove from team" : "Add to team"}
        </button>
      ) : (
        <p className="rounded-lg bg-donna-bg px-3 py-2 text-xs text-donna-muted">
          Listed on Arkiv. In this demo, tasks run on the three built-in agents.
        </p>
      )}
    </article>
  );
}
