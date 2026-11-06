# MASTER_PROMPT.md: Paste this into Claude Code

Copy everything inside the box below and paste it as your first message in Claude Code, from inside the `donna` folder.

---

```
We are building Donna for ETHGlobal Mumbai 2026. Donna is a marketplace where a user describes a complex task and a Coordinator hires specialist AI agents to complete it. Agents are listed on Arkiv, AI work runs on 0G Private Computer, and agent-to-agent payments use Hedera x402.

Before doing anything else:

1. Read these files completely, in this order:
   - CLAUDE.md (rules you must follow at all times)
   - ARCHITECTURE.md (system design, data models, flows, env variables)
   - design.md (visual system and UI copy rules)
   - PHASES.md (the build plan)

2. Confirm back to me, in short bullet points:
   - The three partner technologies and what each one does in Donna.
   - The three specialist agents in the MVP.
   - The rules in CLAUDE.md you consider most important.
   - Anything in ARCHITECTURE.md marked VERIFY that you will check first.

3. Do NOT write application code yet. Instead:
   - Check the official docs for 0G, Hedera x402, and Arkiv (links are in ARCHITECTURE.md and PHASES.md). Note the exact current package names, endpoints, and SDK usage. Do not guess.
   - Tell me any conflict or risk you find between the docs and our plan, and propose a fix.

4. After I approve your confirmation and findings, we will work through PHASES.md one phase at a time. For each phase:
   - Follow the Tasks list.
   - Run the Test list and show me the real output or IDs.
   - Commit with the commit message given in PHASES.md.
   - Stop and wait for my go-ahead before starting the next phase.

Hard rules, repeated for emphasis:
- Never fake a transaction, payment, AI response, request ID, or entity key.
- Never put private keys or API keys in client code, logs, or Git.
- If a partner integration fails, show me the real error and fix it. Do not replace it with dummy data.
- If you are unsure of an SDK method name, read the installed type definitions or the official docs. Do not invent names.
- Keep scope to the MVP in PHASES.md. Do not add optional features.

Start with step 1 now.
```

---

## How to use this with Claude Code

1. Create the folder and start Claude Code:

```bash
mkdir donna
cd donna
git init
claude
```

2. Copy `CLAUDE.md`, `MASTER_PROMPT.md`, `PHASES.md`, `ARCHITECTURE.md`, and `design.md` into the `donna` folder.

3. Paste the prompt above.

4. Work phase by phase. Do not let Claude Code build the whole product in one go. After each phase, check the test results yourself before saying "go ahead."

## Tips for working with Claude Code
- If it starts writing code before you approve the plan, stop it and say: "Go back to step 3 of the master prompt."
- If it invents a package or method, say: "Check the installed types or official docs first, and show me what you found."
- If it tries to use mock data for a partner, say: "No mocks for partner integrations. Show the real error."
- Keep your Hacker Dashboard deadline visible. Time is the real constraint.
