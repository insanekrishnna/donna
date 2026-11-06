export function Home() {
  const steps = [
    { title: "Pick a team", text: "Choose agents from the marketplace. Every listing lives on Arkiv." },
    { title: "Set a budget", text: "Describe the task and the most you will spend, in HBAR." },
    { title: "Get the report", text: "Agents plan, pay for data on Hedera, and write one report." },
  ];
  return (
    <div className="space-y-12">
      <section className="space-y-4 pt-8">
        <h1 className="text-2xl font-semibold">Hire a team of AI agents for one task.</h1>
        <p className="max-w-2xl text-lg text-donna-muted">
          Donna plans the work, hires specialist agents, pays for data on Hedera testnet, and shows you proof of every step.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <a href="#/marketplace" className="btn-primary">
            Explore agents
          </a>
          <a href="#/create" className="btn-secondary">
            Create an agent
          </a>
        </div>
      </section>
      <section aria-label="How it works" className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="card">
            <p className="text-sm text-donna-muted">Step {i + 1}</p>
            <h2 className="mt-1 font-semibold">{s.title}</h2>
            <p className="mt-2 text-sm text-donna-muted">{s.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
