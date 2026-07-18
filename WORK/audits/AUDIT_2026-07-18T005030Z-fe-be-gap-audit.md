# Audit — Frontend ↔ Backend Gap Scan (full surface)

Date: 2026-07-18T005030Z
Session: Claude (Cowork, Fable 5)
Branch scanned: `feat/delivery-pipeline` (PR #70; = master + 95 commits)
Status label: **Audit only — no code changed**

Method: scripted extraction of every registered backend route (module `register()`
routes + `mountPath` resolution + `app.ts` direct routes + identity), every
`/api/v1|/api/identity` path literal in `web/{app,api-client,hooks,lib,components,contexts}`,
and every MSW handler path in `web/mocks/`. Paths normalized (`:id`/`${…}` → `:p`),
then diffed. Each flagged gap was hand-verified in source before being listed.

## Headline numbers

| Metric | Count |
|---|---|
| Backend registered routes | 533 (400 unique paths) |
| Frontend-referenced API paths | 374 |
| MSW-mocked paths | 395 |
| FE paths with **no backend route on this branch** | 148 → 136 real (12 scan artifacts, all hand-verified benign) |
| Backend paths never referenced by FE | 174 (includes the 65 double-prefix phantoms below) |

## 1. CRITICAL — the 2026-07-15 API-audit fixes are UNMERGED

Commit `29831bd` (session C, per `AUDIT_2026-07-15T140844Z`) fixed three critical
bugs, but it lives only on `origin/feat/clean-arch-pilot-quotes` (and
`origin/fix/sso-oidc-verification`). It is **not in master and not in
`feat/delivery-pipeline`**. Verified directly in this branch's source:

- **10 modules still double-prefixed → every route 404s**: restaurant (11 routes),
  workforce (13), appointments (4), entertainment (5), education (6), healthcare (6),
  hospitality (6), manufacturing (5), automotive (6), rental (5) — 67 routes registered
  at `/api/v1/<mod>/<mod>/…` while the FE calls `/api/v1/<mod>/…`.
- **SSO login unreachable**: no public mount of `/initiate`/`/callback` ahead of the
  `/api/v1` auth gate in this branch's `app.ts`.
- **`requireModule` business-pack isolation**: not present on this branch.

Every one of these pages "works" locally because MSW mocks answer — prod 404s.
**Action: merge or cherry-pick `29831bd` into the mainline before anything else.**

## 2. Mock-only endpoints in CORE modules (backend module exists, endpoint doesn't)

These are real modules where the page ships against mocks only — ordered by
retail-first priority:

| Area | Missing endpoints (normalized) | FE caller |
|---|---|---|
| Catalog product detail | 16 paths: `/catalog/:id/{analytics, audit-log, credits, duplicate, expiry, images/:id, invoices, pricing, pricing/tiers[/:id], purchases, reorder-suggestions, returns, sales, sales-by-customer, stock, supplier-price-comparison, suppliers[/:id]}` | `catalog/[id]/_components/*` |
| Catalog categories | `/catalog/categories/:id/products[/:id]` | `catalog/categories/[id]` |
| Customers | `/customers/search`, `/customers/:id/merge` | `customers/[id]` |
| Inventory | `/inventory/errors[ /:id, /summary]`, `/inventory/pipeline/{summary,pending,receiving[/:id/update],issues[/:id],history,reorder-alerts[/:id/create-po]}`, `/inventory/returns`, `/inventory/supplier-returns`, `/inventory/locations/:id` | inventory pages |
| Orders | `/orders/:id/timeline` | `orders/[id]` |
| Team | `/team/:id/{clock-in, clock-out, time-entries, permission-overrides, permission-requests}` | `team/[id]` |
| Notifications | `/notifications/{digest, preferences, rules[/:id]}` | notifications page |
| Purchasing | `/purchasing/edi-imports[…5 paths]`, `/purchasing/vendor-history` | purchasing pages |
| Workflows | `/workflows/{approval-chains[/:id], run-history}` | workflows page |
| Settings | `/settings/b2b`, `/settings/permissions`, `/settings/custom-roles[/:id]` — NB backend serves custom roles at `/api/v1/custom-roles`; FE calls a different path (path mismatch, not a missing feature) | settings pages |
| Ecommerce storefront | `/ecommerce/auth/{login, logout, me, register}` — storefront customer auth has no backend at all | `StoreAuthContext` |
| Restaurant | `/restaurant/dashboard` — missing even after the `29831bd` prefix fix (already noted in the 07-15 audit) | restaurant dashboard |

## 3. Preview verticals — mock-only BY DESIGN (no action)

golf (9 paths), pricing (6), warehouse (6), documents (4), promotions (8) have no
backend module at all — documented as UI-preview-only per `ae79907` and the
LOOP_STATE drift-sweep note. Not bugs; keep labeled Preview in the UI.

## 4. Backend ahead of frontend (informational)

174 backend paths are never referenced by the web app. Beyond the 65 double-prefix
phantoms (§1), the concentration is: purchasing (19), sales (14), inventory (9),
catalog (8), accounting (7), customers/outlets/settings (5 each). Mostly deeper
CRUD/actions the UI hasn't surfaced — no action needed, useful map for future pages.

## 5. Verified-benign scan artifacts (for the next auditor)

`/api/v1/things` (JSDoc example in `client.ts`), `/api/v1/progress` (comment in
`types.ts`), `…${search}`/`…${q}` query-string concatenations,
`deposits/:id/:action` → matches `approve|reject` routes,
`expiry/:id/:action` → matches `discard|return-to-vendor`,
`vendors/:id/:tab` → matches the 5 vendor subroutes.

## ADDENDUM (same day, follow-up session) — fixes shipped

Status label: **Built, typecheck-verified; tests written but NOT executed in
this environment** (sandbox has macOS-installed node_modules; esbuild binary
mismatch — run `npm test` locally / rely on CI).

1. **§1 critical fixes PORTED to this branch** (not the whole cherry-pick — the
   clean-arch quotes pilot stays on session C's branch): double-prefix dropped
   in all 10 modules + their new regression tests + test-request helpers
   (checked out verbatim from `29831bd`; files were identical to the merge-base),
   `requireModule` added to gateway/auth.ts WITHOUT the pilot's authorization.ts
   refactor, SSO public router mounted ahead of the auth gate in app.ts.
2. **Team time clock built**: `time_entries` table (partial unique index = one
   open entry per member), atomic clock-in/out (INSERT…WHERE NOT EXISTS /
   single UPDATE), self-or-management guard; per-member permission-requests/
   overrides delegate to the permission_requests module (new
   `listOverridesForUser` with live expiry computation). Tests added.
3. **Customers search + merge built**: `{items}` envelope (FE + mock aligned);
   merge is one transaction with sorted FOR UPDATE locks, repoints
   orders/invoices/quotations/sales_orders + satellites (survivor wins
   conflicts), adds points/store-credit, deletes the duplicate, publishes
   `customer.merged`. Tests added.
4. **Orders timeline built**: derived from order row + payments (no event
   table — honestly documented approximations in the JSDoc). Tests added.
5. **Storefront auth gated as Preview** (per decision): `previewMode` in
   StoreAuthContext (mirrors MockWorkerInit's mock switch;
   `NEXT_PUBLIC_STORE_AUTH_ENABLED=1` re-enables when a backend ships), login
   page banner + disabled submit outside mock/demo mode.
6. **Guardrail shipped**: `tools/api-gap-scan.mjs` + `npm run gap:scan`, wired
   into CI (hygiene job) and `npm run verify`; allowlist
   `tools/api-gap-allowlist.json` (56 paths/6 prefixes, each board-tracked;
   scanner warns on stale entries so it only shrinks). Negative-tested (bogus
   FE path → exit 1). Parity policy added to CODING_STANDARDS.md; `fe-be-parity`
   Cowork skill packaged for install.
7. **NOT fixed, reclassified**: `settings/custom-roles` is a contract mismatch,
   not a path mismatch — FE permissions page speaks `{name,color,features}` +
   bulk `/settings/permissions`, backend speaks `{name,permissions}` from a
   fixed vocabulary, no color. Merging two permission vocabularies is a design
   decision → NEEDS-SRI.

## Recommended order of attack

1. Merge/cherry-pick `29831bd` (unblocks 10 modules + SSO + pack isolation) — one PR.
2. Catalog product-detail endpoints (biggest single mock-only surface in the retail core).
3. Team time-tracking + customers search/merge + orders timeline (small, high-traffic).
4. Fix the `settings/custom-roles` path mismatch (1-line FE or mountPath change).
5. Decide: ecommerce storefront auth — build backend or gate the storefront UI.
6. Inventory pipeline/errors pages — either build endpoints or label Preview.
