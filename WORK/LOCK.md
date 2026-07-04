# FinderPOS — Multi-Agent Work Lock

Status: ACTIVE

## Parallel Non-Overlapping Claim (Codex session H — product variant atomicity)

| Field | Value |
|---|---|
| Agent/session | Codex session H |
| Queue item | Product lifecycle hardening: make multi-child catalog variant assignment/generation atomic so failed operations cannot partially apply |
| Files/areas expected | `src/modules/catalog/service.ts`, `src/modules/catalog/catalog.test.ts`, WORK evidence only. NO `web/e2e/**` (Antigravity active), NO report/EOD files (session A active), NO orders/payments/outlets/smoke script. |
| Started | 2026-07-04 13:35 CDT |
| Last update | 2026-07-04 13:51 CDT |
| Status | RELEASED - shipped in `efd7873`; catalog focused test 31/31, backend typecheck PASS, smoke 15/15, backend suite 322/322, frontend typecheck/lint/test/build PASS |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — EOD frontend harvest)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | Harvest the end-of-day report PAGE from salvage branch `worktree-agent-abecc2986…` and wire it to the real `GET /api/v1/reports/end-of-day` endpoint (shipped `d61184c`). EOD files only — the branch's terminal shortcuts + stock-transfer modal stay parked |
| Files/areas expected | `web/app/(protected)/reports/end-of-day/page.tsx` (new), `web/app/(protected)/reports/page.tsx` (link), one dev-mode mock handler in `web/mocks/`. Gates: web typecheck/lint/vitest/build ONLY — no dev servers, no ports 3000/3001 (Antigravity e2e active). NO e2e specs, NO inventory/catalog pages (Codex G) |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — scope corrected mid-item: the page + mock handler were ALREADY on master (a prior harvest); actual gaps shipped in `34ff1b8` — no-session handling (null openedAt / 'no_session' status per real endpoint) and a nav entry (page was orphaned; 'End of Day' added to ReportsSubNav → /reporting/closing). Gates: typecheck, lint 0 errors, vitest 89/89, build exit 0. NOTE for all sessions: never run `next build` concurrently in this checkout — two simultaneous builds corrupted `.next` (ENOENT manifest) |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session G — product catalog variants)

| Field | Value |
|---|---|
| Agent/session | Codex session G |
| Queue item | Product catalog end-to-end proof: strengthen product creation and master/parent/child variant relationships without expanding unrelated features |
| Files/areas expected | `src/modules/catalog/service.ts`, `src/modules/catalog/catalog.test.ts`, `web/app/(protected)/inventory/products/new/page.tsx`, `web/app/(protected)/inventory/products/[id]/_components/VariantsTab.tsx`, focused frontend test if needed, WORK evidence. NO `src/modules/orders/**`, NO `src/modules/payments/**`, NO `src/modules/outlets/**`, NO `scripts/smoke.ts`, NO `web/e2e/**`. |
| Started | 2026-07-04 |
| Last update | 2026-07-04 13:23 CDT |
| Status | RELEASED - shipped in `d9bdd96`; backend suite 320/320, typecheck PASS, smoke 15/15, frontend Vitest 89/89, typecheck/lint/build PASS |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — EOD report backend)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | End-of-day report backend (core flow: "close register → end-of-day report"): implement real `GET /api/v1/reports/end-of-day` matching the contract defined by the salvage branch's mock (transactions, sales totals, tender breakdown, top items, cash drawer expected-vs-counted). Backend only; frontend page harvest (`worktree-agent-abecc2986…`) deferred until Antigravity e2e claim releases |
| Files/areas expected | `src/modules/reports/service.ts`, `src/modules/reports/routes.ts`, `src/modules/reports/reports.test.ts`. NO `src/modules/catalog/**` (Codex G), NO `web/**`, NO `scripts/smoke.ts`, no ports |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — shipped in `d61184c`: real Z-report endpoint matching the salvage page's contract exactly (drop-in frontend harvest once e2e web claim releases). Gates: typecheck clean, reports suite 3/3 (new lifecycle test: sessions, change-giving, refunds, variance, 400s), smoke 15/15 |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — audit-log coverage)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | Audit-log coverage for critical actions (readiness matrix "Partial"): audit_log gets NO entries from order create/refund/void, payment capture/refund, or register open/close — only identity events + one workflow write. Add writes at those mutations + smoke proof |
| Files/areas expected | `src/shared/audit.ts` (new), `src/modules/orders/**`, `src/modules/payments/**`, `src/modules/outlets/**`, `scripts/smoke.ts` (new assertion step). NO `src/gateway/rateLimit*` (Codex F), NO `web/**` (session E), no ports |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — shipped in `de374ad`: six mutations audit-logged with real actor ids; smoke step 15 gates coverage in CI. Gates: typecheck clean, smoke 15/15, targeted module suite 54/54; full-suite hang was machine contention (ecommerce.test.ts passes 8/8 in isolation) |
| Blockers | none |

## Active Team Claim (Antigravity team — e2e core-flow triage)

| Field | Value |
|---|---|
| Agent/session | Antigravity session (VSCode), team of 3 teammates + lead |
| Queue item | #1 — Triage/fix 9 core-flow e2e failures (checkout ×3, inventory-receive ×3, invoice-pay ×3) |
| Files/areas expected | `web/e2e/checkout.spec.ts` (teammate 1), `web/e2e/inventory-receive.spec.ts` (teammate 2), `web/e2e/invoice-pay.spec.ts` (teammate 3). Read-only: page components, mock handlers, seed data. No page/component edits — spec-only fixes. |
| Started | 2026-07-04 12:16 CDT |
| Last update | 2026-07-04 12:16 CDT |
| Status | ACTIVE — triage in progress |
| Blockers | none |
| Root causes identified | (1) Checkout: RegisterSessionGuard blocks product grid — spec must open register first; stale "coffee" search term (seed uses retail products). (2) Inventory-receive & invoice-pay: auth state (storageState) not surviving across spec files — tests land on login page. (3) Logout: user menu button label "O owner" doesn't match spec's `/user\|account\|profile/i` pattern. |

## Stale Claim (session E — e2e triage, superseded)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, takeover confirmed by Sri) |
| Queue item | #1 — Triage/fix 10 core-flow e2e failures |
| Status | STALE — blocked on local frontend build hang (`cd web && npm run build` hangs at "Creating an optimized production build"); no progress since 2026-07-04; superseded by Antigravity team claim above per Sri's directive |

## Parallel Non-Overlapping Claim (session A — /healthz version stamp)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | Observability quick win: /healthz reports git SHA + build time so "what is running in prod?" is answerable with one curl |
| Files/areas expected | `src/shared/version.ts` (new), `src/app.ts` (healthz handler), `scripts/deploy.sh` (write version.json into staging dir), `.gitignore`. No `web/**`, no e2e, no ports/DB |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — shipped in `68fd40b`; env + version.json resolution paths proven, typecheck clean, smoke 14/14 |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — stripe deploy drift)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | deploy-prod fails on every push: stripe caret range drifts past the pinned apiVersion literal on fresh installs in `scripts/deploy.sh` staging dirs |
| Files/areas expected | `package.json` (exact-pin stripe), `WORK/WORK_STATE.md`. No `web/**` app code, no e2e, no ports/DB |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — stripe pinned to 22.2.2 (`de02f29`); lockfile stable, backend typecheck clean. Deploy still needs a valid VERCEL_TOKEN secret (Sri-only) to go green end-to-end |
| Blockers | none |

## Active Claim

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, takeover confirmed by Sri) |
| Queue item | #1 — Triage/fix 10 core-flow e2e failures (checkout ×3, inventory-receive ×3, invoice-pay ×3, logout ×1) |
| Files/areas expected | `web/e2e/*.spec.ts`; possibly terminal/purchasing/finance pages + components if real gaps found. Production build (`NEXT_PUBLIC_MOCK=false`) + real backend + Postgres via harness |
| Started | 2026-07-04 |
| Last update | 2026-07-04 12:16 CDT — superseded by Antigravity team claim above |
| Status | STALE — superseded; do not work this claim |
| Blockers | none |

## Superseded Claim (session A — stale, released by Sri 2026-07-04)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, "NEXT" directive from Sri) |
| Queue item | #1 — e2e core-flow triage (same item as above) |
| Status | RELEASED (stale) — no lock update and no pushed commits >24h after claim; Sri confirmed the session is no longer running. Item taken over by session E. |

## Parallel Non-Overlapping Claim (session A — CI hardening)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, resumed 2026-07-04; prior stale #1 claim correctly released) |
| Queue item | CI hardening (AUDIT_2026-07-03B rec #2): make CI gates real — add `npm run smoke` to backend job; fix e2e job (mocks were ON: dead `NEXT_PUBLIC_E2E_MODE`, missing `NEXT_PUBLIC_MOCK=false`; bare `tsx` not on PATH; `npm start` incompatible with standalone output; wait loops never fail) |
| Files/areas expected | `.github/workflows/ci.yml` ONLY. No `web/**`, no `src/**`, no e2e specs, no local ports — zero overlap with session E's item #1 |
| Started | 2026-07-04 |
| Last update | 2026-07-04 — all commits pushed (`a0c91fd`, `8049ce1`, `c01e609` + docs); transient GitHub git-transport outage resolved |
| Status | RELEASED — smoke gate VERIFIED green in CI (run 28696807979); e2e job fixed through 6 stacked defects (mocks-on build via dead flag, bare tsx, npm start vs standalone, swallowed wait failures, devDeps skipped under NODE_ENV=production, prod mode structurally impossible on CI runners). First full e2e-in-CI result tracked in WORK_STATE after run 28698933075. New queue item filed: deploy-prod.yml Stripe apiVersion drift. |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session C — SEC-3)

| Field | Value |
|---|---|
| Agent/session | Codex session C |
| Queue item | SEC-3 — Add frontend HSTS header in `web/middleware.ts` |
| Files/areas expected | `web/middleware.ts`, `WORK/WORK_STATE.md`, new audit note only. No `.github/**`, no `web/e2e/**`, no backend/server/ports/database. |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — no code change needed; current `web/middleware.ts` already sets `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session C — SEC-4)

| Field | Value |
|---|---|
| Agent/session | Codex session C |
| Queue item | SEC-4 — Remove unsafe `document.write()` product-field injection from print labels modal |
| Files/areas expected | `web/app/(protected)/catalog/_components/PrintLabelsModal.tsx`, focused test if existing pattern allows, `WORK/WORK_STATE.md`, new audit note. No `.github/**`, no `web/e2e/**`, no backend/server/ports/database. |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — non-overlapping work complete; focused Vitest PASS, full frontend Vitest 84/84, frontend typecheck/lint/build PASS, backend typecheck PASS, backend tests PASS 312/312; pushed in `540caf9` |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session D — SEC-8)

| Field | Value |
|---|---|
| Agent/session | Codex session D |
| Queue item | SEC-8 — route catalog CSV export through shared API client refresh/error handling instead of direct authenticated `fetch()` |
| Files/areas expected | `web/api-client/client.ts`, `web/app/(protected)/imports-exports/page.tsx`, focused frontend API-client tests, `WORK/WORK_STATE.md`, new audit note. No `.github/**`, no `web/e2e/**`, no backend/server/ports/database. |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — non-overlapping work complete; focused API-client Vitest PASS, full frontend Vitest 86/86, frontend typecheck/lint/build PASS, backend typecheck PASS, backend tests PASS 312/312; pushed in `555afc0` |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session E — SEC-7)

| Field | Value |
|---|---|
| Agent/session | Codex session E |
| Queue item | SEC-7 — verify and document `finder_refresh` cookie SameSite behavior end-to-end |
| Files/areas expected | Auth refresh cookie code/tests and WORK evidence only. No `.github/**`, no `web/e2e/**`, no frontend app pages, no fixed ports. |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — non-overlapping work complete; backend test runner PASS 313/313, backend typecheck PASS, frontend typecheck/lint/build PASS, smoke PASS 14/14; pushed in `4e2487e` |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session F — SEC-9)

| Field | Value |
|---|---|
| Agent/session | Codex session F |
| Queue item | SEC-9 — upgrade Redis-backed sensitive rate limiting away from fixed-window bursts |
| Files/areas expected | `src/gateway/rateLimit.ts`, `src/gateway/rateLimit.test.ts`, `web/next.config.mjs` build-worker unblock, WORK evidence only. No `.github/**`, no e2e, no app health/version stamp files, no ports/DB. |
| Started | 2026-07-04 |
| Last update | 2026-07-04 — pushed in `a83ed5a` |
| Status | RELEASED — Redis rolling-window limiter + Next build-worker unblock verified; focused rate-limit PASS 6/6, backend typecheck PASS, smoke PASS 14/14, full backend suite PASS 315/315, frontend typecheck/lint/build PASS |
| Blockers | none |

## Parallel Non-Overlapping Claim

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" directive from Sri) |
| Queue item | #4 — RLS gap: request-scoped tenant context (AsyncLocalStorage) so the DB layer sets app.tenant_id on every authenticated query; cross-tenant regression test on real Postgres. Policy stays permissive-when-unset (strict flip deferred until e2e green) |
| Files/areas expected | `src/shared/db.ts`, `src/shared/tenant-context.ts` (new), `src/gateway/auth.ts` (tenantResolver), `src/modules/rls/index.ts` (policy carve-outs), `src/gateway/tenant-isolation.test.ts` (new) — backend only, NO `web/**` edits. Embedded Postgres via test harness (no fixed ports) |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — built + verified (isolation test PASS via non-superuser role, tsc 0 errors, smoke 14/14, probe 22/22, full suite green); committed and pushed. See WORK/AUDIT_2026-07-04C.md |
| Blockers | none |

## Released Claims (session E, item #3)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" directive from Sri) |
| Queue item | #3 — Implement ~14 mock-only endpoints on the real backend (inventory transfers/adjustments, team invite/detail, workflow templates, AR-aging sweep, Vendor-360 family ×6) |
| Files/areas expected | `src/modules/inventory/**`, `src/modules/team/**`, `src/modules/workflows/**`, `src/modules/reports/**`, `src/modules/purchasing/**`, `src/identity/migrations.ts` (additive users.name) — backend only, NO `web/**` edits. Embedded Postgres via test harness (no fixed ports) |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — all endpoints implemented + verified (probe 22/22 on real Postgres, tsc 0 errors, smoke 14/14, backend tests green); committed and pushed. See WORK/AUDIT_2026-07-04B.md |
| Blockers | none |

## Released Claims

| Field | Value |
|---|---|
| Agent/session | Codex session B |
| Queue item | #2 — Fix 8 stale frontend Vitest assertions (`catalogCart.test.tsx`, `reportsDashboard.test.tsx`) |
| Files/areas expected | `web/tests/catalogCart.test.tsx`, `web/tests/reportsDashboard.test.tsx`; read-only inspection of related components/hooks |
| Started | 2026-07-03 ~21:30 CDT |
| Last update | 2026-07-03 ~21:36 CDT |
| Status | RELEASED — non-overlapping work complete; targeted Vitest 12/12, full frontend Vitest 83/83, frontend typecheck/lint/build PASS |
| Blockers | none |

## Rules

- Claim one queue item before editing code.
- Do not work an overlapping queue item while this file is `ACTIVE`.
- If a lock looks stale, mark it `STALE?` and stop for review; do not silently overwrite it.
- Release the lock only after commit and push succeed.
- If blocked, leave the lock active and write the blocker clearly.

## Common Multi-Agent Failure Modes

- One agent verifies against stale code while another has unpushed changes.
- Two agents edit the same tests or routes and one overwrites the other.
- A dev server, backend server, or Postgres instance from another session changes e2e results.
- One agent updates migrations while another tests an older schema.
- A second agent sees failures caused by a dirty tree, not by the application.
