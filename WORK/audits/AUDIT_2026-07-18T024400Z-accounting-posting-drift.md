# Audit — accounting posting drift: refunds/returns/adjustments never post

Date: 2026-07-18
Session: Claude (Opus 4.8) — "harden a money path" (Sri-directed)
Branch: `harden/money-path-coverage`
Files (this fix): `src/modules/accounting/{index.ts,accounting.test.ts}`
Status label: refund posting now **Built and verified**; the rest below is
**Not production-ready** (silently unposted) and awaiting a directed fix.

## Finding (verified)

There are **two parallel journal implementations against the same table name**,
and only one has a schema behind it:

1. **Canonical, live, tested** — `AccountingService.postTransaction`
   (`src/modules/accounting/service.ts`) writes **leg rows** to `journal_entries`
   with the migrated columns `entry_group, doc_type, doc_id, account_code,
   account_name, debit_cents, credit_cents, memo, created_at`
   (`src/modules/accounting/index.ts:46`, the only `journal_entries` migration).
   Driven by module event handlers on `payment.captured`, `bill.created`,
   `bill.paid`, `purchase_order.received`. Covered by `accounting.test.ts`.

2. **Phantom, registered, dead** — `AccountingPostingWorkflow`
   (`src/orchestration/workflows/accounting-posting.workflow.ts`) writes a
   **header + lines** shape: `journal_entries(reference_id, reference_type,
   status, total_debit_cents, total_credit_cents)` plus a separate
   `journal_entry_lines` table. **Neither the `reference_id`/`total_*` columns
   nor `journal_entry_lines` exist in any migration** (`ORCHESTRATION_MIGRATIONS`
   only creates workflow-infra tables; grep of `db/` + `src/` finds no such
   `CREATE TABLE`). `reverse-ledger-entry.compensation.ts` reads the same
   non-existent columns.

The workflow **is** wired: `bootstrapOrchestration` (`src/app.ts:389`) registers
it (`orchestration/index.ts:152`) on the `accounting.entry_requested` trigger,
and the runner subscribes via `events.on(...).catch(log)`
(`workflow-runner.ts:44`). So every `accounting.entry_requested` posting throws
`relation "journal_entry_lines" does not exist` and is **silently swallowed** —
the operational flow survives, the ledger entry never lands. There is **no test
for this workflow** (confirmed: no test imports it).

### Per-event impact

`accounting.entry_requested` is the *only* posting path for these economic
events, and it has always failed → these have **never posted to the ledger**:

| Emitter | Event | Intended posting | Today |
|---|---|---|---|
| `refund.workflow.ts:202` | `refund` | Dr Revenue / Dr Tax / Cr Cash | **FIXED** (this change, via module handler) |
| `returns.workflow.ts:207` | `customer_return` | Dr COGS / Cr Inventory (+ credit) | **Not posted** |
| `stock-adjustment.workflow.ts:158` | `stock_adjustment` | Dr Shrinkage / Cr Inventory | **Not posted** |
| `payment-reconciliation.workflow.ts:146` | `payment_reconciliation` | Dr Cash / Dr Card Fees / Cr Revenue | **Not posted** |
| `checkout.workflow.ts:85` | `order` | Dr Cash / Cr Revenue / Cr Tax | Redundant — sale already posts via `payment.captured` module handler |
| `purchasing-receiving.workflow.ts:88` | `purchase_order` | Dr Inventory / Cr AP | Redundant — receipt already posts via `purchase_order.received` module handler |

Consequence: after any **refund, return, stock write-off, or card-settlement
reconciliation**, the offsetting entry was missing — cash/revenue/inventory
stayed overstated and the trial balance was skewed by exactly those amounts.
(Refund is the highest-frequency and is fixed here.)

## What was done (this change)

Refund posting only, in the accounting module's own boundary, mirroring the
proven `payment.captured` handler in reverse:

- `onBoth("order.refunded", …)` posts `Dr 4000 Revenue / Cr 1000 Cash` for the
  order total via the canonical `postTransaction` path (doc_type `pos_refund`,
  doc_id = order id). Idempotent per order via `hasPosting`; errors isolated by
  the same `post()` wrapper as the other four handlers.
- No double-post risk: nothing posted refunds before, and the redundant
  checkout/receiving overlaps were **not** touched (the dead workflow still does
  not run, so no new collision is introduced).

## Delivery standard

- **Architecture impact**: none new — reuses the existing domain-event →
  module-handler posting pattern. Deliberately did **not** revive the phantom
  workflow (that would double-post the checkout/receiving overlaps).
- **Database impact**: none — posts to the already-migrated `journal_entries`.
  No migration; both migration paths N/A.
- **Testing evidence**: 2 new tests (`accounting.test.ts`) — full sale→refund
  cycle nets cash+revenue to zero and keeps the trial balance balanced;
  duplicate `order.refunded` posts exactly one reversal. Both **fail on pre-fix
  code** ("refund posted … was 0") and pass after. Full suite **486/486** (was
  484). Typecheck + hygiene CLEAN.
- **Security impact**: none — internal event handler, no route/authz surface.
- **Rollback**: revert the single commit (additive handler + tests).
- **Monitoring**: none new. (A ledger-posting failure counter would surface this
  class of silent-swallow bug — see recommendation 3.)

## Recommendation (for Sri's direction — not done here)

1. **Retire the phantom path.** Remove `AccountingPostingWorkflow` registration
   and its `accounting.entry_requested` emitters (checkout, returns, stock-adj,
   reconciliation, purchasing-receiving) plus `reverse-ledger-entry.compensation`.
   It has never worked and its checkout/receiving legs duplicate live postings.
2. **Add the genuinely-missing postings** the same safe way this refund fix was
   done — module handlers on `customer_return`/return event, `stock.adjusted`,
   and the reconciliation settlement event, each idempotent via `hasPosting`,
   each with a sale/receipt-style regression test asserting trial-balance
   balance. One module-boundary PR per event keeps review surface small.
3. **Make silent ledger-swallow observable.** The `post()` wrapper and the
   workflow runner both log-and-continue on posting failure by design (a ledger
   error must not block operations) — but nothing counts or alerts on it, which
   is why this stayed invisible. Add a metric/alert on ledger-posting failures
   (ties into open critical C-4, alerting).
