# FinderPOS — Multi-Agent Work Lock

Status: ACTIVE

## Parallel Non-Overlapping Claim (session A — seed-demo production guard)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | Sibling of the seed-e2e guard (`7715f68`): `scripts/seed-demo.ts` has NO production guard — pointed at a real DATABASE_URL it pollutes prod with demo commerce data (12 products, 8 customers, 25 orders). Add the same ALLOW_DEMO_SEED opt-in refusal + refuse when NODE_ENV=production |
| Files/areas expected | `scripts/seed-demo.ts` ONLY. Does NOT touch session M's new `scripts/ops-check.ts` (session M explicitly disclaims seed changes), no `package.json`, no `web/**`, no prod DB |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped `4af81a0`: refuses in production and requires ALLOW_DEMO_SEED=1 elsewhere; all three paths verified, typecheck clean. Both seed scripts (e2e + demo) now safe against production. |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — production demo credentials)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | STRUCTURAL half of the demo-credentials security item: `scripts/seed-e2e.ts` deliberately bypasses the production guard and plants known creds (owner@/cashier@finder-pos.dev) — this is how they reached the live prod DB. Guard it to refuse unless ALLOW_E2E_SEED=1; wire that flag into the CI e2e seed step. (The one-time prod-DB hash rotation is Sri's, Option B, running it manually.) |
| Files/areas expected | `scripts/seed-e2e.ts` (guard), `.github/workflows/ci.yml` (ALLOW_E2E_SEED=1 on seed step), `WORK/WORK_STATE.md`. Does NOT touch session M's new `scripts/ops-check.ts` or `package.json`. No prod DB edits (Sri owns those) |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — structural fix shipped `7715f68`: seed-e2e.ts refuses without ALLOW_E2E_SEED=1 (verified exit 1), CI e2e seed step sets it against its ephemeral DB only; backend typecheck clean. Re-planting is now blocked. |
| Blockers | OPEN — TWO SRI ACTIONS still required: (1) run the Option B rotation script (from chat) once against the prod DB to close the currently-open door — the code fix stops re-planting but does NOT change the creds already in prod; (2) confirm `NODE_ENV=production` in the Vercel backend project env (governs seed-boot guard, DB SSL, secure cookies). Until (1), owner@finder-pos.dev with the src/identity/service.ts:40 password still logs into the live site. |

## Parallel Non-Overlapping Claim (Codex session M - backend operational readiness)

| Field | Value |
|---|---|
| Agent/session | Codex session M |
| Queue item | Backend infra operational readiness: add a deploy/live-backend readiness check and documentation so real backend operations can be verified end to end without touching production demo credentials |
| Files/areas expected | `scripts/**` ops/readiness checker, `package.json` script wiring if needed, `WORK/WORK_STATE.md`, new audit note, `WORK/LOCK.md`. NO production DB data edits, NO identity/demo credential rotation, NO seed credential changes, NO frontend UI, NO business feature modules. |
| Started | 2026-07-05 01:23 CDT |
| Last update | 2026-07-05 01:43 CDT |
| Status | RELEASED - shipped in `4a72ae5`; added `npm run ops:check`, deployed-backend ops gate wiring, production-safe metrics behavior, default deployed-frontend CORS allowance, and `PG_SSL` override. Gates: backend typecheck PASS, ops/metrics tests PASS 4/4, local production-mode ops check PASS 6/6, focused settings PASS 20/20, backend suite PASS 329/329, smoke PASS 15/15, frontend typecheck/lint/test/build PASS. |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session L - business impact preview)

| Field | Value |
|---|---|
| Agent/session | Codex session L |
| Queue item | Retail-first queue item #2: read-only business-type/module impact preview for setup/settings/demo switchers before applying changes |
| Files/areas expected | `src/modules/settings/service.ts`, `src/modules/settings/routes.ts`, `src/modules/settings/settings.test.ts`, `src/app.ts` for top-level alias, WORK evidence only. NO frontend UI rewrite, NO e2e specs, NO unrelated domain feature work. |
| Started | 2026-07-04 15:45 CDT |
| Last update | 2026-07-05 01:21 CDT |
| Status | RELEASED - shipped in `c7b84b5`; read-only `GET /api/v1/capabilities/impact` plus `GET /api/v1/settings/capabilities/impact` now preview business-type/module deltas before applying settings. Gates: backend typecheck PASS, focused settings suite PASS 20/20, backend suite PASS 327/327, smoke PASS 15/15, frontend typecheck/lint/test PASS, frontend `NEXT_PUBLIC_MOCK=false` build PASS. |
| Blockers | none |

## Released Claim (session E — capabilities-driven shell + Business Profile settings)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" directive from Sri) |
| Queue item | Retail-first queue item #3 (frontend consumption): consume `GET /api/v1/capabilities` on the frontend — shell/nav renders from tenant module enablement (four-layer check), Settings modes page becomes a capabilities-driven Business Profile / Plan & Modules view |
| Files/areas expected | `web/contexts/CapabilitiesContext.tsx` (new), `web/components/EnterpriseShell.tsx`, `web/app/(protected)/settings/modes/page.tsx`, `web/app/(protected)/layout.tsx`, `web/hooks/useModuleFlags.ts` (rewired onto capabilities, same signature), `web/mocks/mockHandlers.ts`, `web/api-client/types.ts`, `web/tests/capabilities.test.tsx` (new) |
| Started | 2026-07-04 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped in `3fa91e2`. Also fixed a real-backend nav bug: useModuleFlags read raw feature-flags and missed business-pack DEFAULTS, collapsing a fresh tenant's nav to core-only; capabilities is now the single authority. Business-type switching previews impact before applying. Gates: web tsc 0, Vitest 91/91, lint 4 pre-existing warnings, mock-off build green, backend tsc 0. See WORK/AUDIT_2026-07-05C.md |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session K - business capabilities endpoint)

| Field | Value |
|---|---|
| Agent/session | Codex session K |
| Queue item | Retail-first queue item #1: build the read-only capabilities endpoint that reports the current tenant's business type, enabled module pack, plan placeholder, and effective user access |
| Files/areas expected | `src/modules/settings/service.ts`, `src/modules/settings/routes.ts`, `src/modules/settings/settings.test.ts`, maybe `src/app.ts` for a top-level alias, WORK evidence only. NO frontend UI rewrite, NO e2e specs, NO product/catalog/order/payment feature changes. |
| Started | 2026-07-04 15:02 CDT |
| Last update | 2026-07-04 15:19 CDT |
| Status | RELEASED - shipped in `f919ffd`; read-only `GET /api/v1/capabilities` plus `GET /api/v1/settings/capabilities` now report effective business-pack/module/user/plan capability state. Gates: backend typecheck PASS, focused settings suite PASS 17/17, backend suite PASS 324/324, smoke PASS 15/15, frontend typecheck/lint/test PASS, frontend `NEXT_PUBLIC_MOCK=false` build PASS. |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session J - retail-first platform scope rewrite)

| Field | Value |
|---|---|
| Agent/session | Codex session J |
| Queue item | Documentation/planning rewrite: make retail the first complete business type, define demo business-type switcher and business-pack tracking rules for all future agents |
| Files/areas expected | `WORK/RULES.md`, `WORK/FORWARD_PLAN.md`, `WORK/WORK_STATE.md`, new audit note only. NO app code, NO backend modules, NO web pages, NO e2e specs. |
| Started | 2026-07-04 14:56 CDT |
| Last update | 2026-07-04 14:59 CDT |
| Status | RELEASED - shipped in `6f59580`; WORK rules/plan/state now mandate retail-first development, capabilities-driven setup/settings/demo switching, and no non-retail deepening until retail is Built and verified |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session I — production mock-off deploy guard)

| Field | Value |
|---|---|
| Agent/session | Codex session I |
| Queue item | Queue item #5 preparation: prevent production frontend deploys from silently shipping MSW mock mode now that core real-backend e2e is green |
| Files/areas expected | `scripts/deploy.sh`, `.github/workflows/deploy-prod.yml` if needed, WORK evidence only. NO `web/e2e/**`, NO app feature code, NO backend business modules. |
| Started | 2026-07-04 14:08 CDT |
| Last update | 2026-07-04 14:42 CDT |
| Status | RELEASED - shipped in `a90fbe4`; production deploy path now forces/refuses mock-off correctly, WORK scope corrected to modular business platform; gates: deploy script syntax PASS, prod mock guard refusal PASS, frontend prod build mock-off PASS, backend typecheck PASS, frontend typecheck/lint/test PASS, backend suite PASS 322/322 with `PG_TX_TIMEOUT_MS=120000` after local timeout contention |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — deploy pipeline Node fix + production deploy)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, "FIX AND DEPLOY" directive from Sri) |
| Queue item | deploy-prod.yml pins Node 20 while everything else uses .nvmrc (Node 24) — apiDownload blob test fails only under Node 20's FileReader, blocking the backend deploy. Fix + let the push trigger the production deploy (explicitly authorized by Sri) |
| Files/areas expected | `.github/workflows/deploy-prod.yml` ONLY. No src/**, no web/**, no e2e |
| Started | 2026-07-04 |
| Last update | 2026-07-04 |
| Status | RELEASED — shipped `ed5f861`; FIRST successful production deploy in this workflow's history (run 28716269968): verify green under Node 24, deploy.sh shipped both Vercel projects, live /healthz returns version=ed5f861 + builtAt (version stamp proven in prod), /readyz 200, frontend 200 |
| Blockers | none |

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

## Released Claim (e2e core-flow triage — RESOLVED by session E, conflict arbitrated by Sri)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app) — collision with Antigravity team resolved by Sri: "keep session E's work, merge theirs" |
| Queue item | #1 — Triage/fix 10 core-flow e2e failures (checkout ×3, inventory-receive ×3, invoice-pay ×3, logout ×1) |
| Status | RELEASED — **all 13 core specs PASS** against production build + real backend (login ×3, checkout ×3, inventory-receive ×3, invoice-pay ×3, setup). Went beyond spec-only fixes: 6 real product bugs fixed (hardcoded reg_01 register default, $NaN snake_case/camelCase drift across product/order/payment shapes, session-killing silentRefresh race, register-guard 409 stranding, missing page h1s, unlabeled user menu). See WORK/AUDIT_2026-07-04J.md |
| Blockers | none |

## Superseded Claim (Antigravity team — e2e core-flow triage)

| Field | Value |
|---|---|
| Agent/session | Antigravity session (VSCode), team of 3 teammates + lead |
| Queue item | #1 — same item as above (double-claim while session E's build appeared hung) |
| Status | SUPERSEDED — Sri chose to keep session E's implementation (spec-only scope could not fix the underlying product bugs). The team's pushed foundation work was merged and kept: `next.config.mjs` webpackBuildWorker fix (the actual cause of the build hangs) and the playwright setup storageState fix. Team may stand down from this item. |

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
