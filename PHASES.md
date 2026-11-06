# PHASES.md: Donna build plan

Build in order. Do not start a phase until the previous phase's test passes and is committed.

Build order is BACKEND FIRST. Phases B0 to B6 are backend only and are tested with curl, scripts, or the Node test runner. The frontend (B7) starts only after B1 to B6 pass.

Time estimates assume one developer with Claude Code. Adjust once you know your real timeline. The first thing to check is the official submission deadline in your ETHGlobal Hacker Dashboard.

| Phase | Name | Target time |
|---|---|---|
| B0 | Setup finish: docs rename, .gitignore, first commit | 20 min |
| B1 | Backend foundation | 45 min |
| B2 | Arkiv backend | 75 min |
| B3 | 0G backend | 45 min |
| B4 | Hedera x402 backend | 90 min |
| B5 | Coordinator backend | 90 min |
| B6 | Backend hardening | 45 min |
| B7 | Frontend | 180 min |
| B8 | Deployment and submission package | 105 min |

## Rules for every backend phase (B1 to B6)
- Test with curl, scripts, or the Node test runner. Paste the real output, real entity keys, real 0G request IDs, real Hedera transaction IDs and HashScan links.
- Never fake or mock a partner response. If a partner call fails, show the real error.
- Commit after each passing phase with the commit message given in that phase.
- Stop after each phase and wait for approval.
- Keep the in-memory store behind an interface. Do not add a database.

---

## Phase B0: Setup finish

**Goal:** Docs are consistent, Git is ready, and the first commit is pushed.

**Tasks**
1. Rename the product to "Donna" across all five docs: entity types `donna-agent`, `donna-task`, `donna-assignment`; Tailwind tokens `donna-*`; wordmark "donna".
2. Apply the approved Step 2 doc fixes to ARCHITECTURE.md and .env.example.
3. Narrow `.gitignore` secret patterns (no broad `*seed*` or `*secret*`), so the seed script stays tracked.
4. Confirm `.env` is ignored by Git.
5. Collect credentials (kept outside the repo). B3 and B4 credentials are requested before those phases start.

**Done when**
- `git status` does not show `.env`.
- `git check-ignore` confirms `.env` is ignored and `server/scripts/seed.ts` is not.
- Committed and pushed as `chore: setup and docs`.

**Do not:** start writing app code.

---

## Phase B1: Backend foundation

**Goal:** The server runs with validated config, a health check, a central error handler, and the store interface.

**Tasks**
1. Create `server/` with Express, TypeScript, Zod, dotenv, cors. Add `tsx` dev script and a `typecheck` script.
2. `server/src/config.ts`: load env with dotenv, validate every variable with Zod at startup, and exit with a clear message naming each missing or invalid variable (never print values).
3. Implement `GET /api/health` returning `{"status":"ok"}`.
4. Central error handler returning `{ "error": "message", "code": "SNAKE_CASE" }`. Unknown routes return 404 in the same shape. No stack traces in responses.
5. CORS for CLIENT_ORIGIN only.
6. `server/src/store/`: a `Store` interface (ExecutionRecord, PaymentReceipt, BudgetLedger) and `memoryStore.ts` implementing it.
7. Add root README stub. The `client/` folder may stay empty.

**Test**
- `curl http://localhost:4000/api/health` returns `{"status":"ok"}`.
- Remove one required env variable: the server refuses to start and names the variable.
- `curl` an unknown route: 404 in the error shape.
- Node test runner: memory store unit tests pass.
- `npm run typecheck` passes.

**Done when:** tests pass, committed as `feat: backend foundation`.

---

## Phase B2: Arkiv backend

**Goal:** Real agent listings are written to Arkiv and read back through the API.

**Tasks**
1. Install `@arkiv-network/sdk` and `viem`. Read the installed type definitions before coding.
2. `server/src/schemas/`: Arkiv schemas (`donna-agent`, `donna-task`, `donna-assignment`) and the Zod listing schema, in a module the client can reuse later.
3. `server/src/integrations/arkiv.ts`:
   - `createAgentListing(input)`: writes a `donna-agent` entity with an expiration (server key; used by the seed script).
   - `listAgents()`: queries all `donna-agent` entities, validates each with Zod, skips invalid ones.
   - `getAgent(entityKey)`: reads one entity.
   - `createTaskRecord`, `updateTaskStatus`, `createAssignmentRecord`: server-key writes for later phases.
4. `server/scripts/arkiv-smoke.ts`: writes one sample listing and reads it back.
5. `server/scripts/seed.ts`: seeds the three specialist listings (Research, Data Analyst, Report Writer), the official platform-owned listings. Idempotent: skips agents that already exist for the server owner.
6. `GET /api/agents`, `POST /api/agents/prepare` (validates and normalizes listing input, returns the values the wallet will write), `POST /api/agents/verify` (reads the entity by key and confirms the owner matches the given address).

**Test**
- Smoke script prints a real entity key and transaction hash, and the read-back matches. Keep the output.
- Seed script runs; `curl /api/agents` returns the three specialists with owner address and entity key.
- `curl /api/agents/prepare` with an invalid body (empty name, 9 skills) returns 400 with clear messages.
- `curl /api/agents/verify` with the smoke entity key and its real owner returns verified; with a different address returns not verified.

**Done when:** tests pass, committed as `feat: arkiv listings`.

**Do not:** store prompts or secrets in a listing.

---

## Phase B3: 0G backend

**Goal:** A real AI response from 0G, with a real request ID, is produced by a specialist agent.

**Before starting:** list the exact credentials needed and wait until they are provided.

**Tasks**
1. Install the `openai` SDK. Create `server/src/integrations/og.ts` using OG_BASE_URL and OG_API_KEY.
2. Call the models list endpoint once and confirm OG_MODEL is valid.
3. Implement `runSpecialist(agentId, instruction, context)` in `server/src/agents/`:
   - `research.ts`, `analyst.ts`, `writer.ts` each hold their own system instructions and output format.
4. Return `{ success, agentId, result, requestId }`. Capture requestId from the real response.
5. Add timeout and one retry.
6. Add `POST /api/dev/infer` (dev only, disabled in production).

**Test**
- Call the dev endpoint with "Research the Indian EV market in two paragraphs."
- You receive text and a request ID.
- Check the request ID in the 0G dashboard if available.
- Remove the API key temporarily: the API returns a clear error, not a fake answer.

**Done when:** tests pass, committed as `feat: 0g inference`.

---

## Phase B4: Hedera x402 backend

**Goal:** One agent automatically pays for a service and receives data. A real Hedera transaction ID is produced.

**Before starting:** list the exact credentials needed and wait until they are provided.

**Tasks**
1. Install the official x402 packages exactly as listed in ARCHITECTURE.md.
2. Merchant side: `GET /api/services/market-snapshot` protected by x402 middleware. Returns a small JSON dataset (a static, clearly labeled snapshot for the MVP; state this in README).
3. Buyer side in `server/src/integrations/hedera.ts`: calls the merchant URL, handles 402, signs the payment with the agent's testnet key, retries.
4. Extract the settlement transaction ID and build the HashScan link for testnet.
5. Enforce MAX_PAYMENT_PER_CALL before signing.
6. Store the receipt in the store; `GET /api/payments` returns all receipts.

**Test (run in order)**
1. Plain GET to the merchant endpoint returns HTTP 402 and payment requirements.
2. Buyer script pays and receives HTTP 200 with the data.
3. The response includes a Hedera transaction ID.
4. Open the HashScan link: the transaction shows on testnet.
5. Set MAX_PAYMENT_PER_CALL lower than the price: the buyer refuses and does not sign.

**Done when:** all five tests pass, committed as `feat: hedera x402`.

**Do not:** fake a settlement, paste a transaction ID manually, or skip the 402 step.

---

## Phase B5: Coordinator backend

**Goal:** Given a task and a budget, the Coordinator plans, discovers agents, pays, collects results, and produces one report.

**Tasks**
1. `server/src/schemas/plan.ts`: the Zod plan schema from ARCHITECTURE.md.
2. `server/src/agents/coordinator.ts`:
   1. Create a `donna-task` record in Arkiv (status planning).
   2. Ask 0G for a plan JSON. Validate with Zod. Retry once on failure.
   3. Check every agentId exists in the Arkiv registry.
   4. Check the estimated cost against the budget cap (BudgetLedger).
   5. For the paid step, call the Hedera buyer flow.
   6. Run specialists in dependency order through 0G. Use the paid market snapshot as context for the analyst.
   7. Writer combines results into a final Markdown report.
   8. Write `donna-assignment` records to Arkiv.
   9. Update task status to completed or failed.
3. `POST /api/tasks` and `GET /api/tasks/:id` (status, steps, receipts, outputs; this is the polling endpoint).
4. Keep execution records with real request IDs and receipts.
5. SSE `GET /api/tasks/:id/stream` is optional and deferred.

**Test**
- `POST /api/tasks`: "Compare three AI coding tools on pricing and features." Budget 0.20. Poll until done.
- The task completes with a final report.
- Plan, payment, and 0G request IDs, and Arkiv task and assignment keys, are all real and listed.
- Budget 0.01: the Coordinator stops before paying and explains why.
- Node test runner: a corrupted plan (only the model output is replaced, in a unit test) is rejected by Zod and the task fails cleanly.

**Done when:** all tests pass, committed as `feat: coordinator`.

---

## Phase B6: Backend hardening

**Goal:** The API fails gracefully and cannot overspend.

**Tasks**
1. Input length limits on every route.
2. Per-IP rate limit on `/api/tasks`.
3. Unit test that the budget ledger blocks overspending.
4. `/api/dev/infer` disabled in production mode.
5. Scan the repo and Git history for leaked secrets.

**Test**
- Unit test: budget ledger refuses a payment that exceeds the cap.
- Oversized input returns 400; rapid `/api/tasks` calls return 429.
- With NODE_ENV=production, `/api/dev/infer` returns 404.
- `git log -p | grep -i private` shows no real keys.

**Done when:** tests pass, committed as `fix: backend hardening`.

---

## Phase B7: Frontend

**Goal:** The whole user journey works in the browser from a fresh session. Built only after B1 to B6 pass.

**Tasks**
1. `client/` with Vite, React, TypeScript, Tailwind with the `donna` palette from design.md. AppShell, Home, footer showing "Connected" from `/api/health`.
2. Wagmi and Viem with the Arkiv testnet. WalletButton with shortened address and network name.
3. Marketplace: AgentCards from `/api/agents`, search, category chips, Add to team / Remove from team, TeamTray with total cost.
4. Create Agent wizard, one question per step: name, description, category, skills (max 6), price per task, review. The connected wallet signs the Arkiv write; then `POST /api/agents/verify`; Publish confirmation shows creator address and entity key.
5. New Task: TaskComposer with budget input and selected team preview.
6. Task Run: ProgressTimeline, live messages (polling), ProofBadges as they become real.
7. Result: rendered Markdown report, agents used, receipts, total spent, "Run again".
8. Payments: table of receipts.
9. Loading, empty, error, wallet disconnected, and wrong network states everywhere. ErrorBanners with plain-language messages.

**Test: the full demo path, from a fresh browser profile**
1. Connect wallet.
2. Publish a new agent; the entity key appears on the confirmation screen.
3. Reload the marketplace: the new agent is listed with your address as creator.
4. Try an invalid form (empty name, 9 skills): the form blocks submission with clear messages.
5. Select Research Agent, Data Analyst, and Report Writer.
6. Enter: "Research five AI coding competitors and compare their pricing."
7. Watch the timeline complete.
8. Confirm 0G request IDs, Hedera HashScan link, and Arkiv entity keys are all shown and real.
9. Each error state shows a readable message; loading states work on a slow network.

**Done when:** the full path completes without errors, committed as `feat: frontend end to end`.

**Do not:** ask for or display a private key, ever.

---

## Phase B8: Deployment and submission package

**Goal:** Public URLs work, and everything judges and sponsors ask for is in the repo and the dashboard.

**Tasks: deployment**
1. Deploy the backend to Render with all server env variables set in the dashboard.
2. Deploy the frontend to Vercel with VITE_API_URL pointing to the Render URL.
3. Set CLIENT_ORIGIN on the backend to the Vercel URL.
4. Test the complete demo path on the public URL from a fresh browser.

**Test: deployment**
- Public frontend loads.
- Public marketplace shows Arkiv listings.
- Public task run produces a real result with real IDs.
- Committed as `chore: deploy`. Save the URLs in the README.

**Tasks: submission**
1. Write `README.md`:
   - Problem statement and solution.
   - Architecture diagram (reuse ARCHITECTURE.md section 1).
   - How agents, payments, and listings work.
   - Installation and env setup (from .env.example).
   - Real example: one 0G request ID, one Hedera transaction ID with HashScan link, one Arkiv entity key and creator address.
   - One reproducible Arkiv query judges can run.
   - Known limitations (be honest: specialists are configs on a shared 0G service; market snapshot is static for MVP).
   - How AI tools were used, including Claude Code.
2. Write the five Arkiv docs in `arkiv/`: `schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`.
3. Add LICENSE (MIT) and `.env.example` without real values.
4. Record a demo video under three minutes. Show the actual product, the 402 response, and the paid retry.
5. Check the Hacker Dashboard for every required field and submit each partner track.

**Done when:** every item is ticked, the submission is saved, committed as `docs: submission package`.

---

## Master tracker

- [ ] B0: Setup finish (docs rename, .gitignore, first commit)
- [ ] B1: Backend foundation
- [ ] B2: Arkiv backend
- [ ] B3: 0G backend with real request ID
- [ ] B4: Hedera x402 paid call with real transaction
- [ ] B5: Coordinator backend end to end
- [ ] B6: Backend hardening
- [ ] B7: Frontend end to end
- [ ] B8: Public deployment and submission package

## Cut list (if time runs short, cut in this order)
1. Payments history page (keep receipts inside the Result screen).
2. Animations and polish beyond design.md basics.
3. Second and third specialist agents (keep Research plus Writer if needed, and say so honestly).
4. Rate limiting.
5. SSE live stream (already deferred; polling `GET /api/tasks/:id` is the default).

Never cut: real 0G inference, a real Hedera payment, real Arkiv write and read.
