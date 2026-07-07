# Work Package 05: Retail POS, Orders, Register, And Payments

## Goal

Retail store checkout — immediate sale, register sessions, receipts, payments,
returns, and store-level inventory. Retail-only; must stay separate from the
wholesale sales-order workflow (WP 06).

## Database changes

Every retail order includes:

```txt
tenant_id  business_unit_id  channel = retail_pos  store_id  register_id
cashier_id  customer_id?  status  subtotal_cents  discount_cents  tax_cents
total_cents  created_at
```

Tables:

```txt
orders             order_lines            register_sessions
register_cash_movements  payments         payment_methods
retail_receipts    returns                return_lines
age_verification_logs
```

Add `business_unit_id` + `channel` (default `retail_pos`) to `orders`, `payments`,
and returns (see WP 01 acceptance + the column-addition follow-up card).

## Current repo files affected

- `src/modules/orders`, `src/modules/payments`, `src/modules/giftcards`, `src/modules/loyalty`.
- `src/modules/workflows`, `src/orchestration/*` (retail checkout workflow, WP 13).
- `web/app/(protected)/retail/*` (pos, orders, register, returns).

## Backend endpoints

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

## Retail checkout flow

1. Cashier opens a register session.
2. Cashier scans a barcode or searches a product.
3. System resolves the retail price (WP 04).
4. System checks age restriction and tax rules (WP 03 compliance).
5. Cashier applies a discount if allowed (WP 02 permission).
6. Customer pays by cash / card / split tender / gift card.
7. Inventory is decremented (WP 07 `retail_sale`).
8. Receipt is printed or emailed.
9. Order event updates reports and accounting (WP 13 events).

## Frontend screens

- POS screen optimized for scanning; cart panel.
- Tender modal with split-payment support.
- Age-verification modal.
- Register open/close screen.
- Receipt preview.
- Return / exchange flow.

## Tests required

- POS cannot be used without an open register session.
- Wholesale-only users cannot access POS.
- Retail order does not create a wholesale invoice by default.
- Inventory movement is recorded on completed sale.
- Payment capture completes the order.
- Cash closeout report matches payment totals.

## Acceptance criteria

- POS requires an open register session; wholesale-only users are refused.
- A retail order never creates a wholesale invoice by default.
- Inventory is decremented; payment capture completes the order.
- Cash closeout reconciles to payment totals.

## Implementation checklist

- [ ] `business_unit_id` + `channel` on `orders`/`payments`/returns.
- [ ] Register session open/close/current + cash movements.
- [ ] Retail order create → price resolve → age/tax → tender → inventory decrement → receipt.
- [ ] Void + return/exchange with inventory restock.
- [ ] Guards: `requireChannel(retail_pos)`, `requirePermission(retail.pos.checkout)` (WP 02).
- [ ] POS UI, tender/split modal, age modal, register screen, receipt, returns.
- [ ] Retail dashboard + closeout report.
