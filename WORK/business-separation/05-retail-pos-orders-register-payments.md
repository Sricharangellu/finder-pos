# Work Package 05: Retail POS, Orders, Register, And Payments

## Goal

Keep retail POS workflows separate from wholesale sales order workflows.

## User Feature Separation

Retail users work in scan-first checkout, register sessions, receipts, split tender, returns, and store inventory.

## Data Scheme

Retail rows must include:

```txt
tenant_id
business_unit_id
channel = retail_pos
store_id
register_id
cashier_id
```

Tables:

```txt
orders
order_lines
register_sessions
register_cash_movements
payments
payment_methods
retail_receipts
returns
return_lines
age_verification_logs
```

## Existing Files To Touch

- `src/modules/orders`
- `src/modules/payments`
- `src/modules/giftcards`
- `src/modules/loyalty`
- `src/modules/workflows`
- `web/app/(protected)/retail`

## Backend Endpoints

```txt
POST /api/v1/retail/register-sessions/open
POST /api/v1/retail/register-sessions/:id/close
GET  /api/v1/retail/register-sessions/current
POST /api/v1/retail/orders
POST /api/v1/retail/orders/:id/payments
POST /api/v1/retail/orders/:id/void
POST /api/v1/retail/orders/:id/return
GET  /api/v1/retail/orders
GET  /api/v1/retail/dashboard
```

## Flow

Open register, scan products, resolve retail pricing, verify age/tax, tender payment, decrement inventory, generate receipt, post accounting, update reports.

## Tests

- POS cannot be used without an open register.
- Wholesale-only user cannot access POS.
- Payment capture completes retail order.
- Cash closeout totals match payments.

## Acceptance Criteria

- Retail order never creates a wholesale invoice by default.

