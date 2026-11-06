# CLAUDE.md: Donna







Read this file completely before writing any code. These rules override your defaults.






## What we are building
Donna is a marketplace where a user describes a complex task, and a Coordinator hires a team of specialist AI agents to finish it. Agents are listed publicly, discovered through Arkiv, paid through Hedera x402, and run their AI work on 0G Private Computer.






Donna is inspired by HashMind's user journey (chat-based agent creation, marketplace cards, add agents to a chat). We do NOT copy HashMind's code, designs, copy, or assets. We build everything from scratch.

Hackathon: ETHGlobal Mumbai 2026. Track focus: 0G, Hedera, Arkiv.

## Non-negotiable rules
1. TypeScript everywhere. No plain .js in app code.
2. Never invent SDK methods, function names, or package names. Before using any SDK, read the installed package's type definitions (node_modules/.../*.d.ts) or the official docs. If unsure, say so and check.
3. Never mock a successful blockchain transaction, payment, or AI response. If a real integration fails, report the error and fix the integration. Never replace it with dummy data silently.
4. Never fake a 0G request ID, Hedera transaction ID, or Arkiv entity key. Every displayed ID must come from a real response.
5. Private keys, API keys, and facilitator credentials live only in server environment variables. Never in client code, never in logs, never in Git.
6. Never write private keys or seed phrases to the UI, Arkiv, or the README. Display only public addresses.
7. Do not store secret system prompts, API keys, private task inputs, or confidential reports in Arkiv. Arkiv holds public listings and task coordination metadata only.
8. Validate all external input and all AI output with Zod before using it. AI-generated plans must pass schema validation before any action runs.
9. Enforce budget limits on the server. The client display is not enough.
10. Do not add optional features (reviews, recurring tasks, ENS, bidding, tokens) until all three sponsor integrations work end to end.
11. Use testnet only: Hedera testnet, Arkiv testnet (Rabdi), 0G testnet (Galileo). Never mainnet, with or without real money.
12. Commit after each completed and tested phase. Use clear commit messages. Never commit .env.

## Working style
- Work one phase at a time, exactly as defined in PHASES.md. Do not jump ahead.
- After each phase, run the app, run the phase's test, and report the result with evidence (logs, IDs, screenshots, or a test output).
- If a requirement is ambiguous, pick the simplest option that satisfies PHASES.md and state the assumption in your reply.
- Keep components small and reusable. Prefer simple code over clever code.
- Do not refactor unrelated code while working on a phase.
- If you find a problem in ARCHITECTURE.md or design.md, propose the change and wait for approval before rewriting those files.

## Stack (do not change without approval)
- Frontend: React, Vite, TypeScript, Tailwind CSS, Wagmi, Viem, TanStack Query, lucide-react
- Backend: Node.js, Express, TypeScript, Zod, dotenv, cors
- AI: 0G Private Computer via its OpenAI-compatible endpoint, using the openai SDK
- Payments: Hedera x402 via @x402/core, @x402/express, @x402/fetch, @x402/hedera (the Hedera SDK comes re-exported from @x402/hedera; see ARCHITECTURE.md section 7)
- Marketplace data: @arkiv-network/sdk with Viem
- Runner: tsx for backend dev

## Folder layout
donna/
  client/   React app
  server/   Express API and agents
  arkiv/    the five required Arkiv documentation files
  docs/     copies of design and architecture notes if needed
  CLAUDE.md, MASTER_PROMPT.md, PHASES.md, ARCHITECTURE.md, design.md, README.md, LICENSE, .env.example, .gitignore

## Environment variables
Defined in .env.example. Never commit .env. Never print secret values in logs. Keep names exactly as listed in ARCHITECTURE.md.

## Definition of done for any feature
- It runs locally without errors.
- It works with real partner services, not stubs.
- Errors show a clear message to the user.
- The phase test in PHASES.md passes.
- Code is committed.

## Things Claude Code must NOT do
- Do not add a database unless PHASES.md asks for it.
- Do not add authentication beyond wallet connection.
- Do not add a token, DAO, or governance feature.
- Do not generate more than three specialist agents in the MVP.
- Do not write marketing copy that claims features that do not work.
