# ARCHITECTURE.md: Donna

This is the technical blueprint. Keep it updated when the design changes. Where an SDK detail is marked VERIFY, check the official docs before coding it.

## 1. System overview

```
                   ┌──────────────────────────┐
                   │   Browser (React app)    │
                   │  Wallet · Market · Task  │
                   └──────┬───────────┬───────┘
          HTTPS JSON      │           │ Wallet signs
          (no secrets)    │           │ Arkiv writes
                   ┌──────▼───────┐   │
                   │ Express API  │   │
                   │ + Coordinator│   │
                   └┬─────┬──────┬┘   │
          AI calls  │     │      │    │ user-signed tx
                   ┌▼──┐ ┌▼────┐ ┌▼────▼───────────┐
                   │0G │ │Hedera│ │  Arkiv testnet  │
                   │AI │ │x402  │ │ listings, tasks,│
                   └───┘ └──────┘ │ bids, receipts  │
                                  └─────────────────┘
```

## 2. Components and responsibilities

| Component | Location | Responsibility |
|---|---|---|
| React client | client/ | UI, wallet connection, marketplace, task view, signing Arkiv writes |
| Express API | server/src/index.ts | HTTP routes, input validation, calls integrations |
| Coordinator | server/src/agents/coordinator.ts | Builds the plan, selects agents, enforces budget, runs steps, combines output |
| Specialist agents | server/src/agents/*.ts | Each is a config: name, instructions, skills, price, output schema |
| 0G integration | server/src/integrations/og.ts | Calls 0G Compute Router, returns text plus real request ID |
| Hedera integration | server/src/integrations/hedera.ts | x402 merchant middleware and buyer client |
| Arkiv integration | server/src/integrations/arkiv.ts | Reads and writes entities |
| Schemas | server/src/schemas/ | Zod schemas for agents, tasks, plans, receipts |

Important: specialist agents are configurations running on a shared 0G execution service. We say this honestly in the README. Multi-agent delegation is real: the Coordinator makes separate calls, each with its own instructions, and each paid service call produces a real payment.

## 3. Specialist agents (MVP)

| ID | Name | Job | Price per task (testnet) |
|---|---|---|---|
| research | Research Agent | Finds and summarizes information on a topic | 0.05 HBAR (5,000,000 tinybars) |
| analyst | Data Analyst Agent | Compares items and produces structured findings | 0.03 HBAR (3,000,000 tinybars) |
| writer | Report Writer Agent | Combines findings into one readable report | 0.02 HBAR (2,000,000 tinybars) |

The paid service for the demo: the Research Agent buys a market snapshot from the Donna merchant endpoint (`GET /api/services/market-snapshot`) via Hedera x402, and then the Analyst uses that data. The payment is the real agent-to-agent transaction. The snapshot price is 0.01 HBAR (1,000,000 tinybars): a testnet placeholder, set in config. It is a sensible default, not a sourced figure.

Prices are testnet placeholders. They live in config, stored as integer tinybar strings (1 HBAR = 100,000,000 tinybars), not in code. The UI shows them as decimal HBAR.

## 4. Data models

### 4.1 Arkiv entities (public)

Verified against `@arkiv-network/sdk` 1.0.1. The SDK uses named schemas of typed columns:
- Each entity type is declared once with `defineSchema(name, columns)` from `@arkiv-network/sdk/schema`. The schema module lives in `server/src/schemas/` and is reused by the client.
- The SDK tags every entity with an indexed `arkiv.schema` attribute holding the schema name, and `select().from(Schema)` filters on it. We do not store our own "type" field.
- Columns we filter on are indexed `str` or `addr` columns. Everything else goes in one `data` column of type `bytes`, holding UTF-8 JSON that is validated with Zod on write and on read.
- A `str` value is at most 128 UTF-8 bytes. Long text, such as `description`, goes in the `data` JSON.
- Owner, creator and expiry come from SDK system fields: `$owner`, `$creator`, `$expiresAt`, `$createdAt`. We never store an owner address or an expiry in our own data.
- Expiration is set on every create with `{ expiration: ExpirationTime.fromDays(n) }`. `$expiresAt` is a block number (2-second blocks). The maximum lifetime is about 182 days.
- Anyone can write an entity tagged with our schema name. Reads validate every entity with Zod and skip invalid ones.

**Agent listing** (schema: `donna-agent`, owner: the creator's wallet, expiration: 30 days)
```
columns:
  agentId:   str, indexed   // slug, 3-40 chars, unique per owner
  category:  str, indexed   // research | analysis | writing | other
  data:      bytes          // JSON below
data JSON:
  name:          string   // 3-40 chars
  description:   string   // max 280 chars
  skills:        string[] // max 6 items, each max 24 chars
  priceTinybars: string   // integer string
  currency:      "HBAR"
  serviceUrl:    string   // optional, for x402 endpoints
  createdAt:     number   // unix seconds, informational
system fields used: $key (entity key), $owner and $creator (creator address), $expiresAt
```

**Task** (schema: `donna-task`, owner: the server key, expiration: 7 days)
```
columns:
  taskId:           str, indexed
  status:           str, indexed   // open | planning | running | completed | failed
  requesterAddress: addr, indexed, optional   // the connected wallet, when there is one
  data:             bytes          // JSON below
data JSON:
  category:           string
  budgetCapTinybars:  string   // integer string
  createdAt:          number   // unix seconds
```
Status changes use `patchEntity`.

**Assignment record** (schema: `donna-assignment`, owner: the server key, expiration: 7 days)
```
columns:
  taskId:   str, indexed
  agentId:  str, indexed
  status:   str, indexed   // assigned | done | failed
  data:     bytes          // JSON below
data JSON:
  agentEntityKey:  string   // $key of the agent listing
  creatorAddress:  string   // $owner of that listing, copied for display
  amountTinybars:  string   // integer string
```

Never store the task's private text, specialist outputs, the final report, or an agent's system prompt in Arkiv. Store a short public title only if the user chooses to make the task public.

### 4.2 Server-side records (in memory for MVP)

Keep these in a simple in-memory store with a clear interface, so a database can replace it later.

- **ExecutionRecord**: taskId, step, agentId, og requestId, status, timestamps.
- **PaymentReceipt**: taskId, payer agent, payee agent, amount, hederaTxId, hashScanUrl, status, timestamp.
- **BudgetLedger**: taskId, budgetCap, spent, remaining.

### 4.3 Coordinator plan (AI output, validated by Zod)

```
{
  "task": "string",
  "subtasks": [
    { "id": "s1", "agentId": "research", "instruction": "string", "needsPaidData": true },
    { "id": "s2", "agentId": "analyst",  "instruction": "string", "dependsOn": ["s1"] },
    { "id": "s3", "agentId": "writer",   "instruction": "string", "dependsOn": ["s1","s2"] }
  ],
  "estimatedCost": "string"
}
```

Rules after validation:
- Max 4 subtasks.
- Only agentIds that exist in the registry are allowed.
- Sum of estimated costs must be below the user's budget cap, otherwise stop and ask the user. The server computes the cost from config prices in tinybars. The model's `estimatedCost` is informational only and never used for budget checks or payments.
- If Zod validation fails, retry the planning call once, then fail the task with a clear message.

## 5. API routes (Express)

| Method | Route | Purpose |
|---|---|---|
| GET | /api/health | Health check |
| GET | /api/agents | Read agent listings from Arkiv (server-side read) |
| POST | /api/agents/prepare | Validate and normalize listing input with Zod, return the column values and data JSON the browser wallet will write. No transaction is built on the server. |
| POST | /api/agents/verify | Body `{ entityKey, address }`. Read the entity from Arkiv and confirm `$owner` equals the connected address (case-insensitive) and the listing passes Zod |
| POST | /api/tasks | Create a task: validates input, budget, and selected agents |
| GET | /api/tasks/:id | Task status, steps, receipts, outputs. This is the polling endpoint. |
| GET | /api/tasks/:id/stream | Server-sent events for live progress (optional, deferred; polling is the default) |
| GET | /api/services/market-snapshot | x402-protected merchant endpoint (returns 402 without payment) |
| GET | /api/payments | All receipts (MVP: in-memory) |
| POST | /api/dev/infer | Dev only: one specialist call through 0G. Returns 404 when NODE_ENV=production |

Route bodies are validated with Zod. Errors return `{ "error": "message", "code": "SNAKE_CASE" }`.

## 6. Core flows

### 6.1 Publish an agent
1. Creator connects wallet in the browser.
2. Wizard collects listing fields. Client validates with the same Zod schema shared from server/src/schemas (copy the file or use a shared package).
3. Client calls POST /api/agents/prepare. Server validates and returns the normalized fields.
4. The browser builds an Arkiv wallet client from the connected Wagmi wallet (`createWalletClient({ chain, transport: custom(walletClient.transport), account })`, per the official React guide) and calls `createEntity(AgentListing, values, { expiration: ExpirationTime.fromDays(30) })`. The wallet signs and sends the transaction, so the creator's address is the owner. `createEntity` has no owner parameter: the sender is the owner.
5. Client receives `{ entityKey, txHash, expiresAt }`.
6. Client calls POST /api/agents/verify with the entity key and connected address. The server checks `$owner`, then the client shows the publish confirmation.
7. Marketplace reads from Arkiv and shows the new card.

### 6.2 Run a task
1. User selects agents and enters a task plus budget cap. Client calls POST /api/tasks.
2. Server writes a `donna-task` record to Arkiv (status: planning).
3. Coordinator calls 0G to produce the plan. Zod validates it.
4. Coordinator reads agent listings from Arkiv to confirm each selected agent exists and get its service details.
5. For the paid step, the Research Agent client calls GET /api/services/market-snapshot.
   - Server returns 402 with payment requirements.
   - The buyer checks the budget ledger and MAX_PAYMENT_PER_CALL, then creates and signs the x402 payment with the agent's testnet account, and retries.
   - Facilitator verifies and settles on Hedera testnet.
   - Server returns the data. The buyer reads the `PAYMENT-RESPONSE` header and stores a receipt with the Hedera transaction ID.
6. Coordinator sends each specialist's instruction to 0G. Each response includes its real request ID (`x_0g_trace.request_id`).
7. Writer agent combines results through 0G.
8. Server writes `donna-assignment` records to Arkiv and updates the task to completed.
9. Client polls `GET /api/tasks/:id` and shows progress, the result, receipts, and proof badges.

### 6.3 Budget control
- Budget cap is set by the user per task, entered as decimal HBAR and stored in the BudgetLedger as integer tinybars.
- Before each paid call: if spent + nextCost > budgetCap, stop and return a clear error.
- Also enforce a per-payment max: MAX_PAYMENT_PER_CALL in config (decimal HBAR, converted to tinybars). It is checked by our own code before signing and also passed to the x402 client's `spendControls`.
- Show remaining budget in the Task Run screen.

## 7. Partner integration details

Verified on 2026-11-06 against the official docs, the installed type definitions, and live endpoints.

### 0G Private Computer
- Docs: https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview
- Package: `openai` only (verified 7.53.0). Do not use `@0glabs/0g-serving-broker`, which is deprecated.
- Endpoint: OpenAI-compatible Compute Router. Testnet and mainnet are fully separate environments with their own keys and balances. We use testnet only.
  - Testnet base URL: `https://router-api-testnet.integratenetwork.work/v1`. Dashboard and API keys: https://pc.testnet.0g.ai
  - Mainnet (not used): `https://router-api.0g.ai/v1`, dashboard https://pc.0g.ai
  - Testnet chain: 0G Galileo, chain ID 16602, RPC https://evmrpc-testnet.0g.ai, faucet https://faucet.0g.ai. The Router balance is funded by depositing testnet 0G in the dashboard.
- Client: `new OpenAI({ baseURL: OG_BASE_URL, apiKey: OG_API_KEY })`. The key starts with `sk-`.
- Model from env (OG_MODEL). At startup, call `client.models.list()` and fail with a clear message if OG_MODEL is not listed. Prefer a model with `tee_attested: true`.
- Request ID: read `x_0g_trace.request_id` from the response body (with `x_0g_trace.provider`, the provider's on-chain address). Validate `x_0g_trace` with Zod. If it is missing, the call fails: we never fall back to another ID. Do not use the SDK's `_request_id` or `withResponse().request_id`; those come from the gateway's `x-request-id` header, which the Router sends twice and is not the 0G ID.
- Wrap calls with timeout and one retry.

### Hedera x402
- Docs: https://docs.hedera.com/solutions/ai/x402 and the official repo https://github.com/x402-foundation/x402 (Hedera end-to-end path: `e2e/clients/typescript/client.ts`, `e2e/servers/typescript/config.ts`, `e2e/config/mechanisms_hedera.json`).
- Packages (verified 2.30.0): `@x402/core`, `@x402/express`, `@x402/fetch`, `@x402/hedera`. Do not install `@hiero-ledger/sdk` directly: `@x402/hedera` pins it and re-exports `PrivateKey`, `AccountId` and `Client`, and a second copy breaks at runtime. Do not use `@hashgraph/sdk` or the v1 packages (`x402-express`, `x402-fetch`).
- Network: `hedera:testnet` (CAIP-2).
- Asset: HBAR. Prices are passed as `{ asset: "0.0.0", amount: "<tinybars>" }`. Never pass a money string such as `"$0.01"`: it converts to USDC by default, and HBAR cannot be used as the money-conversion asset.
- Merchant: `paymentMiddleware(routes, server)` from `@x402/express`, with `server = new x402ResourceServer(new HTTPFacilitatorClient({ url: HEDERA_FACILITATOR_URL })).register("hedera:testnet", new ExactHederaScheme())`. The route `accepts` is `{ scheme: "exact", network: "hedera:testnet", payTo: HEDERA_MERCHANT_ACCOUNT_ID, price: { asset: "0.0.0", amount } }`. The middleware reads the facilitator's fee payer from `/supported` at start.
- Facilitator: `https://x402.org/facilitator`. No API key. Hedera testnet confirmed live via `/supported`. The facilitator pays the network fee. Backup: Blocky402 testnet, `https://api.testnet.blocky402.com`.
- Buyer: `createClientHederaSigner(HEDERA_AGENT_ACCOUNT_ID, PrivateKey.fromStringECDSA(HEDERA_AGENT_PRIVATE_KEY))`, then `x402Client.fromConfig({ schemes: [{ network: "hedera:testnet", client: new ExactHederaScheme(signer) }], spendControls: { allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0", maxAmountPerPayment: <MAX_PAYMENT_PER_CALL in tinybars> }] } })`, wrapped with `wrapFetchWithPayment(fetch, client)`. Without the explicit `allowedAssets` entry, the default spend controls reject HBAR.
- Receipt: `decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE"))` gives `SettleResponse.transaction`, for example `0.0.9185802@1793986270.286756205`. `X-PAYMENT-RESPONSE` is the v1 header and only a fallback. HashScan link: `https://hashscan.io/testnet/transaction/<transaction>`.
- The account in the transaction ID is the facilitator's fee payer, not the agent's account. The UI labels it "Hedera tx", never "paid by agent account".
- Accounts: two ECDSA testnet accounts (agent buyer and merchant) from https://portal.hedera.com. The merchant needs only its account ID for HBAR. HBAR needs no token association.

### Arkiv
- Docs: https://docs.arkiv.network/ and https://github.com/Arkiv-Network/arkiv-sdk-js
- Package: `@arkiv-network/sdk` (verified 1.0.1) with `viem`. Requires Node 22.10 or newer.
- Chain: Arkiv testnet "Rabdi", chain ID 7794095 (confirmed live with `eth_chainId`). Built with `rabdi({ accessKey: ARKIV_ACCESS_KEY })` from `@arkiv-network/sdk/chains`, which gives the RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network/<accessKey>`. At startup the server checks that the chain ID equals ARKIV_CHAIN_ID.
- Access keys: free from https://hub.arkiv.network/access-keys. An empty key uses the heavily rate-limited public endpoint. We use two keys:
  - `VITE_ARKIV_ACCESS_KEY`, for the browser: restricted to our origins in the Hub (localhost:5173 now, the Vercel URL in B8).
  - `ARKIV_ACCESS_KEY`, for the server: no origin restriction, because server requests carry no `Origin` header. An origin-restricted key returns `403 ORIGIN_FORBIDDEN` from the server (seen on 2026-11-07). Because it is unrestricted, the server key is treated as a secret: never logged, and redacted from every Arkiv error message (the RPC URL contains it).
- Gas: tGLM from https://hub.arkiv.network/faucet. Explorer: https://rabdi.explorer.arkiv.network
- Clients: the wallet client (`createWalletClient`) only writes: `createEntity`, `patchEntity`, `extendEntity`, `deleteEntity`, `executeBatch`. The public client (`createPublicClient`) only reads: `getEntity`, `select`, `query`. We build both.
- Data model: `defineSchema` schemas as described in section 4.1.
- Writes: listings come from the user's wallet in the browser, so owner = creator. Task and assignment records are written by the server with ARKIV_SERVER_PRIVATE_KEY (`privateKeyToAccount`). Document both owners in arkiv/schema.md. The seed script writes the three platform-owned specialist listings with the server key.
- Reads:
  - `listAgents` filters on the schema tag directly (`eq(SCHEMA_ATTRIBUTE, AgentListing.tag)`, the same filter the SDK's `from()` uses) without reading through the schema. So the SDK skips nothing, and every page has a last `$key`.
  - It pages by key (`gt("$key", key(lastKey))` with `asc("$key")`) rather than by offset, because offsets shift when entities expire mid-scan. Pages hold 25 rows, and only `agentId`, `category` and `data` are selected by name, so oversized junk entities cannot push a page past the RPC response limit.
  - It stops only on an empty page, because a short page is not proof of the end. One scan reads at most 1,000 entities; reaching that limit sets `truncated`.
  - Every row is validated with Zod. Invalid ones are skipped and counted in `skippedCount`, and duplicates are dropped.
  - Single reads use `getEntity(key, AgentListing)`, which throws `NoEntityFoundError` when an entity is missing or expired.
  - The UI shows `$key` and `$owner` on each card.
- Expiration: set on every entity with `ExpirationTime`. Explain in arkiv/how-you-use-arkiv.md why expiration matters.

**Verified in B2** (`@arkiv-network/sdk` 1.0.1, `viem` 2.57.16, Rabdi testnet, 2026-11-07). Each item was a VERIFY note before B2:
| Item | Result | Proof |
|---|---|---|
| Chain ID and RPC | 7794095 via `rabdi({ accessKey })` | `test/live/arkiv.live.test.ts` "RPC reports the configured chain"; startup check in `src/index.ts` |
| Attribute and expiration API (4.1) | `defineSchema` columns plus `{ expiration: ExpirationTime.* }`; `str` capped at 128 bytes | `test/arkiv.test.ts` "Arkiv str columns are capped at 128 bytes"; every live write |
| Owner semantics (6.1) | `$owner` and `$creator` equal the address that sent the write | `test/live/arkiv.live.test.ts` "$owner equals the writing address on a real entity"; `npm run smoke:arkiv` |
| Invalid entities on read | tag-filtered query, paged by `$key`; every row is validated with Zod; invalid ones are counted in `skippedCount` | `test/live/arkiv.live.test.ts` "listAgents skips a real malformed entity" (also re-reads with 2 rows per page and gets the same result) |
| Owner check in verify | `$owner` compared case-insensitively; a different address returns 403 `OWNER_MISMATCH` | `test/live/arkiv.live.test.ts` "POST /api/agents/verify against the real entity" |
| Status updates | `patchEntity(TaskRecord, key, { set: { status } })` | `test/live/arkiv.live.test.ts` "writes a task record, updates its status" |

Browser-wallet signing (the wallet client from Wagmi) is tested in B7.

## 8. Security model
- Secrets: server env only. .env in .gitignore.
- Private keys: never sent to the client. Never logged.
- Input: all routes validate with Zod. Max lengths on all text fields.
- AI output: validated before any action. The AI cannot choose an arbitrary URL or amount. Only registry agents and configured services are allowed.
- Rate limiting: simple per-IP limit on /api/tasks (express-rate-limit, optional).
- CORS: only CLIENT_ORIGIN.
- Prompt injection: specialist outputs are treated as data, never as instructions for the Coordinator to obey blindly. The planner only sees the user task, agent registry, and budget.

## 9. Environment variables

```
# App
PORT=4000
CLIENT_ORIGIN=http://localhost:5173

# 0G (testnet)
OG_API_KEY=                     # sk-... from https://pc.testnet.0g.ai
OG_BASE_URL=https://router-api-testnet.integratenetwork.work/v1
OG_MODEL=

# Hedera testnet
HEDERA_NETWORK=hedera:testnet
HEDERA_FACILITATOR_URL=https://x402.org/facilitator
HEDERA_MERCHANT_ACCOUNT_ID=     # 0.0.x
HEDERA_MERCHANT_PRIVATE_KEY=    # optional: not needed for HBAR payments
HEDERA_AGENT_ACCOUNT_ID=        # 0.0.x
HEDERA_AGENT_PRIVATE_KEY=       # ECDSA, hex
MAX_PAYMENT_PER_CALL=0.10       # decimal HBAR, converted to tinybars in config

# Arkiv (Rabdi testnet)
ARKIV_ACCESS_KEY=               # server key, no origin restriction; treated as a secret
ARKIV_CHAIN_ID=7794095          # startup check against the chain
ARKIV_SERVER_PRIVATE_KEY=       # funded with tGLM

# Client (Vite, public values only)
VITE_API_URL=http://localhost:4000
VITE_ARKIV_ACCESS_KEY=          # browser key, a different key restricted to our origins in the Hub
VITE_ARKIV_CHAIN_ID=7794095
```

Client variables prefixed VITE_ are public and end up in the browser. Never put a secret there.

At startup, `server/src/config.ts` validates every server variable with Zod and exits with a message naming each missing or invalid variable, without printing values. HEDERA_MERCHANT_PRIVATE_KEY is the only optional one.

## 10. Risks and fallbacks

| Risk | Impact | Fallback |
|---|---|---|
| Hedera x402 buyer flow is hard to get working | Breaks a required prize item | Test it alone in Phase B4 first. If blocked after a fixed time box, ask a mentor or use the official e2e example as-is before modifying. |
| 0G request ID not exposed | Breaks 0G requirement | The docs say every Router response carries `x_0g_trace.request_id`. If it is missing, the call fails and we report it; we never substitute another ID. |
| 0G testnet router unreachable | Blocks Phase B3 | Seen on 2026-11-06: the TLS connection to the testnet router was reset from the dev machine while pc.testnet.0g.ai loaded. Check from another network, the 0G status page and Discord. Mainnet is not allowed without a CLAUDE.md rule change. |
| Arkiv write from wallet is slow or unclear | Delays publishing | Use a server key for writes in the first version, keep wallet connection for ownership display. Document it. |
| Time runs out | Incomplete demo | Cut optional features first. Keep one complete paid run. |
| Model returns invalid JSON | Coordinator fails | Zod validation plus one retry, then clear error. |

## 11. Deployment
- Frontend: Vercel, root directory client/.
- Backend: Render, root directory server/, start command from package.json.
- Set env variables in each host dashboard. Never commit them.
- CORS: CLIENT_ORIGIN set to the deployed frontend URL.
- Test the deployed link from a fresh browser before submitting.

## 12. Folder structure

```
donna/
├── client/
│   └── src/
│       ├── components/   AgentCard, TeamTray, TaskComposer, ProgressTimeline, ReceiptRow, ProofBadge, AppShell, WalletButton, ErrorBanner, EmptyState
│       ├── pages/        Home, Marketplace, CreateAgent, NewTask, TaskRun, Result, Payments
│       ├── hooks/        useWallet, useAgents, useTask
│       ├── lib/          api.ts, format.ts
│       └── App.tsx
├── server/
│   ├── src/
│   │   ├── agents/       coordinator.ts, research.ts, analyst.ts, writer.ts, registry.ts
│   │   ├── integrations/ og.ts, hedera.ts, arkiv.ts
│   │   ├── routes/       agents.ts, tasks.ts, payments.ts, services.ts, dev.ts, validate.ts (body validation helper)
│   │   ├── schemas/      agent.ts, task.ts, plan.ts, arkiv.ts (defineSchema definitions)
│   │   ├── store/        store.ts (interface), memoryStore.ts
│   │   ├── app.ts        builds the Express app without listening (used by tests)
│   │   ├── errors.ts     AppError, error shape, central error handler
│   │   ├── config.ts
│   │   └── index.ts
│   ├── scripts/          arkiv-smoke.ts, seed.ts, bootstrap.ts (shared script setup)
│   └── test/             unit tests (npm test); live/ holds live partner tests (npm run test:live)
├── arkiv/
│   ├── schema.md
│   ├── friction.md
│   ├── reach.md
│   ├── why-arkiv.md
│   └── how-you-use-arkiv.md
├── CLAUDE.md
├── MASTER_PROMPT.md
├── PHASES.md
├── ARCHITECTURE.md
├── design.md
├── README.md
├── LICENSE
├── .env.example
└── .gitignore
```
