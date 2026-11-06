import { X } from "lucide-react";
import { sumHbar } from "../lib/format";
import { useTeam } from "../hooks/useTeam";

export function TeamTray() {
  const { team, remove } = useTeam();
  if (team.length === 0) return null;
  const total = sumHbar(team.map((m) => m.priceHbar));
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-donna-line bg-donna-surface">
      <div className="mx-auto flex max-w-content flex-wrap items-center gap-3 px-4 py-3">
        <span className="text-sm font-medium">Your team</span>
        <ul className="flex flex-1 flex-wrap gap-2">
          {team.map((m) => (
            <li key={m.agentId} className="chip gap-1">
              {m.name}
              <button type="button" aria-label={`Remove ${m.name}`} onClick={() => remove(m.agentId)}>
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <span className="text-sm text-donna-muted">
          Agents: <span className="font-medium text-donna-ink">{total} HBAR</span>
        </span>
        <a href="#/tasks/new" className="btn-primary">
          Start task
        </a>
      </div>
    </div>
  );
}
