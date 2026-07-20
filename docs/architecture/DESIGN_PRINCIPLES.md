# Ascend — Design Principles

Mandatory reading before making a significant architectural or domain
change. Consolidates the former `ENGINEERING_CONSTITUTION.md` +
`CODING_STANDARDS.md` + the core doctrine from `CTO_CHARTER.md` into one
file — those are archived under `_archive/`. This is the highest engineering
authority for the repo; changes go through review like code.

## Mission

Ascend is a **Commerce Operating System** — not a POS, not an ERP. It powers
retail, wholesale, distribution, warehousing, manufacturing, B2B/B2C
commerce, financial operations, and AI business automation. Think:
ServiceNow for commerce, Shopify for enterprise, Stripe for finance, SAP B1
for operations.

## The monolith stance

The domain-driven modular monolith **is** the architecture until proven
otherwise. Microservices are not an upgrade; they're justified only by
100+ engineers, independent-deployment bottlenecks, independent scaling
needs, real organizational boundaries, and proven operational maturity.
Module boundaries are the service boundaries, with zero network tax.

Never recommend prematurely: Kubernetes, service mesh, Kafka,
CQRS-everywhere, event-sourcing-everywhere, GraphQL federation, multiple
databases, distributed transactions, sharding — each needs measurable
evidence of a current business problem it solves. Scaling order: vertical
first → indexes → query plans → connection pooling → caching → background
workers → read models → materialized views → read replicas → queue backlog
→ CPU/memory/network/IOPS — before any architecture change.

The test for every choice: **"Could a team of 20 engineers successfully
build and operate this?"** If yes, prefer the simpler option; if no, the
added complexity must be justified by measurable business evidence.

Priorities, in order: **business value → financial correctness →
operational excellence → developer productivity → scalability → simplicity
→ long-term maintainability.**

## Non-negotiables

- Domain-driven modular monolith, extraction-ready; no premature
  microservices/Kafka/K8s/multi-DB (evidence required).
- **Financial correctness is sacred:** double-entry, immutable journals,
  idempotency, audit trail; no eventual consistency inside a financial
  transaction (the outbox handles durability *around* it — ADR-003).
  Integer cents, always.
- Module ownership: logic, tables, events, tests, docs. Writes never cross
  module boundaries; cross-domain SQL reads accepted (ADR-002).
- No business logic in UI or route handlers — services own it.
- Events: business tx → outbox → worker → processing → read models.
- Multi-tenancy: every query tenant-scoped (gateway AsyncLocalStorage + RLS
  backstop); verify tenant filters, RBAC, store/warehouse/department
  permissions, and auditability on anything new.
- Search: no SQL LIKE as the enterprise search story; adopt a dedicated
  engine only when search is a measured bottleneck.
- Files: object storage, never bytea in Postgres.
- Async by default for: emails, PDFs, exports/imports, notifications,
  inventory/price recalculation, AI processing, accounting reconciliation.

## Rule zero: evidence beats the charter

Verify stack claims against the repository before reasoning from them — this
doctrine's own default assumptions have diverged from reality before, and an
entire gap-tracking folder (`GAPS.md`'s predecessor) sat stale for over a
month describing things as "missing" that had already shipped. When the
charter and the repo disagree, the repo wins; note the divergence out loud.
Before recommending or building from a memory/doc claim that names a
specific function, file, route, or flag: grep for it, don't assume it's
still true.

## Backend idioms

- **Raw SQL with named params** (`@param`), never string interpolation of
  user input. SQL fragments (ORDER BY, op expressions) come from hardcoded
  whitelists keyed by enums (ADR-001). No Prisma — raw SQL via
  `src/shared/db.ts`'s placeholder compiler with CI guards against
  interpolation; adopt an ORM only if raw SQL becomes measurably painful.
- Money: integer **cents** (`price_cents`), `Cents` type. Never floats.
- IDs: `prefix_uuidv7()` (`prod_`, `po_`, `jre_`…).
- Modules: `{ name, migrations[], register({db, events, router, outbox?}) }`;
  migrations idempotent (`IF NOT EXISTS`), appended never edited.
- Errors: `HttpError(status, code, message, details?)` →
  `{error:{code,message,details?}}` envelope. Shared codes live in
  `ERROR_CODES` (`shared/http.ts`) — one meaning, one status each; modules
  mint their own stable snake_case codes for domain state conflicts.
  Validation failures carry per-field `details`. Codes are additive-only API
  contract: never remove or repurpose one.
- Routes: zod `parseBody`, `requireRole("manager"|"owner")` for mutations,
  `tenantId(res)` from auth payload. Thin handlers — logic lives in
  services. New protected routes need real auth middleware actually mounted
  in front of them — a route's own `if (!auth)` fallback check is not a
  substitute (this was a real, live bug this session: `/api/identity/*`'s
  protected routes had no auth middleware mounted at all for weeks).
- Events: publish AFTER the tx commits; payloads carry `tenantId` and cents
  amounts. Consumers that may be redelivered must be idempotent.
- Concurrency: unique constraints are the real guard (catch 23505 → 409);
  counters via `nextDocNumber/nextDocSeq`; never COUNT(*)+1 or MAX+1.
- Lists: keyset pagination (`shared/pagination.ts`); no bare LIMIT-N lists on
  unbounded tables. Cursor pagination is REQUIRED for unbounded, append-heavy
  lists (orders, inventory movements, audit log, ledger); offset/limit
  remains acceptable for small tenant-bounded lists; new list endpoints
  default to cursor. Don't migrate existing offset endpoints without a
  reason — it's a client-breaking change.
- API versioning: everything lives under `/api/v1`; changes must be
  additive (new fields/endpoints OK, never remove or repurpose). A breaking
  change mints `/api/v2` side-by-side.
- Append-only tables never get UPDATE/DELETE code paths.
- Bulk-merging duplicate module tables is a real, recurring failure mode —
  this session found and fixed the *same class* of bug three separate times
  (two modules independently creating a table of the same name with an
  incompatible schema, silently 500ing on every write). Grep for a table
  name across the whole `src/modules/` tree before creating a migration for
  it.

## Frontend idioms (web/)

- Next.js 14 app router; pages call `apiGet/apiPost/apiPatch` (api-client).
- `EnterpriseShell` wraps pages; nav keys + module/feature gating via the
  four-layer capabilities model (tenant module gate → tenant route gate →
  user feature gate → partial/preview gate).
- Client-side role gating via `hasRole`; server is the real enforcement.
- Loading skeletons, empty states, `role="alert"` errors — every data view.
- Money display via `formatMoney`; dates via `lib/date` helpers.
- A route the backend proxies to (e.g. `/healthz`, `/readyz`) must also be
  allowlisted in `middleware.ts`'s public-path list if it's meant to be
  reachable without auth — `next.config.mjs` rewrites and `middleware.ts`'s
  auth gate are two separate systems that must agree (a real bug this
  session: health-check probes were redirected to `/login` because they
  were proxied but not allowlisted).

## API parity (frontend ↔ backend ↔ mocks)

- A frontend API call, its MSW mock, and its backend route are ONE unit of
  work — never ship one without the other two. Mock paths AND response
  envelopes must match the real route exactly.
- `npm run gap:scan` (`tools/api-gap-scan.mjs`) diffs every FE path literal
  against every registered backend route; runs in CI and `npm run verify`,
  fails on unexplained gaps.
- Deliberate UI-preview surfaces require all three, in the same commit: an
  entry in `tools/api-gap-allowlist.json`, a board entry
  (`WORK/FORWARD_PLAN.md` or `LOOP_STATE.md` backlog), and a visible
  "Preview" label in the UI.
- The allowlist only shrinks: when a backend route ships for an allowlisted
  path, the scanner warns — remove the entry in that same commit.

## Testing

- `node:test` + embedded Postgres; per-test schema isolation (`freshApp()`).
- Drive the HTTP surface (`call(app, method, path, body, role?)`), assert
  the error envelope. Concurrency bugs get `Promise.all` regression tests.
- Full-suite parallel flakes are known (`PG_POOL_MAX=1`, "socket hang up" /
  ECONNRESET on unrelated files under load); single-file runs are
  authoritative — confirmed repeatedly this session via isolated re-runs
  before trusting a "failure." Never dismiss a failure without checking
  whether the diff even touches the failing file first.
- `npm run smoke` (20 steps) is the e2e backstop.
- A test asserting an exact count/total against a "clean" database is
  fragile if anything else (boot-time seeding, another test's leftover
  state) can add rows — assert the specific rows you care about are
  present, not an exact total, unless the total is genuinely guaranteed
  clean.

## Debugging discipline

Don't guess-patch. Reproduce or precisely identify the failure first, trace
evidence to the real cause (not the first plausible-looking line), fix the
smallest responsible part, verify against the original failure, then explain
cause/fix/verification/remaining-risk. A plausible-looking fix that isn't
verified against the actual failure can make things *worse* — this session's
own history includes a fix that looked right and tripled a failure count
because the real cause was a rate limiter, not the thing that got "fixed."

## Process

- Verified slices: gates green before commit; audit notes in
  `WORK/audits/`; Code Delivery Standard in commit messages (architecture
  impact · database impact · testing evidence · security impact · rollback
  note · monitoring needs — "none" is valid, silence is not); ADR for
  significant decisions.
- Honest status labels: **built ≠ verified ≠ deployed.**
- Quality gates every change: `npm run typecheck` · `npm test` ·
  `npm run smoke` · `npm run hygiene` · web `typecheck/lint/build` — plus
  the review protocol (architecture, security, database, QA lenses) and the
  Code Delivery Standard.
- Leave the codebase better than you found it. Never the fastest solution —
  the solution that keeps Ascend maintainable for the next decade.

## Known deviations from a generic template (ruled, do not re-litigate)

- Raw SQL, not Prisma (ADR-001).
- Backend is Express modules behind a Next.js proxy, not Next API routes.
- Redis/object storage/workers are roadmap items, not yet default
  everywhere (production's job-tick path is real; the general in-process
  worker loop is not, on non-production tiers).
