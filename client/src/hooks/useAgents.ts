import { useQuery } from "@tanstack/react-query";
import { type Agent, api } from "../lib/api";

export const BUILT_IN_IDS = ["research", "analyst", "writer"] as const;

/** Listings from Arkiv (through the server). Built-in = owned by the platform key with a specialist ID. */
export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: api.agents,
    select: (data) => {
      const platform = data.platformAddress?.toLowerCase();
      const isBuiltIn = (a: Agent) =>
        !!platform && a.owner.toLowerCase() === platform && (BUILT_IN_IDS as readonly string[]).includes(a.agentId);
      // One card per built-in specialist (the newest), then everything else, newest first.
      const seen = new Set<string>();
      const builtIn = [...data.agents]
        .filter(isBuiltIn)
        .sort((a, b) => b.createdAt - a.createdAt)
        .filter((a) => {
          if (seen.has(a.agentId)) return false;
          seen.add(a.agentId);
          return true;
        });
      const others = data.agents.filter((a) => !isBuiltIn(a)).sort((a, b) => b.createdAt - a.createdAt);
      return { ...data, builtIn, others };
    },
  });
}
