# Ascend Autonomous Loop — State

Machine-updated by loop iterations per `WORK/LOOP_PROTOCOL.md`. Humans: edit
the backlog freely; the loop treats your edits as authoritative.

## Heartbeat

| Field | Value |
|---|---|
| loop_status | RUNNING |
| last_iteration_utc | 2026-07-16T03:47:00Z |
| runner | session D (local, VSCode) |
| branch | feat/delivery-pipeline (PR #66) |
| idle_streak | 0 |
| loop_commits | 10 (since run start 2026-07-15; pause + notify at ≥15) |
| cloud_watchdog | trig_01VVXryUgSBHoy9mAqRdhfzz (notify-only, every 3h, emails on ≥3h stale heartbeat) |

## Iteration log

| # | UTC | Commit | Summary |
|---|---|---|---|
| 1 | 2026-07-15T17:30Z | 3665437 | movements route drift (mock-only → real, prod panels were blank) + keyset pagination on inventory movements + audit_log cursor mode; 27/27, smoke 20/20 |
| 2 | 2026-07-15T17:40Z | c6eb35b | loop durability infra: LOOP_PROTOCOL.md (on-disk program, re-read each wake) + LOOP_STATE.md (heartbeat/backlog/counters) + cloud-watchdog contract + memory pointer |
| 3 | 2026-07-16T03:28Z | e535d7f | cloud watchdog live (trig_01VVXryUgSBHoy9mAqRdhfzz, notify-only, Gmail); protocol watchdog contract revised do-work→notify-only for financial-repo safety |
| 4 | 2026-07-16T03:47Z | (this) | route drift: customer-invoices/service-orders/product-batches mounted at underscore path → 404 in prod (mock-masked); added mountPath /api/v1 (store_locations convention) + mount test; removed 51 gitignored ` 2.` dupes blocking local tsc; 2/2 + smoke 20/20 |

## Backlog (loop-selectable, in priority order)

| Item | Status | Evidence / notes |
|---|---|---|
| Mock-vs-real drift sweep | DONE (iter 4, AUDIT_2026-07-16T034500Z) | Fixed 3 real 404s (customer-invoices/service-orders/product-batches → mountPath /api/v1). Remaining 16-candidate mismatches all benign: golf/pricing/warehouse/documents/promotions are Preview verticals (UI-only by design, NOT bugs per ae79907); audit-log/custom-roles have hyphenated name fields; store/product-locations served by store_locations mountPath; `things` is a JSDoc example |
| SSO/identity token-issuance consolidation (sso duplicates issueLoginSession insert) | BLOCKED — session C claim on sso/index.ts still ACTIVE | AUDIT_2026-07-15T163000Z note |
| Ledger/accounting unbounded list check (journal entries, reports) — cursor policy compliance | CANDIDATE (verify first) | CODING_STANDARDS pagination policy |
| requirePermission granularity on sync/webhook mutation routes | CANDIDATE (verify current guards first) | flagged in first API review triage |
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
