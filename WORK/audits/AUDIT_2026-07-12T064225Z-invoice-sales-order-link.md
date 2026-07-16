# Audit — Link AR invoice to sales order + surface in delivery

Date: 2026-07-12T06:42:25Z
Session: Claude session A (Opus 4.8, "next" → complete the invoices part of the pipeline)
Status label: **Built and verified** (backend); **Built but not verified** (web panel — compiles, no e2e yet)

## Context

Follows `AUDIT_2026-07-12T062801Z-delivery-pipeline.md`. That slice connected
order → pick → pack → ship → deliver, but the **invoice** (one of the four areas the
user asked for) was raised blind: `sales_order.invoiced` → billing created an AR invoice
with only customer + total, **no link back to the sales order**, so it was invisible from
the order and the new delivery UI. This slice closes that.

## What changed

### Backend — invoice ↔ sales order link
- `invoices.sales_order_id` (nullable) + partial index (`WHERE sales_order_id IS NOT NULL`).
- `BillingService.createInvoice` accepts `salesOrderId` and stores it; `Invoice` type carries it.
- The `sales_order.invoiced` handler now passes `salesOrderId` from the event payload, so the
  auto-raised AR invoice is linked to the order that produced it.
- `listInvoices` + `GET /api/v1/billing/invoices?salesOrderId=` filter to fetch an order's invoice.
- Retail/manual invoice paths unchanged (`sales_order_id` defaults to null).

### Frontend — billing on the delivery panel
- `/delivery` panel now loads the linked invoice for the selected order and shows a
  billing row: invoice number + amount + status badge (paid = green, open = amber).
- When the order is **approved but not invoiced**, a manager can **Create invoice**
  (`POST /sales/sales-orders/:id/invoice`) directly from the panel; before approval it
  prompts to approve first. Real API client, no mocks. `Invoice` api-client type extended.

Billing runs parallel to fulfilment (order-to-cash `status` vs `fulfillment_status`); the
panel now shows both tracks for one order.

## Verification

Backend:
- PASS: `npm run typecheck`.
- PASS: focused run — pipeline + sales + fulfillment + shipping + ecommerce + billing = 43/43,
  incl. new "invoicing a sales order raises an AR invoice linked back to it".
- PASS: `npm test` — **388/388** (0 fail; = 382 master baseline + 5 delivery-pipeline tests
  already committed on this branch + 1 new invoice-link test).
- PASS: `npm run smoke` — 20/20.
- PASS: `node tools/hygiene-check.mjs` — 912 files, no junk.

Frontend:
- PASS: `cd web && npm run typecheck`.
- PASS: `cd web && npm run lint` — pre-existing hook warnings only.
- PASS: `cd web && npm run build` — `/delivery` route emitted (5.33 kB).

## Follow-ups
- Playwright e2e for the `/delivery` page (still **Built but not verified**).
- Partial invoicing (`partially_invoiced` status exists on SOStatus but isn't produced).
