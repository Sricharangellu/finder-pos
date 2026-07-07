# Work Package 06: Wholesale Quotes, Sales Orders, Credit, And Invoices

## Goal

Keep wholesale B2B workflows separate from retail POS.

## User Feature Separation

Wholesale users work with quotes, sales orders, customer account terms, credit limits, approvals, warehouse picking, invoices, AR, and sales reps.

## Data Scheme

Every wholesale document must include:

```txt
tenant_id
business_unit_id
channel = wholesale_b2b
customer_id
sales_rep_id optional
warehouse_id optional
```

Tables:

```txt
quotations
quotation_lines
sales_orders
sales_order_lines
customer_credit_profiles
sales_reps
sales_order_approvals
customer_invoices
invoice_lines
ar_transactions
ar_dunning_events
```

## Existing Files To Touch

- `src/modules/sales`
- `src/modules/quotes`
- `src/modules/billing`
- `src/modules/customer_invoices`
- `src/modules/fulfillment`
- `web/app/(protected)/wholesale`

## Backend Endpoints

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

## Flow

Create quote or sales order, resolve customer price, check credit, approve, reserve inventory, create pick list, ship, invoice, update AR, post accounting.

## Tests

- Wholesale order cannot bypass credit rules without approval.
- Retail cashier cannot create wholesale invoice.
- Invoice updates AR.

## Acceptance Criteria

- Wholesale order state is document-driven and never depends on register session state.

