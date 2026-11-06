import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** An agent selected for the next task. Kept in localStorage so a reload keeps the team. */
export interface TeamMember {
  agentId: "research" | "analyst" | "writer";
  name: string;
  priceHbar: string;
  entityKey: string;
}

interface TeamState {
  team: TeamMember[];
  has: (agentId: string) => boolean;
  add: (m: TeamMember) => void;
  remove: (agentId: string) => void;
  clear: () => void;
}

const TeamContext = createContext<TeamState | null>(null);
const KEY = "donna.team";

function load(): TeamMember[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw)
      ? (raw as TeamMember[]).filter((m) => ["research", "analyst", "writer"].includes(m?.agentId))
      : [];
  } catch {
    return [];
  }
}

export function TeamProvider({ children }: { children: ReactNode }) {
  const [team, setTeam] = useState<TeamMember[]>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(team));
    } catch {
      // Storage unavailable: the team is just not remembered across reloads.
    }
  }, [team]);
  const has = useCallback((id: string) => team.some((m) => m.agentId === id), [team]);
  const value = useMemo<TeamState>(
    () => ({
      team,
      has,
      add: (m) => setTeam((t) => (t.some((x) => x.agentId === m.agentId) ? t : [...t, m])),
      remove: (id) => setTeam((t) => t.filter((m) => m.agentId !== id)),
      clear: () => setTeam([]),
    }),
    [team, has],
  );
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeam(): TeamState {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam must be used inside TeamProvider");
  return ctx;
}
