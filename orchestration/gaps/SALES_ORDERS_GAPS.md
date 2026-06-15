# Sales / Orders / Billing — gap notes

**Source:** the 2026-06-15 "Complete Enterprise Architecture Assessment".
Inspiration only — see `ROADMAP.md`'s framing note.

Updated: 2026-06-15.

## Where Finder's sales workflow stands today

- `src/modules/sales`: full Quote → Sales Order (approval, picker
  assignment) → Invoice flow (`/quotations/*`, `/sales-orders/*`), plus
  per-product tier pricing (Wave A, done).
- `src/modules/customers`: `tier`, `company`, `dba`, `tax_id`, `license_no`,
  and a financial summary (`dueCents` = open AR, `excessCents`,
  `storeCreditCents`). **No `creditLimit` field and no enforcement** —
  the assessment's "credit limit enforcement" gap is real.
- `src/modules/billing`: AP/AR bills/invoices with aging (BE-3 in progress
  adds sales-by-rep/vendor pivots + P&L).

## Curated gaps (assessment → verdict for Finder)

| Gap | Verdict |
|---|---|
| Customer credit limit + order-hold when exceeded | **Worth building.** Add `credit_limit_cents` to customers (nullable = no limit). On SO/invoice creation, if `dueCents + new total > credit_limit_cents`, reject (409) unless the actor is `manager`/`owner` (who can override). |
| Backorder management / partial shipment | **Defer** — depends on inventory reservation (`INVENTORY_GAPS.md` BE-9) landing first; revisit once `available` is real. |
| Quote approval workflow, quote→SO→invoice | **Already covered** (Wave A). |
| Order amendment audit trail | **Mostly covered** by the existing `audit_log` (every mutating route is logged); a per-order "history" view is a read-only query, low priority. |
| Customer portal, subscription/recurring orders, EDI order ingestion | **Out of scope** — large new surfaces with no current tenant demand. |
| Delivery scheduling/route planning, commission calculation automation | **Out of scope for sales module** — commission *reporting* exists (Module 10); automation/route planning belongs with `FULFILLMENT_SHIPPING_GAPS.md` if pursued at all. |
| Trade promotion management, consignment sales | **Out of scope** — overlaps with `DISCOUNTS_GAPS.md`'s scope decisions; not pursued there either. |

## What this turns into on the roadmap

- **BE-13** — Customer credit limit: add `credit_limit_cents` (nullable) to
  `customers`; enforce on `POST /sales-orders` and `POST /invoices`
  (409 `credit_limit_exceeded` for `cashier`, allowed with a logged override
  for `manager`/`owner`). Surface `creditLimitCents` +
  `creditAvailableCents` in the customer financial summary.
- **FE-10** — Show credit-limit/available-credit on the customer detail
  panel and a blocking (or override) warning on SO/invoice creation when
  exceeded, consuming BE-13.

Everything else above is explicitly **not** on the roadmap unless a future
need justifies it.
