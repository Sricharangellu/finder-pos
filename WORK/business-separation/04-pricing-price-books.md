# Work Package 04: Pricing And Price Books

## Goal

Replace flat `products.price_cents` / `wholesale_price_cents` /
`enterprise_price_cents` columns with a **price-book engine** covering retail
shelf pricing, wholesale tier pricing, ecommerce pricing, contract pricing, and
customer-specific pricing.

## Database changes

```sql
price_books (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, business_unit_id TEXT,
  name TEXT NOT NULL, channel TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
  priority INTEGER NOT NULL DEFAULT 100, active BOOLEAN NOT NULL DEFAULT true,
  starts_at BIGINT, ends_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);

price_book_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, price_book_id TEXT NOT NULL,
  product_id TEXT NOT NULL, unit_code TEXT NOT NULL DEFAULT 'each',
  min_qty INTEGER NOT NULL DEFAULT 1, price_cents BIGINT NOT NULL,
  cost_cents BIGINT, margin_pct NUMERIC, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  UNIQUE (tenant_id, price_book_id, product_id, unit_code, min_qty)
);

customer_price_assignments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL,
  price_book_id TEXT NOT NULL, starts_at BIGINT, ends_at BIGINT,
  UNIQUE (tenant_id, customer_id, price_book_id)
);
```

Also: `customer_group_price_assignments`, `promotion_price_rules`,
`price_change_logs`, `margin_rules`.

## Price resolution priority

1. Customer-specific contract price.
2. Customer group price book.
3. Business unit / channel price book.
4. Tenant default price book.
5. Product fallback price.

## Current repo files affected

- `src/modules/pricing` (new/extended), `src/modules/discounts`, `src/modules/loyalty`.
- `src/modules/orders` (retail resolve), `src/modules/sales`/`quotes` (wholesale resolve).
- `web/app/(protected)/admin/pricing`.

## Backend endpoints

```txt
POST /api/v1/pricing/resolve
GET  /api/v1/pricing/price-books
POST /api/v1/pricing/price-books
POST /api/v1/pricing/price-books/:id/items
POST /api/v1/pricing/customer-assignments
GET  /api/v1/pricing/product/:id/history
```

## Retail behavior

- Fast resolution by barcode/product; uses the retail price book; supports
  promotions/discounts; no customer required.

## Wholesale behavior

- Customer usually required; supports tier / case / contract / minimum-quantity
  pricing; shows credit/margin warnings where permitted; blocks unauthorized
  manual price override (routes through a WP 02 permission request).

## Frontend screens

- Price-book admin with channel-specific tabs.
- Customer price-assignment UI.
- Price-history log.
- Manual override workflow gated by permission request.

## Tests required

- Retail checkout resolves the retail price.
- Wholesale sales order resolves the wholesale/customer price.
- Same product resolves different prices per channel/unit/qty.
- Price changes are audited (`price_change_logs`).
- Unauthorized users cannot override a protected price.

## Acceptance criteria

- Same product can have different price by channel, business unit, customer, quantity, and unit.
- Retail POS resolves retail price; wholesale order resolves customer/tier price.
- Price changes are audited; unauthorized override is blocked.

## Implementation checklist

- [ ] Price-book + item + assignment tables (+ group/promotion/margin/log tables).
- [ ] `PricingService.resolvePrice()` implementing the 5-step priority.
- [ ] `POST /api/v1/pricing/resolve` + CRUD endpoints.
- [ ] Retail (orders) and wholesale (sales/quotes) call resolve.
- [ ] Manual-override permission-request workflow.
- [ ] Price-book admin UI + history + customer assignment.
