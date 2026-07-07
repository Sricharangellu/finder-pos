# Work Package 04: Pricing And Price Books

## Goal

Replace simple product-level wholesale/enterprise price columns with a price book engine that supports retail shelf pricing, wholesale tier pricing, ecommerce pricing, contract pricing, and customer-specific pricing.

## Data Scheme

```sql
price_books (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  business_unit_id TEXT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  priority INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  starts_at BIGINT,
  ends_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

price_book_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  price_book_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  unit_code TEXT NOT NULL DEFAULT 'each',
  min_qty INTEGER NOT NULL DEFAULT 1,
  price_cents BIGINT NOT NULL,
  cost_cents BIGINT,
  margin_pct NUMERIC,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (tenant_id, price_book_id, product_id, unit_code, min_qty)
);

customer_price_assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  price_book_id TEXT NOT NULL,
  starts_at BIGINT,
  ends_at BIGINT,
  UNIQUE (tenant_id, customer_id, price_book_id)
);
```

## Existing Files To Touch

- `src/modules/pricing`
- `src/modules/catalog`
- `src/modules/orders`
- `src/modules/sales`
- `web/app/(protected)/admin/pricing`

## Price Resolution Priority

1. Customer-specific contract price.
2. Customer group price book.
3. Business unit and channel price book.
4. Tenant default price book.
5. Product fallback price.

## Backend Endpoints

```txt
POST /api/v1/pricing/resolve
GET  /api/v1/pricing/price-books
POST /api/v1/pricing/price-books
POST /api/v1/pricing/price-books/:id/items
POST /api/v1/pricing/customer-assignments
GET  /api/v1/pricing/product/:id/history
```

## Tests

- POS resolves retail price.
- Wholesale resolves customer/case/tier price.
- Unauthorized user cannot override protected price.

## Acceptance Criteria

- Same product can have different price by channel, business unit, customer, quantity, and unit.

