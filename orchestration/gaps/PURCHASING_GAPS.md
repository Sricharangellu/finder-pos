# Purchasing — gap notes

**Source:** the 2026-06-15 "Complete Enterprise Architecture Assessment".
Inspiration only — see `ROADMAP.md`'s framing note.

Updated: 2026-06-15.

## Where Ascend's purchasing stands today

- `src/modules/purchasing`: suppliers/vendors, POs with lot/expiry lines,
  `POST /orders/:id/receive` (posts `inventory_movements`, creates lots,
  auto-drafts an AP bill via `billing`), `vendor_credits`
  (chargeback/credit_memo), `vendor_returns`.
- The assessment's "no receiving module / no GRN" and "no AP posting"
  findings do **not** apply — both exist and are wired to inventory +
  billing.

## Curated gaps (assessment → verdict for Ascend)

| Gap | Verdict |
|---|---|
| Partial receiving / partial PO closure | **Worth building.** Today `receive` likely assumes full-line receipt. Add a `quantity` per line to `receive` so a PO can be received in multiple shipments; PO status becomes `partially_received` until all lines are fully received. |
| Three-way match (PO qty vs received qty vs vendor invoice) | **Worth a light version**, building on partial receiving: when the auto-drafted bill's total differs from `sum(receivedQty * unitCost)`, flag the bill `variance` (boolean + amount) instead of silently accepting it. Full approval workflow is out of scope. |
| Purchase Requisition + PO approval routing | **Defer.** Ascend has one role above cashier (`manager`/`owner`); a requisition→approval chain is multi-level-org complexity most tenants won't need yet. If requested, start with a single `requireRole("manager")` gate on PO creation (already a 1-line addition under BE-1's RBAC pass). |
| Vendor price list management, lead-time tracking, vendor performance scoring | **Defer** — `purchasing.suppliers` would need a price-list sub-resource; revisit once a tenant has >1 vendor per SKU (ties to catalog's `preferred_vendor_id`, already shipped in BE-6). |
| Return to vendor (RTV) workflow | **Already covered** — `vendor_returns` exists. |
| Blanket POs, drop-ship routing, EDI 850/855/856 | **Out of scope** — EDI in particular is a large integration surface with no current tenant need. |
| Early payment discount capture, vendor credit management | Vendor credits already exist; **early-payment discount is a small addition** — fold into the existing bill record (`discount_pct` if paid before `discount_date`), compute on `pay`. Low priority. |

## What this turns into on the roadmap

- **BE-11** — Partial PO receiving: `POST /orders/:id/receive` accepts a
  `quantity` per line (≤ remaining), PO status tracks
  `open → partially_received → received`; repeatable until fully received.
- **BE-12** — Bill variance flag: when an auto-drafted bill's total ≠
  `sum(receivedQty * unitCost)` across all receives for that PO, set
  `bills.variance_cents` (signed) and surface it in `GET /billing/bills`.

Everything else above is explicitly **not** on the roadmap unless a future
need justifies it.
