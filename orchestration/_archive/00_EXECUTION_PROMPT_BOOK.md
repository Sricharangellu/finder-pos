# Finder POS — Enterprise Execution Prompt Book

**Purpose.** Drive three Claude agents — **Database/Platform**, **Backend**, **Frontend** — to build the Finder POS platform **in parallel** as an enterprise-grade, scalable system, without colliding with each other. This book is the orchestrator's script: it defines the architecture, the contract that lets the three work simultaneously, the phase plan, the coordination rules, and the gates every increment must pass.

> Anchor decision: keep the existing `finder-pos/` **modular monolith** as the spine, enforce strict service boundaries so modules can be extracted into microservices later (Level 2 → Level 3 on the maturity model), and close the enterprise gaps that Year 1 was missing: **multi-tenancy, auth/RBAC, CI/CD, observability, backups/DR, feature flags.**

---

## 0. How to use this book

1. Read this file fully. It is the single orchestration spec.
2. Spin up the three agents, each with its own prompt file and its own git worktree/branch:
   - `AGENT_DATABASE.md` → branch `agent/database`
   - `AGENT_BACKEND.md` → branch `agent/backend`
   - `AGENT_FRONTEND.md` → branch `agent/frontend`
3. Each agent reads **(a)** this book, **(b)** its own prompt file, **(c)** the shared contracts in `contracts/`. Agents **never** read or edit another agent's source directory.
4. Work proceeds in **waves** (§5). At the end of each wave, the orchestrator runs the **integration gate** (§7) on `main`.

---

## 1. Mission & non-negotiables

Build a Point-of-Sale platform that is **scalable, reliable, secure, maintainable, observable, and cost-efficient**. Every increment must honour these invariants:

- **Multi-tenant from line one.** Every business table carries `tenant_id`. No query crosses tenants. Enforced in the database (Row-Level Security) *and* the app layer.
- **Money is integer cents.** Never floats. (Inherited from `CONTRACTS.md`.)
- **Modules integrate only through the contract** — shared DB schema + domain events + the OpenAPI surface. Modules never import each other's TypeScript.
- **Offline-first POS.** Checkout must work with the network down; sync reconciles on reconnect.
- **Secure by default.** Authn on every route, RBAC/ABAC on every action, audit log on every write, secrets never in code.
- **Automate from day one.** No manual deploys. CI/CD, feature flags, and observability are part of "done," not a later phase.

### Enterprise targets (exit criteria, not aspirations)
| Dimension | Year-1 target |
|---|---|
| Availability | 99.9% (≤ 8.7 h/yr); design toward 99.99% |
| API latency | p95 < 200 ms read, < 400 ms write |
| Page load | < 2 s (POS terminal first interactive) |
| Throughput (design point) | 600 RPS sustained, 3,000 RPS peak |
| Recovery | RPO ≤ 5 min, RTO ≤ 30 min (tested restore) |
| Test gates | typecheck 0 errors · unit+integration green · contract tests green |

---

## 2. The maturity trajectory

```
Level 1 Monolith            <10K users      ← prototype (legacy index.html)
Level 2 Modular Monolith    10K–100K users  ← WE BUILD HERE (microservice-ready)
Level 3 Microservices       100K–10M users  ← extraction path pre-wired
Level 4 Event-Driven Plat.  10M–100M users
Level 5 Global Distributed  100M+ users
```

We build **Level 2 done right**: one deployable, clean module seams, an in-process event bus that is API-compatible with Kafka, and a data layer ready to shard. Nothing in Year 1 may block the Level 3 jump.

---

## 3. Target architecture (Year-1 concrete shape)

```
                         ┌──────────────┐
        Browser / iPad → │  CDN + WAF   │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │  Frontend    │  React + Next.js (POS terminal SPA/SSR)
                         │  (agent/fe)  │  generated API client · MSW mocks · feature flags
                         └──────┬───────┘
                                │ HTTPS /api/v1/*   (OpenAPI contract)
                         ┌──────▼───────┐
                         │ API Gateway  │  authn (JWT/OAuth2) · rate limit · tenant routing
                         │  (in-app)    │  request id · trace context
                         └──────┬───────┘
                                │
        ┌───────────────────────▼────────────────────────┐
        │   Backend modular monolith  (agent/backend)     │
        │   catalog · inventory · orders · payments · sync│
        │   + identity (auth/RBAC) + audit                │
        │   in-process EventBus  ── Kafka-compatible API ─┤→ (future Kafka)
        └───────────────────────┬────────────────────────┘
                                │
        ┌───────────────────────▼────────────────────────┐
        │   Data layer  (agent/database)                  │
        │   PostgreSQL (RLS multi-tenant) · Redis cache   │
        │   migrations · seed · backups/DR · read-replica │
        └─────────────────────────────────────────────────┘
                                │
                      Observability: OpenTelemetry → Prometheus/Grafana + structured logs
                      Delivery: CI/CD (build→test→scan→deploy) · blue-green / canary
```

**Directory ownership (hard boundaries):**
```
finder-pos/
├── contracts/                 ← SHARED. Changes require an ADR + orchestrator merge.
│   ├── openapi.yaml           ← REST surface (backend publishes, frontend consumes)
│   ├── events.md              ← domain event catalog (name, payload, producer, consumers)
│   ├── schema.sql             ← canonical DDL (database owns)
│   └── CHANGELOG.md           ← every contract change, dated, with the ADR link
├── db/        (agent/database)  migrations/ · seeds/ · rls/ · backup/ · README
├── src/       (agent/backend)   modules/* · shared/* · gateway/ · identity/ · app.ts
├── web/       (agent/frontend)  Next.js app · api-client/ (generated) · mocks/ (MSW)
└── orchestration/             ← this book + the three agent prompts
```

Rule: an agent edits **only its own directory** + may **propose** changes to `contracts/` via the protocol in §4. The legacy root prototype (`index.html`, `app.js`, `styles.css`) is reference only — do not extend it.

---

## 4. Contract-first parallel protocol (the core mechanism)

This is how three agents build at the same time without waiting on each other.

### 4.1 The contract is the integration boundary
All cross-agent dependencies are expressed in `contracts/`, never in another agent's code:
- **DB shape** → `contracts/schema.sql` (owned by Database)
- **REST shape** → `contracts/openapi.yaml` (owned by Backend, consumed by Frontend)
- **Events** → `contracts/events.md` (Backend produces; Inventory/Sync/Audit consume)

### 4.2 Decouple with generated stubs + mocks (nobody blocks)
- **Frontend** does not wait for Backend. It generates a typed client from `contracts/openapi.yaml` and runs against **MSW** mock handlers derived from the same spec. When Backend ships a route, the frontend flips that endpoint from mock → live.
- **Backend** does not wait for the real DB to be fully designed. It codes against `contracts/schema.sql` and runs tests on an **embedded/throwaway Postgres** (already in the repo) seeded from `db/seeds/`.
- **Database** publishes schema + migrations first each wave, so the other two have a stable target.

### 4.3 Change protocol (when a contract must change)
1. Proposing agent writes a 1-paragraph **ADR** in `db/`, `src/`, or `web/` `…/adr/NNN-*.md` and a diff to the contract file.
2. Orchestrator reviews for cross-agent impact, updates `contracts/CHANGELOG.md`, merges to `main`.
3. Affected agents rebase and regenerate clients/types. **Contracts only move forward** (additive first; breaking changes get a new `/v2`).

### 4.4 Sequencing within a wave
```
Database (schema/migrations)  ──┐
                                 ├─ publish contracts to main (T+0)
Backend  (API against schema) ──┘
        │  publish openapi to main (T+0.5)
Frontend (UI against openapi + MSW) ── integrates live endpoints as they land
```
Lead time is hours, not days: Database leads by a contract publish, Backend by an OpenAPI publish; Frontend is never idle because mocks stand in.

### 4.5 Coordination log
`orchestration/INTEGRATION_LOG.md` — append-only. Each agent logs: wave, what it published, what it now consumes, and any contract proposal. The orchestrator reads this before each integration gate.

---

## 5. Phase / wave plan

Phases follow the enterprise delivery roadmap; each phase is a **wave** the three agents execute in parallel.

### Wave 0 — Foundation (all three, must finish before features)
- **Database:** Postgres baseline, `tenants` table, RLS policy template, migration runner, backup/restore script, seed harness.
- **Backend:** API gateway seam (authn middleware, tenant resolver, request-id + trace context, rate limiter, error envelope), `identity` module (JWT issue/verify, RBAC roles `owner|manager|cashier`), audit-log writer, health/readiness probes, OpenTelemetry wiring.
- **Frontend:** Next.js app shell, auth/login flow, design-system primitives, generated API client + MSW, feature-flag provider, accessibility + error-boundary baseline.
- **Cross-cutting:** CI pipeline (typecheck → unit → integration → SAST/dependency scan → build) green on all three branches.

### Wave 1 — Core commerce (the existing domain, tenant-aware)
- **Database:** `products, inventory, inventory_movements, orders, order_lines, payments, sync_queue` — all with `tenant_id` + RLS; indexes per access pattern; `idx` on `(tenant_id, …)`.
- **Backend:** port catalog / inventory / orders / payments / sync modules to tenant-scoped, authn'd routes; preserve order lifecycle (`open → completed → refunded/voided`), multi-state tax engine, event flows (`order.created → inventory decrement`, `payment.captured → order completed`).
- **Frontend:** product grid + search, cart/ring-up, tender (cash/card/split + change), receipt view, offline indicator.

### Wave 2 — Enterprise hardening
- **Database:** read-replica config, connection pooling (PgBouncer), partition/shard key chosen (`tenant_id`), Redis cache keys, retention/backup verified by a **restore drill**.
- **Backend:** rate-limit tiers, idempotency keys on payments, caching (cache-aside via Redis), webhooks/public API `v1`, structured SLO metrics + error budget, feature-flagged rollouts.
- **Frontend:** reporting dashboard, multi-store switcher, role-gated UI, performance budget (<2 s), canary-flag UI paths.

### Wave 3 — Scale & ops readiness
- Observability dashboards + alert runbooks; load test to 3,000 RPS peak; blue-green/canary deploy proven; DR game-day; SOC 2 Type I evidence checklist.

Each agent's own task list for these waves lives in its prompt file.

---

## 6. Cross-cutting standards (every agent obeys)

- **Tenancy:** `tenant_id UUID` on every business row; RLS `USING (tenant_id = current_setting('app.tenant_id')::uuid)`; backend sets `app.tenant_id` per request from the verified JWT.
- **Auth:** OAuth2/OIDC + short-lived JWT access tokens; RBAC roles + ABAC policy hook; every mutating route checks permission; every write emits an audit record `(tenant_id, actor, action, entity, before, after, ts)`.
- **IDs / time / money:** uuid v7 with table prefix; unix-epoch **ms**; integer **cents**.
- **Errors:** single JSON envelope `{ error: { code, message, requestId } }`; never leak internals.
- **Events:** publish through the `EventBus` API that mirrors Kafka semantics (topic = event type, key = `aggregateId`); handlers idempotent.
- **Caching:** cache-aside; explicit TTLs; cache keys namespaced by `tenant_id`; invalidate on write.
- **Observability:** every request carries a trace; RED metrics (Rate/Errors/Duration) per route; structured logs with `requestId` + `tenant_id` (never log secrets/PAN).
- **Security:** TLS 1.3 in transit, AES-256 at rest; secrets via env/secret store, never committed; PCI scope minimised (no raw PAN stored; tokenize).
- **Feature flags:** all new user-facing behaviour ships behind a flag; default off in prod.
- **Definition of code-complete:** code + tests + contract updated + flag + metric + audit + docs. Missing any one = not done.

---

## 7. Integration gate (run by orchestrator at each wave boundary)

A wave merges to `main` only when **all** pass:

1. `npm run typecheck` → 0 errors (backend + web).
2. `npm test` → unit + integration green (backend), component tests green (web), migration up/down idempotent (db).
3. **Contract tests** green: backend responses validate against `openapi.yaml`; frontend client built from the same spec; consumer-driven tests for each event in `events.md`.
4. **Tenancy test:** a cross-tenant read is denied at the DB (RLS) and the API layer.
5. **Auth test:** unauthenticated request rejected; role-gated route denies wrong role.
6. **Security scan:** SAST + dependency scan no high/critical.
7. **Smoke:** full lifecycle live — login → ring up → pay → receipt → refund — for two tenants, data isolated.
8. **Observability check:** the lifecycle produced traces + RED metrics; audit rows written.
9. **Backup check (Wave 2+):** restore drill meets RPO/RTO.

Record pass/fail in `INTEGRATION_LOG.md`. A red gate blocks the merge, not the other agents' next-wave prep.

---

## 8. Anti-patterns (auto-reject in review)

Premature microservices · shared mutable state between modules · synchronous A→B→C chains · business logic in the gateway · floats for money · any table without `tenant_id` · a route without authn · manual deploy steps · shipping without a feature flag · non-actionable alerts · "works on my machine" without a test · breaking a contract in place instead of versioning it.

---

## 9. Orchestrator runbook (quick reference)

```
for wave in [0,1,2,3]:
    dispatch Database  → publish contracts/schema.sql + migrations
    dispatch Backend   → build against schema, publish contracts/openapi.yaml
    dispatch Frontend  → build against openapi + MSW, integrate live endpoints
    each agent appends to INTEGRATION_LOG.md
    run §7 Integration Gate on main
    if green: tag wave, proceed
    else: file blocking task, agents continue next-wave prep
```

Agents are defined in: `AGENT_DATABASE.md`, `AGENT_BACKEND.md`, `AGENT_FRONTEND.md`.
