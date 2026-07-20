# Audit — Phase 0 Full Verification Pass (`npm run verify`, module-by-module status)

Date: 2026-07-19T062148Z
Session: Claude (Cowork, Fable 5)
Branch: `feat/delivery-pipeline` (local, 21 commits ahead of `origin/feat/delivery-pipeline`; PR #70)
Status label: **Verification only — no application code changed.** (One genuine
sandbox-environment issue was found and worked around, not an application bug;
see §2. No regressions found; no fixes required this pass.)

Purpose: this is the closing verification pass for `WORK/FORWARD_PLAN.md`
Phase 0 ("finish end-to-end, close the gap to deployment-ready"). Every step
below was actually executed in this sandbox, with real counts recorded as they
came off the terminal — not summarized from memory or assumed from prior
sessions' notes.

## 1. `npm run verify` — real numbers, step by step

`npm run verify` = `hygiene && gap:scan && typecheck && test && smoke &&
(cd web && typecheck && lint && build)`. The full chain cannot run in one shot
in this sandbox (single tool calls cap out around 40-45s and the ~300+ backend
tests against real embedded Postgres take far longer than that in aggregate),
so each stage was run to completion across many calls, batched by test file
where needed. Every one of the 78 backend `*.test.ts` files was run — none
sampled or skipped.

| Step | Result | Evidence |
|---|---|---|
| `npm run hygiene` | **PASS** | "1032 files scanned; no junk, tracked env, conflict markers, secrets, or broken doc links" |
| `npm run gap:scan` | **PASS** | "444 backend paths, 373 frontend paths, 21 allowlisted — no unexplained frontend→backend gaps" (allowlist unchanged from the last Phase-0 wave; see §4 for what's on it) |
| `npm run typecheck` (backend, `tsc -p tsconfig.json --noEmit`) | **PASS** | 0 errors |
| Backend test suite (`tsx --test` over all 78 `src/**/*.test.ts` files, real embedded Postgres per run) | **601 / 601 tests passed, 0 failed** | Run in ~35 batches (by directory/file, some individual heavy files split further by `--test-name-pattern` to fit the sandbox's per-call time cap); every file in `find src -name "*.test.ts"` accounted for — see the full file list in §1a |
| `npm run smoke` (`scripts/smoke.ts`, self-contained: boots its own embedded Postgres + real HTTP server) | **PASS — 20/20 steps** | Full POS lifecycle: login, taxable + tax-exempt product, receive stock, offline order, tax calc (CA, exempt beans correctly untaxed), split payment, offline outbox (33 events queued, then drained on reconnect), refund + restock, `/metrics` RED metrics present, zero failed workflow instances, full audit trail (`order.created`/`payment.captured`/`order.refunded`/register open+close), register open → cash sale → Z-report close with an intentional $2.50 overage correctly reconciled |
| `cd web && npm run typecheck` | **PASS** | 0 errors (separate `tsconfig`, not skipped) |
| `cd web && npm run lint` (`next lint`) | **PASS, 0 errors** | 4 pre-existing warnings only (`react-hooks/exhaustive-deps` in `documents/_components/{AllDocumentsTab,ByTypeTab}.tsx`, `components/terminal/{OfflineQueueBanner,TenderScreen}.tsx`) — none touched this session, none new, no errors |
| `cd web && npm run build` (`next build`) | **NOT COMPLETED — sandbox limitation, see §2** | `typecheck` and `lint` (both of which passed) are the parts of the frontend pipeline that don't require a single long-running process; the actual `next build` compile could not be observed to completion in this environment |

### 1a. Backend test files — the full list, all run

`app.staging.test.ts`, `app.tick.test.ts`, `shared/db-ssl.test.ts`,
`gateway/{auth,cors,metrics,ops,rateLimit,tenant-isolation}.test.ts`,
`identity/{identity,lockout,neutralize-demo,signup-provision}.test.ts`,
`modules/accounting/accounting.test.ts`, `modules/appointments/appointments.test.ts`,
`modules/audit_log/audit-pagination.test.ts`, `modules/automotive/automotive.test.ts`,
`modules/billing/billing.test.ts`, `modules/business/business.test.ts`,
`modules/catalog/{catalog,detail-views}.test.ts`, `modules/custom_roles/custom_roles.test.ts`,
`modules/customer_invoices/route-mount.test.ts`, `modules/customers/customers.test.ts`,
`modules/discounts/discounts.test.ts`, `modules/ecommerce/ecommerce.test.ts`,
`modules/education/education.test.ts`, `modules/entertainment/entertainment.test.ts`,
`modules/expenses/expenses.test.ts`, `modules/fulfillment/fulfillment.test.ts`,
`modules/giftcards/giftcards.test.ts`, `modules/healthcare/healthcare.test.ts`,
`modules/hospitality/hospitality.test.ts`, `modules/insights/{health-scores,insights}.test.ts`,
`modules/inventory/{concurrency,cycle-count-close,expiry,inventory,movements-pagination,pipeline-views,transfer-atomicity}.test.ts`,
`modules/manufacturing/manufacturing.test.ts`, `modules/monitoring/monitoring.test.ts`,
`modules/notifications/{notifications-authz,settings}.test.ts`,
`modules/orders/{lifecycle,orders,tax}.test.ts`, `modules/outlets/outlets.test.ts`,
`modules/payments/{payments,webhook}.test.ts`, `modules/permission_requests/permission-requests.test.ts`,
`modules/progress/progress.test.ts`, `modules/purchasing/{edi-imports,purchasing}.test.ts`,
`modules/rental/rental.test.ts`, `modules/reports/reports.test.ts`,
`modules/restaurant/restaurant.test.ts`, `modules/sales/sales.test.ts`,
`modules/search/search.test.ts`, `modules/serial_numbers/serial-numbers.test.ts`,
`modules/settings/settings.test.ts`, `modules/shipping/{delivery-pipeline,shipping}.test.ts`,
`modules/sso/{sso,sso-security}.test.ts`, `modules/sync/sync.test.ts`,
`modules/team/team.test.ts`, `modules/webhooks/webhooks.test.ts`,
`modules/workflows/{approval-chains,run-history,workflows}.test.ts`,
`modules/workforce/workforce.test.ts`,
`orchestration/tests/{checkout,order-fulfillment,purchasing-receiving,refund}.workflow.test.ts`.

## 2. Genuine sandbox limitations found (not code bugs)

**(a) Frontend production build could not be completed in this sandbox.**
`next build` for this app (a large multi-vertical Next.js 14 app, ~150+
routes) takes longer to reach "Creating an optimized production build..."
completion than a single tool call in this environment allows (~40-45s hard
cap per call). Four separate attempts were made, including one after warming
the webpack persistent cache to 533MB from a prior attempt — none completed
within the cap. Backgrounding the process (`nohup ... & disown`) was tried and
confirmed **not viable**: a trivial `sleep 120` backgrounded the same way was
independently verified dead (no such process) by the very next tool call,
proving this sandbox tears down background processes between calls rather
than only being slow. This is a sandbox architecture constraint, not a code
problem: `typecheck` and `lint` (the parts of the same pipeline that don't
need one long-lived process) both passed clean, and the documented CI build
recipe (`.github/workflows/ci.yml`, "Build frontend" step) needs only
`NEXT_PUBLIC_MOCK=false` + `BACKEND_URL` set — no missing secret or
configuration is blocking it. **Recommendation:** run `cd web && npm run
build` in CI or a real dev machine to get final confirmation; nothing found
in this session gives reason to expect it would fail there.

**(b) A misleading mid-run test failure batch, traced to disk space, not code.**
One batch (`sales.test.ts` + `search.test.ts` + `serial_numbers.test.ts`)
initially reported 13 failures, all with the same underlying Postgres error:
`could not extend file "base/16384/...": wrote only 4096 of 8192 bytes at
block 0` (Postgres error code `53100`, disk full). Investigation found the
sandbox's `$TMPDIR` (`/sessions/.../tmp`, a small ~9.8GB volume, separate from
`/tmp` on the root filesystem) had accumulated **~9GB across 28 orphaned
embedded-Postgres data directories** — leftovers from earlier batches in this
same session where the outer `timeout 40` killed the test-runner process
before `pg.stop()` could finish its own cleanup, leaving the throwaway
`embedded-postgres` data directory behind each time. After `rm -rf
.../tmp/finderpg-*` (freeing the volume back to 1% used), the exact same
batch was rerun immediately and passed clean, 22/22 — proving the failures
were a disk-space artifact of this specific test-harness pattern in this
sandbox, not an application defect. Cleaned up after every subsequent batch
for the rest of this run to prevent recurrence. **Worth carrying forward**:
any future session running the embedded-Postgres test harness in this sandbox
should periodically `rm -rf $TMPDIR/finderpg-*` between batches, especially
if using a hard `timeout` wrapper that can kill the harness before its own
graceful shutdown completes.

No other environment issues were found. No application code was changed in
this session — every gate that could be run to completion passed clean on
the first true attempt (after the disk-space artifact above was understood
and cleared).

## 3. Module-by-module status

Labels used are exactly the seven required: `Built and verified` / `Built but
not verified` / `UI-only` / `Mocked` / `Partial` / `Planned` / `Not
production-ready`. Covers every module in `src/modules/index.ts`'s `modules`
array (51 modules), based on what the test suite and `gap:scan` actually
prove — not assumption — for modules not touched this session.

| Module | Label | Basis |
|---|---|---|
| sequences | Built and verified | No dedicated test file, but exercised transitively by every other module's tests (PO numbers, order numbers, etc.) plus a dedicated race-free-counter test in `purchasing.test.ts` |
| catalog | Built and verified | `catalog.test.ts` (54 tests) + `detail-views.test.ts` (20 tests), all passing. One deliberate exception: `/catalog/:id/credits` is NEEDS-SRI (no backing concept in the schema), left allowlisted |
| serial_numbers | Built and verified | `serial-numbers.test.ts`, 3/3 passing; mount-order bug fixed in a prior session |
| inventory | Built and verified (core); Partial (pipeline surface) | Core stock/receive/adjust/transfer/cycle-count/expiry: 7 test files, 42 tests, all passing, including deterministic concurrency/atomicity proofs. Pipeline `pending/history/reorder-alerts` built and tested (4 tests). Pipeline `receiving/issues/errors/summary` are NEEDS-SRI — no subsystem exists to back them (see §4) |
| orders | Built and verified | `lifecycle`, `orders`, `tax` test files, 39 tests, all passing; includes the derived timeline endpoint |
| payments | Built and verified | `payments.test.ts` + `webhook.test.ts`, 20 tests, all passing |
| sync | Built and verified | `sync.test.ts`, part of a 20-test batch, all passing |
| customers | Built and verified | `customers.test.ts`, incl. search + transactional merge, all passing |
| giftcards | Built and verified | `giftcards.test.ts`, passing |
| webhooks | Built and verified | `webhooks.test.ts`, 10/10 passing |
| team | Built and verified | `team.test.ts`, incl. time-clock in/out, permission overrides, passing |
| custom_roles | Partial | Backend CRUD tested and passing (`custom_roles.test.ts`), but the frontend permissions page speaks a different vocabulary (`{name,color,features}` + bulk `/settings/permissions`) than the backend (`{name,permissions}` fixed vocabulary) — NEEDS-SRI, unresolved contract mismatch, allowlisted |
| outlets | Built and verified | `outlets.test.ts`, incl. register open/close/Z-report, passing; also exercised end-to-end by `smoke.ts` |
| purchasing | Built and verified (core); Partial (EDI) | `purchasing.test.ts` (22 tests: POs, receiving, approvals, requisitions, cost-entry) all passing. `edi-imports.test.ts` (16 tests) passing, but `/process` is an honest state-machine transition, not real file parsing — the frontend never uploads file bytes (NEEDS-SRI, see §4) |
| billing | Built and verified | Part of a 14-test passing batch |
| fulfillment | Built and verified | `fulfillment.test.ts`, passing |
| sales | Built and verified | `sales.test.ts`, quotation/sales-order lifecycle, passing |
| accounting | Built and verified | `accounting.test.ts`, 19/19 passing, incl. outbox crash-recovery and keyset journal pagination |
| shipping | Built and verified | `shipping.test.ts` + `delivery-pipeline.test.ts`, 21 tests, passing |
| discounts | Built and verified | Part of a 15-test passing batch |
| settings | Partial | `settings.test.ts` (23 tests) passing for the parts it covers, but `/settings/b2b` and `/settings/permissions` have no backend at all (allowlisted, NEEDS-SRI alongside custom_roles) |
| search | Built and verified | `search.test.ts`, 12 tests (product/customer/vendor search, type filters, case-insensitivity), passing |
| ecommerce | Partial | Admin-side catalog/order sync tested and passing (`ecommerce.test.ts`); storefront customer auth (`/ecommerce/auth/*`) has no backend — deliberately gated as a labeled Preview in the UI, not silently mocked |
| reports | Built and verified | `reports.test.ts`, 11/11 passing, incl. real COGS-based gross profit and retail-readiness signals |
| insights | Built and verified | `health-scores.test.ts` + `insights.test.ts`, passing |
| workflows | Partial | `approval-chains.test.ts` + `run-history.test.ts` + `workflows.test.ts` (24 tests) all passing — both new tables are real, persisted, and tested — but nothing in the codebase invokes them yet: no POS/refund/discount/vendor-create action checks a chain or logs a run (NEEDS-SRI, see §4) |
| sso | Built and verified | `sso.test.ts` + `sso-security.test.ts`, 20 tests, passing |
| monitoring | Built and verified | Part of a 22-test passing batch |
| quotes | Built but not verified | Real service code (213 lines), mounted, gap-scan clean, exercised indirectly via customers/orders satellite repointing in the merge flow, but no dedicated test file of its own |
| notifications | Built and verified | `notifications-authz.test.ts` + `settings.test.ts`, passing; digest/preferences/rules built this Phase-0 effort |
| audit_log | Built and verified | `audit-pagination.test.ts`, passing; catalog + register lifecycle both proven to write real audit entries via `smoke.ts` |
| loyalty | Built but not verified | Real service code (532 lines), mounted, gap-scan clean, no dedicated test file; referenced by customers-merge (`points/store-credit` addition) |
| rls | Built and verified | No dedicated `rls` module test, but `gateway/tenant-isolation.test.ts` proves the RLS backstop end-to-end (including a fresh assertion against a table created this Phase-0 effort, `notification_alert_rules`) |
| store_locations | Built but not verified | Real service code (360 lines), mounted, gap-scan clean, no dedicated test file |
| permission_requests | Built and verified | `permission-requests.test.ts`, passing |
| product_batches | Built but not verified | Real service code (290 lines), mounted, gap-scan clean, no dedicated test file |
| customer_invoices | Built but not verified | Only `route-mount.test.ts` exists (proves the mount-path fix, not full CRUD depth) |
| service_orders | Built but not verified | Real service code (245 lines), mounted, gap-scan clean, no dedicated test file |
| workforce | Built but not verified | `workforce.test.ts` has 1 test; real service code exists and is mounted, but coverage is thin |
| restaurant | Built but not verified | `restaurant.test.ts` has 2 tests, both regression proofs for the double-prefix bug fix (tables + bar tabs reachability) — not full business-logic coverage |
| appointments | Built but not verified | 1 test (business-pack access gating); real service code exists and is mounted |
| healthcare | Built but not verified | Thin test coverage; real service code exists and is mounted |
| automotive | Built but not verified | Part of a shared batch; real service code exists and is mounted, but coverage is not deep |
| hospitality | Built but not verified | Thin test coverage; real service code exists and is mounted |
| manufacturing | Built but not verified | Thin test coverage; real service code exists and is mounted |
| rental | Built but not verified | 2 tests (business-pack gating); real service code exists and is mounted |
| entertainment | Built but not verified | Part of a shared batch; real service code exists and is mounted |
| education | Built but not verified | Part of a shared batch; real service code exists and is mounted |
| expenses | Built but not verified | Part of a shared batch; real service code exists and is mounted; referenced by `reports.test.ts`'s profit-visibility proofs |
| progress | Built but not verified | Part of a shared batch; thin coverage |
| business | Built but not verified | Part of a shared batch; real service code exists and is mounted |

Preview verticals with **no backend module at all** (not in `modules/index.ts`,
correctly out of scope, UI-only by design per `ae79907`): golf, pricing,
warehouse, documents, promotions. These remain `UI-only` and are not part of
the table above because they aren't registered modules.

## 4. Direct answer: is Ascend working end-to-end for a real customer, and is it deployment-ready?

**Working end-to-end for a real customer: yes, for the retail core.** The
smoke test proves the full path a retail cashier actually needs — login,
product creation (with correct tax classing), stock receipt, an offline sale
with correct tax computation, split cash/card payment capture, offline outbox
queuing and drain-on-reconnect, refund with inventory restock, a full
auditable trail, and a register open → sell → close → Z-report cycle with an
exact cash-variance reconciliation — against a real Postgres database, not
mocks. That is not a demo; it is the same code path a production deployment
would run. 601 backend tests covering 51 registered modules back this up, and
`gap:scan` proves the frontend and backend agree on every route surface it
checks (444 backend paths, 373 frontend paths, only 21 explicitly
board-tracked exceptions).

**Deployment-ready as a serious production SaaS product: not fully — the
remaining gaps are known, named, and mostly not code-addressable from a
sandbox.** Specifically:

- The frontend production build was not verified to completion in this
  session (sandbox limitation, §2a) — it needs to be run once in CI or a real
  machine before shipping, though there is no code-level reason to expect it
  to fail (typecheck and lint both pass clean).
- Several vertical business packs (restaurant, appointments, healthcare,
  automotive, hospitality, manufacturing, rental, entertainment, education,
  business, progress, workforce) and several supporting modules (quotes,
  loyalty, store_locations, product_batches, service_orders,
  customer_invoices) have real, mounted, gap-scan-clean backend code but thin
  or no dedicated test coverage — they are not proven broken, but they are
  not proven correct either, which matters more for POS/inventory/payments
  software than for most other categories of app.
- A short list of features are deliberately unbuilt pending a **product
  decision, not more plumbing** (see the NEEDS-SRI list below) — building
  them without that decision would mean inventing product behavior nobody
  asked for.
- A separate list of items requires **real infrastructure access Sri has and
  this sandbox does not** (Redis, Vercel env, cert chains, a real backup
  drill) — those are operational readiness gaps, not code gaps.

In short: the shared retail operating engine is real, tested, and proven
end-to-end today. The path to "every business pack is production-grade" and
"the operational checklist is fully green" still has open items, and this
audit names all of them rather than rounding up to "done."

## 5. NEEDS-SRI — real blockers to full production-readiness

Distinguishing code-addressable-but-deferred (a product decision away from
being plumbing work) from needs-real-infra (not code-addressable from any
sandbox at all):

### Product decisions needed (code-addressable once decided — not built here on purpose)

| Item | What's needed |
|---|---|
| Catalog credits (`/catalog/:id/credits`) | No backing concept exists anywhere in the schema (AR credit memo? something else?) — needs a definition before it can be built |
| Inventory pipeline: Receiving tab | Implies a stateful "receiving session" (start → progressively scan → track a receiver/batch_id) that doesn't exist; today `receive()` is one atomic call |
| Inventory pipeline: Issues + Errors tabs | GET+PATCH only in the FE, no POST anywhere — implies an unbuilt detection engine (sku_mapping, price_mismatch, duplicate_doc, edi_parse categories that nothing computes today) |
| Inventory pipeline: Overview/Summary funnel | The FE's 9-stage funnel doesn't map onto the real 4-value `POStatus` enum; needs a schema/status-model decision or FE simplification |
| Custom-roles / permissions-page contract | FE speaks `{name,color,features}` + bulk `/settings/permissions`; backend speaks `{name,permissions}` from a fixed vocabulary, no color. Needs a single permission model decided |
| Settings `/settings/b2b` | No backend at all; needs a decision on what B2B settings actually configure |
| Ecommerce storefront customer auth | Gated as Preview in the UI (`NEXT_PUBLIC_STORE_AUTH_ENABLED=1` re-enables); needs a real customer-auth backend built when prioritized |
| Real EDI parsing (purchasing `/process`) | The frontend upload form never sends file bytes today, so there is nothing to parse; needs (a) a frontend fix to actually upload file bytes and (b) a choice of parser/format (real X12/EDIFACT library vs. a defined CSV-only subset) |
| Approval chains / run-history triggering-event wiring | Both tables are real and tested, but nothing invokes them; needs a decision on which real action (price override above X%? refund above $Y? new vendor? discount above Z%?) should check a chain and what happens while a transaction awaits approval |
| MFA / device-verification | **Not a gap** — MFA itself is a real implementation (TOTP, backup codes, enforced in the login flow). The narrower `/login/device-verification` and `/login/security-alert` mock pages are labeled Preview and unreachable from the real login flow; building a real device/security-event pipeline is a genuine new feature needing decisions on triggers and blocking behavior — same class as the items above |

### Real infrastructure/access needed (not code-addressable from any sandbox)

| Item | What's needed |
|---|---|
| Redis provisioning | Shared-instance rate limiting currently falls back to in-memory (per-replica) limits without it |
| Backup/restore drill | Needs to be run against real production infrastructure |
| Vercel environment variables | `CRON_SECRET` and related config need to be set in the real deployment environment |
| Production DB certificate chain | Needs verification against the real production Postgres before merging PR #66/#70 |
| Alert fan-out channel | Pick Slack/PagerDuty/Sentry; the heartbeat workflow is the current floor |
| OIDC PKCE + nonce | IdP-compatibility decision requiring the actual identity provider config |
| `feat/clean-arch-pilot-quotes` merge | Lives only on a separate branch; needs review/merge as a real repo-management action |
| PR #70 merge | Review + merge = production deploy — a real decision/action, not a code task |
| Cloud watchdog mode | Currently notify-only; upgrading to do-work mode is an explicit choice given the risk of unreviewed commits to financial code |
| Frontend production build final confirmation | Run `cd web && npm run build` once in CI or a real dev machine (§2a) — no code reason to expect failure, but not verified to completion in this sandbox |

## 6. Bottom line

No genuine application bugs were found this session — everything that could
be run to completion in this sandbox passed clean on real evidence: hygiene,
gap:scan, backend typecheck, all 601 backend tests across all 78 test files,
the 20-step Postgres-backed smoke test, and the frontend's typecheck and
lint. The one hiccup (13 apparent test failures) was traced to the sandbox's
own disk filling up with orphaned embedded-Postgres directories, not a code
defect, and resolved by cleanup plus a clean rerun. The frontend production
build itself could not be observed to completion due to a hard architectural
limit of this sandbox (no persistent background processes across tool
calls, confirmed empirically), not a code or configuration problem.
