import { useEffect, useState } from "react";

/**
 * Tiny hash router: #/marketplace, #/tasks/<id>. Hash URLs need no server rewrites on static hosting.
 */
export type Route =
  | { page: "home" }
  | { page: "marketplace" }
  | { page: "create" }
  | { page: "new-task" }
  | { page: "task"; id: string }
  | { page: "payments" }
  | { page: "not-found" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  if (path === "/") return { page: "home" };
  if (path === "/marketplace") return { page: "marketplace" };
  if (path === "/create") return { page: "create" };
  if (path === "/tasks/new") return { page: "new-task" };
  if (path === "/payments") return { page: "payments" };
  const task = /^\/tasks\/([0-9a-f-]{36})$/i.exec(path);
  if (task?.[1]) return { page: "task", id: task[1] };
  return { page: "not-found" };
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
