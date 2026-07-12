# Ascend — Multi-Agent Work Lock

Status: IDLE — no active claim

## Released Claim (Claude session A — link AR invoice to sales order + surface in delivery)

| Field | Value |
|---|---|
| Agent/session | Claude session A (Opus 4.8, "next" → complete invoices part of the pipeline) |
| Queue item | Link the auto-raised AR invoice back to its sales order: add `invoices.sales_order_id`, set it when billing raises an invoice from `sales_order.invoiced`, add a `?salesOrderId=` list filter. Surface invoice status on the `/delivery` panel and add a "Create invoice" action when the SO is approved but not yet invoiced. Extend billing + sales + web; no new module. |
| Files/areas expected | `src/modules/billing/{index,service,routes}.ts`, billing test; `web/app/(protected)/delivery/page.tsx`, `web/api-client/types.ts`; WORK audit + this LOCK. NO db canonical DDL rewrite beyond idempotent ALTERs. |
| Started | 2026-07-12 |
| Last update | 2026-07-12 |
| Status | RELEASED — built_verified (backend), built-not-verified (web panel). AR invoice raised from a sales order is now linked (`invoices.sales_order_id`) and surfaced on the `/delivery` panel with a Create-invoice action. Gates: backend typecheck / test 388/388 / smoke 20/20 / hygiene; web typecheck / lint / build (/delivery emitted). Audit: `WORK/audits/AUDIT_2026-07-12T064225Z-invoice-sales-order-link.md`. Committed on `feat/delivery-pipeline`. |
| Blockers | none |

## Released Claim (Claude session A — delivery pipeline connect-the-seams)

| Field | Value |
|---|---|
| Agent/session | Claude session A (Opus 4.8, user feature: retail order / invoices / sales orders (ecommerce) / delivery pipelines) |
| Queue item | Connect the delivery pipeline for sales orders (incl. ecommerce): add `sales_orders.fulfillment_status`; make fulfillment build pick-lists from sales orders and, on pack, flip SO→packed + emit `sales_order.packed`; make shipping sales-order-aware (nullable invoice_id + sales_order_id), auto-create a shipment on `sales_order.packed`, and propagate ship/deliver back to the SO. Add a web delivery-pipeline page. Extend existing modules; split across commits (backend then frontend). |
| Files/areas expected | `src/modules/sales/{index,service,routes}.ts`, `src/modules/fulfillment/{index,service,routes}.ts`, `src/modules/shipping/{index,service,routes}.ts`, tests in those modules; `web/app/(protected)/**` delivery pipeline page + api-client; WORK audit + this LOCK. NO db/ canonical DDL rewrite beyond idempotent ALTERs, NO unrelated modules. |
| Started | 2026-07-12 |
| Last update | 2026-07-12 |
| Status | RELEASED — built_verified (backend), built-not-verified (web page). Sales/ecommerce orders now flow order → pick → pack → ship → deliver with fulfillment_status propagation; `/delivery` web page drives it. Gates: backend typecheck / test 389/389 / smoke 20/20 / hygiene; web typecheck / lint / build. Audit: `WORK/audits/AUDIT_2026-07-12T062801Z-delivery-pipeline.md`. |
| Blockers | none |

## Released Claim (Codex session P — retail progress truth tracking)

| Field | Value |
|---|---|
| Agent/session | Codex session P |
| Queue item | Implement the missing "Tracking Reality" backend slice from the retail-first plan: hypotheses, tasks, evidence, decisions, honest status transitions, and system verification from real retail-proof data. Extend existing code only; do not duplicate retail-proof or expenses modules. |
| Files/areas expected | NEW `src/modules/progress/{index,service,routes,progress.test,test-request}.ts`; `src/modules/index.ts` registration; WORK evidence/audit. NO web, NO settings, NO reports, NO expenses, NO CI. |
| Started | 2026-07-06 |
| Last update | 2026-07-06 |
| Status | RELEASED — built_verified: new progress backend module with hypotheses, tasks, evidence, decisions, honest status transitions, and tenant-data system verification. Gates: focused progress 3/3, backend typecheck PASS, backend suite 354/354 PASS, smoke 20/20 PASS, hygiene PASS, web typecheck/lint/test/build PASS. |
| Blockers | none |

## Released Claim (session E — profit visibility metrics)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "continue" — FORWARD_PLAN queue #4) |
| Queue item | Add profit visibility: retail-proof reports gross profit only and DISCLAIMS expenses (queue #3 now built). Wire expenses into retail-proof — expensesCents, netProfitCents (revenue-COGS-expenses), grossMarginPct, netMarginPct; flip expenses to available:true with real total + uncategorizedCount; add deterministic profit signals (negative_net_profit, uncategorized_expenses). |
| Files/areas expected | src/modules/reports/service.ts (retailProof), src/modules/reports/reports.test.ts. NO new module, NO web, single isolated test runs |
| Started | 2026-07-06 |
| Last update | 2026-07-06 |
| Status | RELEASED — shipped: retail-proof now reports net profit (revenue−COGS−expenses), gross/net margins (null-safe), real expense totals + uncategorizedCount, and deterministic profit signals (negative_net_profit critical, uncategorized_expenses info). Gates: reports 6/6 real Postgres, backend tsc 0, smoke 20/20. Audit: WORK/audits/AUDIT_2026-07-06T14:36:26Z-profit-visibility-metrics.md. |
| Blockers | none |

## Released Claim (session E — expenses MVP backend module)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" — FORWARD_PLAN queue #3) |
| Queue item | Complete expenses MVP (backend): the "Record expenses" step of the retail flow has no backend (only chart-of-accounts expense *accounts* exist; no way to record a spend). New expenses module — table (tenant_id, category nullable, amount_cents, spent_at, vendor, note, account_id, created_by, created_at), POST create (validated, manager+, audit-logged), GET list (filters), GET summary (total, by-category, uncategorized count), DELETE (manager+, audit). Integer cents, tenant-scoped, tenant-isolated. Frontend wiring is a follow-up. |
| Files/areas expected | NEW src/modules/expenses/{index,service,routes,expenses.test}.ts; src/modules/index.ts (register). NO reports/retail-proof edits (separate follow-up), NO web, NO accounting module edits, no ports. SINGLE isolated test runs only (tooling-incident discipline) |
| Started | 2026-07-06 |
| Last update | 2026-07-06 |
| Status | RELEASED — shipped: new expenses module (POST/GET/summary/:id/DELETE; manager+, integer cents, audit-logged, tenant-scoped). Gates: expenses suite 3/3 real Postgres, backend tsc 0, smoke 20/20. Follow-ups: frontend page + feed retail-proof/dashboard. |
| Blockers | none |

## Released Claim (session E — retail proof audit endpoint)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" — FORWARD_PLAN queue #2) |
| Queue item | Build the retail-proof audit endpoint: GET /api/v1/reports/retail-proof — a real-data readiness report answering the operating prompt's retailer questions (what I sell / in stock / sold / made / low-slow-profitable-risky / what next). Backend authority for: the 7 setup tasks (outlet/register/tax/paymentModes/receipt/firstProduct/firstReceiving — currently detected client-side), retail metrics (product count, products without cost, low/out-of-stock, orders, revenue, COGS, gross profit, products never sold), and DETERMINISTIC rule-based signals (per the AI/Recommendations rule: missing setup, no cost, low stock, no recent sales, etc.). Expenses noted as unbuilt (queue #3). Tenant-scoped, read-only, in the reports module. |
| Files/areas expected | `src/modules/reports/service.ts` (retailProof method), `src/modules/reports/routes.ts` (route), `src/modules/reports/reports.test.ts` (real-Postgres test), WORK evidence. NO web, NO new tables, NO catalog/orders/settings module edits, no ports |
| Started | 2026-07-06 |
| Last update | 2026-07-06 |
| Status | RELEASED — shipped in `65df42c`: GET /api/v1/reports/retail-proof (setup tasks + metrics + deterministic rule-based signals; expenses unbuilt). Gates: reports 5/5 real Postgres, backend tsc 0, smoke 20/20. INCIDENT during verify (working-tree src deletion in the SECOND clone during concurrent full-suite runs; recovered via reset to clean origin, re-applied, re-verified) — see WORK_STATE + audit. |
| Blockers | none |

## Released Claim (session E — auth route drift: /api/v1/auth/* -> real identity paths)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" — route-alignment queue) |
| Queue item | Fix the wiring-matrix auth/* REAL DRIFT. (1) PermissionsContext calls GET /api/v1/auth/me which 404s on the real backend → catch keeps role="owner" for EVERY user (privilege bug) and fails open to all features. Point at real GET /api/identity/me (returns role); owner/admin/manager → all features, others fail-open (documented — real /me exposes no per-user feature list; capabilities is the module authority). (2) SecuritySection fires a no-op POST /api/v1/auth/backup-codes with no backend (missing) — remove the dead 404 call; codes are client-generated only, documented as missing-backend. Add mock /api/identity/me for parity. |
| Files/areas expected | `web/contexts/PermissionsContext.tsx`, `web/app/(protected)/settings/_components/SecuritySection.tsx`, `web/mocks/handlers.ts` or `mockHandlers.ts` (me parity), vitest. NO backend module build (backup-codes backend is separate future work), no file moves |
| Started | 2026-07-06 |
| Last update | 2026-07-06 |
| Status | RELEASED — shipped in `708f914`: PermissionsContext reads real /api/identity/me (was /api/v1/auth/me → 404 → every user role=owner privilege bug); owner/admin/manager→all, custom roles→granted features. SecuritySection dead backup-codes 404 call removed (missing backend, documented). Mock /api/identity/me added, dead /api/v1/auth/me mock removed. Gates: web tsc 0, Vitest 102/102 (2 new), lint 4 pre-existing, mock-off build. Audit: WORK/audits/AUDIT_2026-07-06T073723Z-auth-route-drift.md |
| Blockers | none |

## Released Claim (session E — NEXT_PUBLIC_SHOW_PARTIAL_PAGES gating)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" from Sri — first FORWARD_PLAN queue item: frontend/backend route alignment) |
| Queue item | Operating-prompt "Mock And Partial Rules": partial/mock-backed pages must stay hidden from nav unless NEXT_PUBLIC_SHOW_PARTIAL_PAGES=true. Flag has ZERO implementation. Mark the wiring-matrix partial pages (Pricing, Promotions, Warehouse, Document Center) as partial in the shell nav and hide them in production unless the flag is set. (Golf already pack-gated for retail; permission-requests now has a real backend via session A.) |
| Files/areas expected | `web/components/EnterpriseShell.tsx` (nav partial marker + gate), new vitest. NO backend, NO page deletion, NO file moves, no ports |
| Started | 2026-07-06 |
| Last update | 2026-07-06 |
| Status | RELEASED — shipped in `4c79378`: partial pages (Pricing, Promotions, Warehouse, Document Center) hidden from nav unless NEXT_PUBLIC_SHOW_PARTIAL_PAGES=true; pure exported isNavChildVisible() gate. Gates: web tsc 0, Vitest 100/100 (4 new), lint 4 pre-existing, mock-off build green. Audit: WORK/audits/AUDIT_2026-07-06T072347Z-partial-page-gating.md |
| Blockers | none |

## Released Claim (session E — persist Sri's Agent Operating Prompt as authoritative AGENTS.md)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "save this operating prompt" from Sri) |
| Queue item | Save Sri's Agent Operating Prompt (2026-07-06) as the authoritative operating contract in AGENTS.md (the one agent file), preserving the concrete operational reference (lock mechanics, git modes, local runbook, handoff) as an appendix. Resolve conflicts in favor of the new prompt (status-label vocabulary built_verified/…/missing; read order). DO NOT delete RULES.md/WORK_STATE.md (in-flight sessions read them) — flag their consolidation as the pending exclusive-lock restructure. Also update cross-session memory. |
| Files/areas expected | `AGENTS.md` ONLY (docs). NO src, NO web, NO RULES.md/WORK_STATE.md deletion. No overlap with any code work |
| Started | 2026-07-06 |
| Last update | 2026-07-06 |
| Status | RELEASED — shipped in `8620650`: Sri's 2026-07-06 Agent Operating Prompt saved verbatim as the authoritative Operating Contract in AGENTS.md (+ Operational Reference appendix; CLAUDE.md trimmed to pointer). Adopts new status labels (built_verified/…/missing) + read order. RULES.md/WORK_STATE.md NOT deleted (in-flight sessions read them) — their removal is the pending Foundation Hardening exclusive-lock restructure. Docs only. |
| Blockers | none |

## Released Claim (session E — §4 dedup: single feature-gating authority)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" from Sri) |
| Queue item | Foundation Hardening §4 slice ("feature gating should have ONE source, not three"): `useAccountMode` fires a redundant `/settings/feature-flags` fetch on every protected page to derive accountMode + edition flags that `GET /capabilities` ALREADY returns (features.accountMode + group flags). Nothing calls `useAccountMode()` at runtime (only its type is imported), so rewire its provider to derive from `useCapabilities()` — same public API — dropping the duplicate fetch and making capabilities the single gating authority. NOT a file-move restructure (the big §4 needs Sri's OK first). |
| Files/areas expected | `web/lib/useAccountMode.tsx` (rewire onto capabilities), `web/contexts/CapabilitiesContext.tsx` if a getter is needed, new/updated vitest. NO backend, NO file moves, NO e2e, no ports, no concurrent next build |
| Started | 2026-07-06 |
| Last update | 2026-07-06 |
| Status | RELEASED — shipped in `e994d0a`: useAccountMode now derives accountMode + edition flags from useCapabilities() (no separate /settings/feature-flags fetch); one fewer gating authority + one fewer per-page request. Mock /capabilities gains accountMode+group flags for parity. Gates: web tsc 0, Vitest 96/96 (2 new), lint 4 pre-existing, mock-off build green. Larger §4 file-move restructure still needs Sri's OK (see below). |
| Blockers | none |

## Released Claim (session E — persist verified prod findings to standing surface)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "add required data to shared file" from Sri) |
| Queue item | Persist re-verified open production actions into the agent-followed surface so no session loses them: add a standing "Open Production Actions (Sri only)" block to WORK/WORK_STATE.md. Re-verified 2026-07-06: demo creds now 401 (RESOLVED); finder-pos.vercel.app still 500 (orphaned Vercel project outside CI — deployed frontend is finder-pos-frontend.vercel.app). |
| Files/areas expected | `WORK/WORK_STATE.md` ONLY (docs). NO src, NO web, NO scripts — no overlap with session A's permission_requests module |
| Started | 2026-07-06 |
| Last update | 2026-07-06 |
| Status | RELEASED — shipped in `8460d72`: standing "Open Production Actions (Sri only)" block at the top of WORK/WORK_STATE.md, re-verified live 2026-07-06 (demo creds now 401 = RESOLVED; finder-pos.vercel.app still 500 = orphaned project, open). Also saved to cross-session memory. Docs only. |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — permission-requests backend + auth fix)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, "build/fix what's required" from wiring matrix) |
| Queue item | Close the RBAC wiring gap: build the real `permission-requests` backend module (was UI+mock only, 404 on real backend) matching the mock contract — list/create/get/approve/reject/revoke + permission_overrides, tenant-scoped, RBAC-guarded, audit-logged, mounted at `/api/v1/permission-requests` via mountPath. Plus fix the stale `/api/v1/auth/login` JSDoc comment. DEFER (documented, not half-built): full Promotion Engine (large feature expansion) + MFA backup-codes (needs login-flow consumption). |
| Files/areas expected | NEW `src/modules/permission_requests/{index,service,routes,permission-requests.test}.ts`; `src/modules/index.ts` (register); `web/app/login/page.tsx` (comment only). NO other web app pages, NO settings module, NO promotions |
| Started | 2026-07-06 |
| Last update | 2026-07-06 |
| Status | RELEASED — shipped in `d81cc14`: real permission_requests backend module (2 tables, 6 endpoints, mounted at /api/v1/permission-requests via mountPath, tenant-scoped + RBAC + audit + state-machine). Focused suite 3/3, backend typecheck clean, smoke 20/20. Auth login JSDoc comment fixed. DEFERRED (documented in wiring-matrix audit, not half-built): full Promotion Engine + MFA backup-codes. |
| Blockers | none |

## EXCLUSIVE Claim (session A — Foundation Hardening initiative) — RELEASED

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, Sri: "do as u recommend" → run WORK/FOUNDATION_HARDENING.md) |
| Queue item | Execute the whole-repo Foundation Hardening initiative (`WORK/FOUNDATION_HARDENING.md`). Board was clear before claiming. |
| Files/areas expected | Whole tree (exclusive). |
| Started | 2026-07-05 |
| Last update | 2026-07-06 |
| Status | RELEASED — §1–§3 DONE: cleanup (`0c7a736`), governance archive + collision-proof audit naming (`098bbf7`), wiring matrix (`eb3b236`, 46/54 wired). §4 structural restructure DEFERRED to Sri (mass file-moves need a plan sign-off; the spec requires it). See `WORK/FOUNDATION_HARDENING.md` progress log + `WORK/WORK_STATE.md`. Board FREE — other sessions may resume. |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — persist foundation-hardening initiative)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | Persist Sri's foundation-hardening / cleanup / end-to-end-wiring spec into the canonical docs so it can be executed later as a SINGLE EXCLUSIVE claim when the board is clear (running it now would collide with parallel sessions). New `WORK/FOUNDATION_HARDENING.md` (verbatim spec + how-to-run), referenced from `WORK/FORWARD_PLAN.md` (queued initiative) and `AGENTS.md` (marching orders). Docs only — NOT executing the restructure. |
| Files/areas expected | `WORK/FOUNDATION_HARDENING.md` (new), `WORK/FORWARD_PLAN.md` (add pointer), `AGENTS.md` (add pointer). No src/web/scripts |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped `088f633`: `WORK/FOUNDATION_HARDENING.md` holds the verbatim spec + how-to-run (single exclusive claim when board clear); referenced from FORWARD_PLAN.md + AGENTS.md marching orders. Initiative is QUEUED, not started. |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — production demo-account neutralization)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, Sri authorized prod security work) |
| Queue item | Close the live demo-credentials exposure autonomously. Confirmed NODE_ENV=production active (Secure cookies), and demo login still works on prod. DATABASE_URL is Vercel-"sensitive" (unreadable) so a manual rotation isn't possible from here. Fix: a production-only boot guard in identity that detects seeded demo accounts still carrying the PUBLISHED password (bcrypt.compare) and scrambles their hash to a random value — self-healing, idempotent, no external DB URL, pairs with the seed guards. Closes the hole on next deploy. Only runs in production (test/CI/dev demo login unaffected). |
| Files/areas expected | `src/identity/service.ts` (new neutralize method), `src/identity/index.ts` (call after seedDemo), new focused test. Identity module only — board free. NO settings/web/scripts |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped `51e7449`: production boot scrambles demo accounts still carrying the published password. 3/3 tests, smoke 20/20, typecheck clean. Takes effect on next production deploy; live login re-verified after deploy (see WORK_STATE). The demo-credentials queue item is now fully closed autonomously — seed guards prevent re-planting, boot guard neutralizes already-planted. NODE_ENV=production confirmed active (Secure cookies). |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — store_locations top-level mount fix)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, "do what's best" directive) |
| Queue item | Real retail-core connection bug (runtime-verified): inventory/locations page calls `/api/v1/product-locations` + `/api/v1/store-locations` (404 on real backend, works only via mock) but the store_locations module serves those routes at `/api/v1/store_locations/...`. The route names are already top-level resource names → intended top-level. Fix: add optional `mountPath` to PosModule; store_locations mounts at `/api/v1` so its routes resolve where the frontend + mocks already expect. Additive (default mount unchanged for all other modules). |
| Files/areas expected | `src/modules/types.ts` (optional mountPath field), `src/app.ts` (honor mountPath in module loop), `src/modules/store_locations/index.ts` (set mountPath). Backend only. NO `web/**` (frontend + mocks already correct), NO settings module (other sessions) |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped `ae79907`: PosModule.mountPath (default unchanged); store_locations → `/api/v1`. Runtime-verified /api/v1/product-locations + store-locations + /map now 200 (were 404), core endpoints uncollided, smoke 20/20, typecheck clean. Retail-core inventory/locations page now works against the real backend, not just mocks. REMAINING connection gaps (runtime-confirmed, documented for future items): `/api/v1/promotions/*` real gap (full promotions UI, backend has `discounts` instead — Promotion Engine domain); `/warehouse` `/pricing` `/golf` `/documents` are expected Preview verticals / unbuilt domains per RULES.md (UI-only by design until their phase — NOT bugs). |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — anti-duplication guardrail)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode, "make sure this doesn't happen again" directive) |
| Queue item | Structural prevention so the recurring duplicate-file / multi-checkout collision mess cannot recur: (1) `.gitignore` the export/copy junk pattern (`* 2.*`, `*.collision-backup.md`) so it never gets tracked or clutters `git status`/blocks rebases; (2) CI `guard` job fails on any tracked duplicate-suffix / collision-backup file; (3) AGENTS.md gains a concise repo-hygiene + single-canonical-checkout rule (use `git worktree`, never a second clone). Works ONLY in this checkout (finder-pos), per Sri. |
| Files/areas expected | `.gitignore`, `.github/workflows/ci.yml` (append to existing guard job), `AGENTS.md` (additive section). No `src/**`, no `web/**`, no other WORK docs |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped `b257f9a`: `.gitignore` blocks `* N.<ext>` copy junk + `*.collision-backup.md`; CI guard fails on any tracked duplicate/backup file and on >1 AGENTS.md; AGENTS.md documents one-agent-file / one-plan / one-canonical-checkout (git worktree, never a second clone). Verified: check-ignore blocks a sample, guard catches a force-add, passes clean, YAML valid. HANDOFF TO SRI: consolidate to ONE checkout — the divergent `finder-pos-github` clone should be abandoned (or its unpushed consolidation pulled here then deleted); use git worktree for future parallelism. |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — Stripe webhook verification test)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | RULES.md pre-production gate "Stripe/webhook behavior must be verified before production" has ZERO coverage. The `/api/stripe/webhook` endpoint (app.ts:91) does signature verification but nothing tests it. New test proves: valid Stripe-signed payload → 200 + internal event published; bad/missing signature → 400; STRIPE_WEBHOOK_SECRET unset → 503. Uses Stripe's generateTestHeaderString (local HMAC, no network). |
| Files/areas expected | `src/modules/payments/webhook.test.ts` (NEW file only). No source edits (session E on `src/modules/settings/**`), no `scripts/**`, no `.github/**`, no `web/**` |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped `af1b7f1`: 4/4 on real Postgres. Proves valid signature → 200 + verified event on internal bus, bad sig → 400, missing sig → 400, no secret → 503 (fails closed). RULES.md "Stripe/webhook behavior verified" gate now has coverage. NOTE for all sessions: this push also carried another session's local-only e2e commit (`94013a1`) that was sitting uncommitted/committed in the shared checkout, and resolved an AUDIT_2026-07-05G filename collision (session E's kept at G; e2e session's content re-filed at AUDIT_2026-07-05H.md). Reminder: two sessions must not pick the same AUDIT_YYYY-MM-DD<letter> name. |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — signup provisioning + isolation test)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | Verification gap: nothing proves a fresh signup (`POST /api/identity/register`) yields a working, isolated retail tenant. `tenant.registered` has no listener — provisioning is lazy read-time default. New integration test: register → new tenant → GET /capabilities returns retail (source=default) → owner can create outlet+product → cross-tenant isolation (new tenant cannot see demo data). Honest verification; no behavior change. |
| Files/areas expected | `src/identity/signup-provision.test.ts` (NEW file only). No source edits (session E active on `src/modules/settings/**` + web), no `scripts/**`, no `.github/**`, no `web/**` |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped `3f669be`: 3/3 on real Postgres. Proves fresh signup → owner + retail-default capabilities → owner can operate their tenant → two independently-registered tenants are isolated (no cross-tenant reads; by-id fetch 404/403). First coverage of the signup provisioning path + tenant isolation from signup. FINDING (not a bug, documented): `tenant.registered` has no listener; business type is lazy read-time default, not provisioned/audited at signup — a future item could persist+audit the initial retail assignment per RULES.md. |
| Blockers | none |

## Released Claim (session E — business-profile change contract + audit history)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" directive from Sri) |
| Queue item | Retail-first Settings requirement ("last business-type/module changes with actor and timestamp") + real drift bug: real `POST /settings/business-profile` requires businessType and ignores `moduleFlags`, so the Business Profile page's per-module toggles only work against the mock (400 on real backend) and a type switch resets ALL manual overrides. Fix: accept optional `moduleFlags` delta updates (businessType optional when toggling), write audit_log rows for business-type/module changes with real actor ids, and show a Recent Changes section on the Business Profile page reading GET /audit-log |
| Files/areas expected | `src/modules/settings/routes.ts`, `src/modules/settings/settings.test.ts`, `web/app/(protected)/settings/modes/page.tsx` (Recent changes section), `web/mocks/mockHandlers.ts` (parity), WORK evidence. NO `scripts/**`, NO `.github/**`, NO e2e, no ports, no concurrent `next build` |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped in `d03ca08`: moduleFlags delta + enabledModules explicit-set + businessType bundle-reset shapes (empty body 400); business_profile.type_changed/.modules_changed audit rows with real actor ids; Recent Changes section on the Business Profile page with mock parity. Gates: focused settings 23/23, backend suite 332/332, smoke 20/20, backend+web tsc 0, Vitest 94/94, lint 4 pre-existing, mock-off build green. See WORK/AUDIT_2026-07-05G.md |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session O - retail-first E2E gate alignment)

| Field | Value |
|---|---|
| Agent/session | Codex session O |
| Queue item | Fix the red CI Playwright E2E gate after backend ops readiness: align stale vertical/onboarding E2E assertions with the current retail-first product scope, without touching backend infra or product UI behavior. Non-retail packs are Preview until retail is complete; tests must not claim every vertical page is production-ready. |
| Files/areas expected | `web/e2e/**`, `WORK/WORK_STATE.md`, new audit note, `WORK/LOCK.md`. NO backend source changes, NO production DB edits, NO scripts, NO app feature/UI implementation outside e2e evidence unless the E2E evidence proves a real retail/core UI bug. Avoid session E's active files: `src/modules/settings/routes.ts`, `src/modules/settings/settings.test.ts`, `web/app/(protected)/settings/modes/page.tsx`, `web/mocks/mockHandlers.ts`. |
| Started | 2026-07-05 02:20 CDT |
| Last update | 2026-07-05 18:05 CDT |
| Status | RELEASED - shipped `5372b82` plus follow-up `94013a1`; Playwright vertical coverage now matches the retail-first scope, authenticated E2E navigation recovers from retry/login redirects, and the module marketplace switch test no longer clicks disabled controls. Verification: frontend typecheck PASS, frontend lint PASS with existing hook warnings, `git diff --check` PASS, Playwright test discovery PASS (26 tests). Full browser proof is the next GitHub CI run. |
| Blockers | none |

## Released Claim (session E — retail setup checklist + honest onboarding)

| Field | Value |
|---|---|
| Agent/session | Claude session E (desktop app, "next" directive from Sri) |
| Queue item | Retail-first queue item (plan "Signup and setup" requirements): (a) retail setup checklist with LIVE completion detection — outlet, register, tax rate, payment modes, receipt, first product, first receiving — surfaced on the dashboard until complete, each task deep-linking to its setup page; (b) onboarding wizard renders business types from the capabilities registry instead of its hardcoded 13-vertical list, marking retail as the completed pack and all others as Preview ("Setup must not present every vertical as equally complete") |
| Files/areas expected | `web/components/setup/RetailSetupChecklist.tsx` (new), `web/app/(protected)/dashboard/page.tsx` (mount card), `web/app/(protected)/onboarding/page.tsx`, new vitest file. NO backend changes, NO `web/e2e/**`, NO `scripts/**` (session A active there), NO `.github/**` (Codex N active there), no ports, no concurrent `next build` |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped in `7cca4df`: dashboard retail setup checklist with live completion detection (7 tasks, fails closed, deep links, dismissible, auto-hides) + onboarding business types rendered from the capabilities registry with retail badged Ready and all other packs badged Preview (amber notice on confirm). Gates: web tsc 0, Vitest 94/94, lint 4 pre-existing warnings, mock-off build green, backend tsc 0. See WORK/AUDIT_2026-07-05E.md |
| Blockers | none |

## Parallel Non-Overlapping Claim (session A — smoke register→EOD coverage)

| Field | Value |
|---|---|
| Agent/session | Claude session A (VSCode) |
| Queue item | Retail golden-path verification gap: `scripts/smoke.ts` exercises login→product→receive→order→payment→refund→audit but NOT the register lifecycle. RULES.md core flow includes "open register → close register → end-of-day report". Extend smoke to open a register, run a cash sale through it, close it counting the drawer, GET /reports/end-of-day, assert the Z-report reconciles + register.session_opened/closed audit rows exist — proving that segment against the real assembled app. |
| Files/areas expected | `scripts/smoke.ts` ONLY. NOT `.github/workflows/ci.yml` (Codex session N active there — different "smoke": the CI post-deploy HTTP check). No `web/**`, no other src, no `scripts/ops-check.ts` |
| Started | 2026-07-05 |
| Last update | 2026-07-05 |
| Status | RELEASED — shipped `3a03fb9`: smoke now 20 steps, adds register open→cash sale→close→EOD Z-report reconciliation (exact variance +$2.50) + register audit assertions. The core retail "close register → end-of-day report" segment is now proven against the assembled app on every CI push. Verified green on real Postgres, typecheck clean. |
| Blockers | none |

## Parallel Non-Overlapping Claim (Codex session N - production smoke auth alignment)

| Field | Value |
|---|---|
| Agent/session | Codex session N |
| Queue item | Fix red post-deploy smoke after session M: `/api/v1/flags` is intentionally authenticated in production, so CI must assert 401 auth-boundary behavior instead of expecting public 200 |
| Files/areas expected | `.github/workflows/ci.yml`, `WORK/WORK_STATE.md`, new audit note, `WORK/LOCK.md`. NO backend source changes, NO seed scripts, NO production DB edits, NO frontend UI. |
| Started | 2026-07-05 01:52 CDT |
| Last update | 2026-07-05 01:55 CDT |
| Status | RELEASED - shipped in `64fdc78`; post-deploy smoke now asserts unauthenticated `/api/v1/flags` returns 401 instead of expecting public 200. Verification: live flags auth-boundary curl PASS (`401`), `git diff --check` PASS. |
| Blockers | none |

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
