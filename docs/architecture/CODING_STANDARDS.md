# Ascend — Coding Standards (repo idioms)

Match the surrounding code. These are the idioms the codebase actually uses.

## Backend
- **Raw SQL with named params** (`@param`), never string interpolation of user
  input. SQL fragments (ORDER BY, op expressions) come from hardcoded
  whitelists keyed by enums. (ADR-001)
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
  `tenantId(res)` from auth payload. Thin handlers — logic lives in services.
- Events: publish AFTER the tx commits; payloads carry `tenantId` and cents
  amounts. Consumers that may be redelivered must be idempotent.
- Concurrency: unique constraints are the real guard (catch 23505 → 409);
  counters via `nextDocNumber/nextDocSeq`; never COUNT(*)+1 or MAX+1.
- Lists: keyset pagination (`shared/pagination.ts`); no bare LIMIT-N lists on
  unbounded tables. Policy: cursor pagination is REQUIRED for unbounded,
  append-heavy lists (orders, inventory movements, audit log, ledger);
  offset/limit remains acceptable for small tenant-bounded lists (categories,
  outlets, taxes); new list endpoints default to cursor. Don't migrate
  existing offset endpoints without a reason — it's a client-breaking change.
- API versioning: everything lives under `/api/v1`; changes must be additive
  (new fields/endpoints OK, never remove or repurpose). A breaking change
  mints `/api/v2` side-by-side — no Accept-header negotiation, no silent
  breaking changes under v1.
- Append-only tables never get UPDATE/DELETE code paths.

## Frontend (web/)
- Next.js 14 app router; pages call `apiGet/apiPost/apiPatch` (api-client).
- `EnterpriseShell` wraps pages; nav keys + module/feature gating.
- Client-side role gating via `hasRole`; server is the real enforcement.
- Loading skeletons, empty states, `role="alert"` errors — every data view.
- Money display via `formatMoney`; dates via `lib/date` helpers.

## API parity (frontend ↔ backend ↔ mocks)
- A frontend API call, its MSW mock, and its backend route are ONE unit of
  work — never ship one without the other two. Mock paths AND response
  envelopes must match the real route exactly.
- `npm run gap:scan` (tools/api-gap-scan.mjs) diffs every FE path literal
  against every registered backend route; it runs in CI and `npm run verify`
  and fails on unexplained gaps.
- Deliberate UI-preview surfaces require all three, in the same commit: an
  entry in `tools/api-gap-allowlist.json`, a board entry (FORWARD_PLAN §4 or
  LOOP_STATE backlog), and a visible "Preview" label in the UI.
- The allowlist only shrinks: when a backend route ships for an allowlisted
  path, the scanner warns — remove the entry in that same commit.
- Context: AUDIT_2026-07-18T005030Z (10 modules 404'd in prod behind mocks).

## Testing
- `node:test` + embedded Postgres; per-test schema isolation (`freshApp()`).
- Drive the HTTP surface (`call(app, method, path, body, role?)`), assert the
  error envelope. Concurrency bugs get `Promise.all` regression tests.
- Full-suite parallel flakes are known (PG_POOL_MAX=1); single-file runs are
  authoritative; smoke (20 steps) is the e2e backstop.

## Process
- Verified slices: gates green before commit; audit notes in `WORK/audits/`;
  Code Delivery Standard in commit messages; ADR for significant decisions.
- Honest status labels: built ≠ verified ≠ deployed.
