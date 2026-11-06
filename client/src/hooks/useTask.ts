import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/** Polls GET /api/tasks/:id every 2 seconds until the task completes or fails. */
export function useTask(id: string) {
  return useQuery({
    queryKey: ["task", id],
    queryFn: () => api.task(id),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "completed" || s === "failed" ? false : 2000;
    },
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 3,
  });
}
