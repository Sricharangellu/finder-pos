# Work Package 06: Wholesale Quotes, Sales Orders, Credit, And Invoices

## Goal

Wholesale / B2B selling — quotes, sales orders, approvals, credit limits,
picking, shipping, invoices, and accounts receivable. Separate from retail POS
(WP 05); document-driven, never tied to a register session.

## Database changes

Every wholesale document includes:

```txt
tenant_id  business_unit_id  channel = wholesale_b2b  customer_id
sales_rep_id?  warehouse_id?  status  subtotal_cents  discount_cents
tax_cents  total_cents  created_at  updated_at
```

Tables:

```txt
quotations            quotation_lines         sales_orders
sales_order_lines     customer_credit_profiles sales_reps
sales_order_approvals customer_invoices        invoice_lines
ar_transactions       ar_dunning_events
```

## Current repo files affected

- `src/modules/sales`, `src/modules/quotes`, `src/modules/billing`, `src/modules/customer_invoices`.
- `src/modules/fulfillment` (picking/shipping), `src/modules/accounting` (posting).
- `web/app/(protected)/wholesale/*`.

## Backend endpoints

```txt
POST /api/v1/wholesale/quotes
GET  /api/v1/wholesale/quotes
POST /api/v1/wholesale/quotes/:id/convert
POST /api/v1/wholesale/sales-orders
GET  /api/v1/wholesale/sales-orders
POST /api/v1/wholesale/sales-orders/:id/approve
POST /api/v1/wholesale/sales-orders/:id/reject
POST /api/v1/wholesale/sales-orders/:id/invoice
GET  /api/v1/wholesale/ar-aging
GET  /api/v1/wholesale/customers/:id/credit
```

## Wholesale flow

1. Sales rep creates a quote or sales order.
2. Customer-specific price book resolves price (WP 04).
3. System checks credit limit and account hold.
4. Manager approval required if credit exceeded (WP 02).
5. Approved order goes to warehouse picking (WP 07 reserve).
6. Fulfillment ships the order (WP 07 `wholesale_ship`).
7. Invoice is created.
8. AR balance updates.
9. Reports update customer, sales rep, margin, and aging (WP 10/13).

## Frontend screens

- Quote builder; sales-order workspace.
- Customer account panel; credit-limit warning.
- Approval workflow.
- Invoice generation.
- AR aging dashboard; sales-rep performance dashboard.

## Tests required

- Wholesale order cannot bypass credit rules unless approved.
- A retail cashier cannot create a wholesale invoice.
- A sales order can convert to a pick list.
- Invoice updates AR.
- Customer-specific pricing is applied.

## Acceptance criteria

- Credit rules cannot be bypassed without approval.
- Retail users cannot create wholesale invoices; wholesale state never depends on register-session state.
- Sales order → pick list → shipment → invoice → AR chain is intact.
- Customer-specific pricing is applied.

## Implementation checklist

- [ ] Quote/sales-order tables + `business_unit_id` + `channel = wholesale_b2b`.
- [ ] Quote → sales-order conversion.
- [ ] Credit check + `sales_order_approvals` (approve/reject).
- [ ] Invoice creation + `ar_transactions` + AR aging.
- [ ] Guards: `requireChannel(wholesale_b2b)`, `requirePermission(wholesale.sales_orders.*)`.
- [ ] Reserve/ship integration (WP 07) + accounting posting.
- [ ] Frontend: quote builder, SO workspace, credit/approval, invoices, AR + rep dashboards.
