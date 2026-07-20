# Accounting / Finance — gap notes

**Source:** the 2026-06-15 "Complete Enterprise Architecture Assessment".
Inspiration only — see `ROADMAP.md`'s framing note.

Updated: 2026-06-15.

## Where Ascend's accounting stands today

- `src/modules/accounting`: Chart of Accounts (tree, seedable), batch
  deposits with approve/reject.
- `src/modules/billing`: bills (AP) and invoices (AR), with `ar-aging` /
  `ap-aging` reports (`src/modules/reports`).
- `src/modules/customers` / `src/modules/purchasing`: store credit and
  vendor credit ledgers already exist.
- No double-entry **journal/GL** — every financial fact lives in its owning
  module's table (bills, invoices, deposits, vendor/store credits) and the
  COA is currently a labeling tree, not a ledger.

## Curated gaps (assessment → verdict for Ascend)

| Gap | Verdict |
|---|---|
| Double-entry journal entries / General Ledger / Trial Balance | **Defer — big.** This is the single largest item in the whole assessment. A real GL would mean every existing module (sales, purchasing, billing, payments, inventory adjustments) posts journal lines, which is a cross-cutting redesign, not a module gap. Don't start this opportunistically; if pursued, it needs its own wave with an ADR (per `00_EXECUTION_PROMPT_BOOK.md`'s contract-change protocol, now archived but the principle holds — propose via `contracts/`). |
| Full P&L / Balance Sheet / Cash Flow Statement | **Blocked on GL above.** BE-3 (in progress) already adds a *product-profit* P&L from existing sales/cost data — that's the achievable subset without a GL. |
| AR dunning (automated overdue reminders) | **Worth building**, and doesn't need a GL: `ar-aging` already identifies overdue invoices. Add a scheduled check that flags invoices `> N days` overdue and emits an `invoice.overdue` event (webhooks module can notify). |
| AP payment scheduling / early-payment discounts | Early-payment discount covered in `PURCHASING_GAPS.md`. Payment *scheduling* (a calendar of upcoming due bills) is a read-only view over existing `ap-aging` data — low effort, low priority. |
| Bank reconciliation, multi-currency, 1099 vendor mgmt, payroll, fixed assets/depreciation, budget vs actual | **Out of scope** — each is a substantial standalone domain with no current tenant need; multi-currency in particular would touch the integer-cents convention everywhere. |
| Financial period close workflow | **Defer until GL exists** — "closing the books" only means something once there's a ledger to close. |

## What this turns into on the roadmap

- **BE-14** — AR dunning: a scheduled/triggered check
  (`POST /api/v1/reports/ar-aging/sweep` or reuse of the existing aging
  query) that, for invoices `> 30/60/90` days overdue, sets
  `invoices.dunning_level` and emits `invoice.overdue` (consumed by
  `webhooks`). No UI required initially — `ar-aging` already surfaces the
  buckets.

GL/Balance Sheet/Cash Flow are explicitly **not** roadmap items — they're
flagged here as a known major gap requiring a dedicated design pass, not
something a single dev cycle should pick up piecemeal.
