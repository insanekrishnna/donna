import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/ui";
import { CreateAgent } from "./pages/CreateAgent";
import { Home } from "./pages/Home";
import { Marketplace } from "./pages/Marketplace";
import { NewTask } from "./pages/NewTask";
import { Payments } from "./pages/Payments";
import { TaskRun } from "./pages/TaskRun";
import { useRoute } from "./lib/router";

export function App() {
  const route = useRoute();
  return (
    <AppShell route={route}>
      {route.page === "home" && <Home />}
      {route.page === "marketplace" && <Marketplace />}
      {route.page === "create" && <CreateAgent />}
      {route.page === "new-task" && <NewTask />}
      {route.page === "task" && <TaskRun key={route.id} id={route.id} />}
      {route.page === "payments" && <Payments />}
      {route.page === "not-found" && <EmptyState text="This page does not exist." action={{ label: "Go home", href: "#/" }} />}
    </AppShell>
  );
}
