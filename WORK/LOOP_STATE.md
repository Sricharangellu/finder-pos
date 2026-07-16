# Ascend Autonomous Loop — State

Machine-updated by loop iterations per `WORK/LOOP_PROTOCOL.md`. Humans: edit
the backlog freely; the loop treats your edits as authoritative.

## Heartbeat

| Field | Value |
|---|---|
| loop_status | RUNNING (focus: INVENTORY subsystem hardening — Sri-directed 2026-07-16) |
| last_iteration_utc | 2026-07-16T12:10:00Z |
| runner | session D (local, VSCode) |
| branch | feat/delivery-pipeline (PR #70) |
| idle_streak | 0 |
| loop_commits | 5 (batch since PR #66 merge; pause + notify at ≥15) |
| focus | Inventory hardening. DONE: (1) oversell race, (2) transfer atomicity, (3) cycle-count double-close (adjustTx extraction + session FOR UPDATE). NEXT: transfer-number doc-counter (needs max-seeding), cross-transfer lock ordering, lots/expiry FEFO edges. |

### Why stopped
Four systematic verification sweeps complete, all retail-core modules:
1. Route drift (iters 1,4) — fixed 4 prod 404s.
2. Unbounded-list pagination (iters 1,5) — fixed movements/audit/journal.
3. Authorization (iters 6,7,8) — fixed sync/reports/ecommerce/notifications.
4. Tenant-scoping (iter 9) — **VERIFIED CLEAN, no cross-tenant leaks**: every
   literal `WHERE id=@id` mutation is gated by a prior `WHERE id AND tenant_id`
   verify (verify-then-mutate) or re-reads a just-created row; dynamic `${where}`
   builders include tenant_id; RLS backstop underneath.

No autonomous high-value work remains. Further progress = feature development
(needs Sri to choose scope) — the loop's explicit "needs Sri decision" stop.
**To resume:** `/loop` with a specific initiative, or merge PR #70 first.
| last_merge | 2026-07-16 PR #66 → master 29a27d7; prod deploy healthy, /readyz db:connected under C-3 cert verification |
| cloud_watchdog | trig_01VVXryUgSBHoy9mAqRdhfzz (notify-only, every 3h, emails on ≥3h stale heartbeat) |

## Iteration log

| # | UTC | Commit | Summary |
|---|---|---|---|
| 1 | 2026-07-15T17:30Z | 3665437 | movements route drift (mock-only → real, prod panels were blank) + keyset pagination on inventory movements + audit_log cursor mode; 27/27, smoke 20/20 |
| 2 | 2026-07-15T17:40Z | c6eb35b | loop durability infra: LOOP_PROTOCOL.md (on-disk program, re-read each wake) + LOOP_STATE.md (heartbeat/backlog/counters) + cloud-watchdog contract + memory pointer |
| 3 | 2026-07-16T03:28Z | e535d7f | cloud watchdog live (trig_01VVXryUgSBHoy9mAqRdhfzz, notify-only, Gmail); protocol watchdog contract revised do-work→notify-only for financial-repo safety |
| 4 | 2026-07-16T03:47Z | 867ead1 | route drift: customer-invoices/service-orders/product-batches mounted at underscore path → 404 in prod (mock-masked); added mountPath /api/v1 (store_locations convention) + mount test; removed 51 gitignored ` 2.` dupes blocking local tsc; 2/2 + smoke 20/20 |
| 5 | 2026-07-16T04:05Z | 09a0083 | ledger pagination: accounting.listJournal was bare LIMIT 500 on journal_entries (most append-heavy table) → deep audit history unreachable; added keyset cursor (additive {items,nextCursor,limit}); reports verified already-bounded aggregations; 19/19 + smoke 20/20 |
| 6 | 2026-07-16T04:25Z | 6ae6bb5 | sync authz gap: /online /push /pull /integrations had NO role guard (any cashier could toggle company sync / drain queue / connect integrations); added requireRole manager (ops) + owner (integrations, matches webhooks); webhooks verified already-guarded; 9/9 + smoke 20/20 |
| — | 2026-07-16T05:16Z | 29a27d7 | **PR #66 MERGED to master + deployed to prod** — /readyz db:connected under C-3 cert verification; 6 loop fixes live |
| 7 | 2026-07-16T05:45Z | 89b2e3b | module-wide authz sweep: reports POST /ar-aging/sweep (AR dunning mutation) + ecommerce PUT /products/:id/online (storefront publish) were unguarded → requireRole(manager); team verified guarded (in-handler requireManagement), orders/payments POS-by-design; 2 new 403 tests, reports 11/11 + ecommerce 9/9 + smoke 20/20 |
| 8 | 2026-07-16T06:00Z | 7ce3e6e | authz sweep completed: notifications POST / was unguarded (cashier could post spoofed notifications) → requireRole(manager); internal event-driven creation bypasses route (proven); first tests for the module; 2/2 + smoke 20/20. 3 sweeps (drift/pagination/authz) now exhausted — loop winding down |
| 9 | 2026-07-16T06:15Z | b89ae6b | tenant-scoping sweep across all service queries: VERIFIED CLEAN — no cross-tenant leaks (verify-then-mutate pattern is consistent; dynamic where-builders include tenant_id; RLS backstop). No fix needed. 4th sweep — loop stopped, then Sri redirected to INVENTORY |
| 10 | 2026-07-16T06:30Z | e3523b5 | INVENTORY: stock-adjust oversell race — adjust() was read-modify-write, concurrent sales lost updates (10 −6 −6 → 4 not 0). Added FOR UPDATE (matches FEFO path) + ON CONFLICT upsert. Deterministic concurrency test (2nd connection, lock barrier) — VERIFIED fails without fix. 25/25 inventory + smoke 20/20 |
| 11 | 2026-07-16T11:50Z | caedd71 | INVENTORY: transfer atomicity — createTransfer moved stock via 3 independent statements (2 separate adjustStock txns + INSERT); failure between legs lost stock. Extracted adjustStockTx(tdb) (+FOR UPDATE), wrapped whole transfer in ONE tx. Atomicity test (INT_MAX overflow forces 2nd-leg failure) — VERIFIED fails without fix (source lost 5). 27/27 + smoke 20/20 |
| 12 | 2026-07-16T12:10Z | (this) | INVENTORY: cycle-count double-close — closeCycleCount checked open→applied variances→closed non-atomically; 2 concurrent closes double-posted variance (−3 → −6). Extracted adjustTx(tdb) from adjust(), wrapped close in ONE tx with session FOR UPDATE (2nd close 409s). Deterministic barrier test (3rd conn holds inventory lock) — VERIFIED fails without fix (double-posted → 4). 29/29 + smoke 20/20 |

## Backlog (loop-selectable, in priority order)

| Item | Status | Evidence / notes |
|---|---|---|
| Mock-vs-real drift sweep | DONE (iter 4, AUDIT_2026-07-16T034500Z) | Fixed 3 real 404s (customer-invoices/service-orders/product-batches → mountPath /api/v1). Remaining 16-candidate mismatches all benign: golf/pricing/warehouse/documents/promotions are Preview verticals (UI-only by design, NOT bugs per ae79907); audit-log/custom-roles have hyphenated name fields; store/product-locations served by store_locations mountPath; `things` is a JSDoc example |
| SSO/identity token-issuance consolidation (sso duplicates issueLoginSession insert) | BLOCKED — session C claim on sso/index.ts still ACTIVE | AUDIT_2026-07-15T163000Z note |
| Ledger/accounting unbounded list check | DONE (iter 5, AUDIT_2026-07-16T040500Z) | journal_entries listJournal → keyset cursor; reports verified already-bounded (GROUP BY/top-N aggregations, not row lists) |
| requirePermission granularity on sync/webhook mutation routes | DONE (iter 6, AUDIT_2026-07-16T042500Z) | sync mutations were UNGUARDED → added requireRole manager/owner; webhooks verified already owner-guarded (no gap) |
| Web client adoption of error.details for field-level form errors | CANDIDATE (low priority) | shared/http.ts details added fd2dd2a |
| PROJECT_STATUS.md stale internal refs cleanup | CANDIDATE (low, docs-only) | orchestration/README.md notes the ROADMAP retirement |

## NEEDS-SRI (out of loop scope — decisions/actions only Sri can take)

| Item | What's needed |
|---|---|
| C-3 deploy note | Confirm prod DB cert chain (or set PG_CA_CERT / PG_SSL_NO_VERIFY) BEFORE merging PR #66 |
| C-2 completion | Confirm CRON_SECRET set in Vercel env |
| C-1 restore drill | Run a backup-restore drill against real infra |
| C-4 completion | Pick alert fan-out channel (Slack/PagerDuty/Sentry); heartbeat workflow is the floor |
| OIDC PKCE + nonce | IdP-compatibility decision |
| PR #66 merge | Review + merge (= production deploy) |
| Cloud watchdog mode | Currently NOTIFY-ONLY (emails on stall). Optional upgrade to DO-WORK mode (cloud runs one iteration autonomously on stall) — true unattended continuity, but unreviewed cloud commits to financial code. Enable only if wanted. Routine: trig_01VVXryUgSBHoy9mAqRdhfzz |
