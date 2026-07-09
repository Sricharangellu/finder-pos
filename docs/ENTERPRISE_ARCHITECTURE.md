# Ascend — Enterprise System Design, Architecture & Backend Schema

> **Authoritative reference** — This document defines the target architecture, schema, API design, and build roadmap for Ascend. All backend and frontend decisions should align with this spec.

---

## 1. Target Architecture

Ascend is built as an **enterprise modular monolith**, designed to later split into services.

```
Apps
 ├── POS Terminal
 ├── Admin Dashboard
 ├── Inventory App
 ├── Manager App
 ├── B2B Portal
 └── Mobile App

API Layer
 ├── API Gateway
 ├── Auth Middleware
 ├── Tenant Resolver
 ├── Permission Guard
 ├── Rate Limiter
 └── Validation Layer

Core Backend
 ├── Identity & Access
 ├── Tenant Management
 ├── Store / Outlet Management
 ├── Product Catalog
 ├── Pricing Engine
 ├── Inventory Ledger
 ├── Sales / Orders
 ├── Payments
 ├── Returns / Refunds
 ├── Customers / Loyalty
 ├── Purchasing
 ├── Vendors
 ├── Gift Cards
 ├── Tax Engine
 ├── Promotions
 ├── Reporting
 ├── Offline Sync
 ├── Audit Logs
 └── Webhooks

Infrastructure
 ├── PostgreSQL
 ├── Redis
 ├── Queue System
 ├── Object Storage
 ├── Search Engine
 ├── Event Bus
 ├── Analytics Warehouse
 └── Monitoring
```

---

## 2. Recommended Tech Stack

**Frontend**
- Next.js + React + TypeScript + Tailwind CSS
- TanStack Query, Zustand / Redux Toolkit
- IndexedDB for offline POS

**Backend**
- Node.js + TypeScript + NestJS or Express
- PostgreSQL + Prisma or Drizzle
- Redis, BullMQ, Zod validation
- JWT + Refresh Tokens, OpenTelemetry

**Infrastructure**
- Vercel / AWS / GCP
- PostgreSQL managed database, Redis managed cache
- S3 object storage, Cloudflare CDN
- GitHub Actions, Sentry, Datadog / Grafana

---

## 3. Enterprise Design Principles

### 3.1 Multi-Tenant First
Every business is a tenant. Every business-owned table must include:
```sql
tenant_id UUID NOT NULL
```
Never query business data without tenant filtering.

### 3.2 Inventory Ledger, Not Simple Stock
Use an inventory ledger. Every stock change must create a movement:
- Sale → inventory movement
- Return → inventory movement
- Purchase receive → inventory movement
- Transfer → inventory movement
- Adjustment / Damage / Loss / Count correction → inventory movement

### 3.3 Financial Records Must Be Immutable
Orders, payments, refunds, and invoices must not be casually edited. Use status changes, adjustment records, refund records, void records, and audit logs. Never silently update financial history.

### 3.4 Offline-First POS
POS terminal must work during internet failure. Use: Local IndexedDB, sync queue, conflict resolution, idempotency keys, device IDs, server-side sync events.

### 3.5 Event-Driven Backend
Key events emitted:
- `order.created`, `payment.completed`, `inventory.decreased`
- `purchase_order.received`, `refund.created`, `customer.created`, `register.closed`

Events trigger: webhooks, receipts, reports, notifications, integrations, accounting sync.

---

## 4. Backend Module Structure

```
src/
 ├── app.ts / main.ts / config/
 ├── database/ (migrations, seeds, schema)
 ├── modules/
 │   ├── identity/     ├── tenants/      ├── outlets/
 │   ├── registers/    ├── catalog/      ├── pricing/
 │   ├── inventory/    ├── orders/       ├── payments/
 │   ├── returns/      ├── customers/    ├── loyalty/
 │   ├── vendors/      ├── purchasing/   ├── tax/
 │   ├── promotions/   ├── gift-cards/   ├── reporting/
 │   ├── sync/         ├── webhooks/     └── audit/
 ├── shared/
 │   ├── errors/ guards/ middleware/ events/ queues/ logger/ validators/ utils/
 └── tests/
```

Each module: controller, service, repository, dto, validator, events, tests.

---

## 5. PostgreSQL Schema

### 5.1 Tenants
```sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    tenant_code VARCHAR(100) UNIQUE NOT NULL,
    industry VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    plan VARCHAR(100),
    default_currency CHAR(3) DEFAULT 'USD',
    default_timezone VARCHAR(100) DEFAULT 'America/Chicago',
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE tenant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    setting_key VARCHAR(150) NOT NULL,
    setting_value JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, setting_key)
);
```

### 5.2 Identity & Access
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    first_name VARCHAR(100), last_name VARCHAR(100),
    email VARCHAR(255) NOT NULL, phone VARCHAR(50),
    password_hash TEXT NOT NULL,
    mfa_enabled BOOLEAN DEFAULT false,
    status VARCHAR(50) DEFAULT 'active',
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(100) NOT NULL, description TEXT,
    is_system_role BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(150) UNIQUE NOT NULL, module VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL, description TEXT
);

CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES roles(id),
    permission_id UUID NOT NULL REFERENCES permissions(id),
    UNIQUE (role_id, permission_id)
);

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    role_id UUID NOT NULL REFERENCES roles(id),
    UNIQUE (user_id, role_id)
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    refresh_token_hash TEXT NOT NULL,
    device_name VARCHAR(255), ip_address VARCHAR(100), user_agent TEXT,
    expires_at TIMESTAMP NOT NULL, revoked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);
```

### 5.3 Organization — Outlets & Registers
```sql
CREATE TABLE outlets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL, code VARCHAR(50) NOT NULL,
    type VARCHAR(50) DEFAULT 'store',
    email VARCHAR(255), phone VARCHAR(50),
    address_line1 TEXT, address_line2 TEXT,
    city VARCHAR(100), state VARCHAR(100), postal_code VARCHAR(50), country VARCHAR(100),
    timezone VARCHAR(100), status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE registers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    outlet_id UUID NOT NULL REFERENCES outlets(id),
    name VARCHAR(100) NOT NULL, code VARCHAR(50) NOT NULL,
    device_id UUID, status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, outlet_id, code)
);

CREATE TABLE cash_drawer_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    outlet_id UUID NOT NULL REFERENCES outlets(id),
    register_id UUID NOT NULL REFERENCES registers(id),
    opened_by UUID NOT NULL REFERENCES users(id),
    closed_by UUID REFERENCES users(id),
    opening_amount NUMERIC(12,2) DEFAULT 0,
    expected_amount NUMERIC(12,2), counted_amount NUMERIC(12,2), difference_amount NUMERIC(12,2),
    status VARCHAR(50) DEFAULT 'open',
    opened_at TIMESTAMP DEFAULT now(), closed_at TIMESTAMP
);
```

### 5.4 Product Catalog
```sql
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    parent_id UUID REFERENCES categories(id),
    name VARCHAR(255) NOT NULL, slug VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL, status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    category_id UUID REFERENCES categories(id),
    brand_id UUID REFERENCES brands(id),
    name VARCHAR(255) NOT NULL, description TEXT,
    product_type VARCHAR(50) DEFAULT 'standard',
    track_inventory BOOLEAN DEFAULT true, taxable BOOLEAN DEFAULT true,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    product_id UUID NOT NULL REFERENCES products(id),
    sku VARCHAR(100) NOT NULL, barcode VARCHAR(100), name VARCHAR(255),
    option_values JSONB,
    cost_price NUMERIC(12,2) DEFAULT 0,
    retail_price NUMERIC(12,2) NOT NULL,
    wholesale_price NUMERIC(12,2), compare_at_price NUMERIC(12,2),
    weight NUMERIC(12,3), dimensions JSONB,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, sku)
);
```

### 5.5 Enterprise Pricing
```sql
CREATE TABLE price_books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL, customer_type VARCHAR(50),
    currency CHAR(3) DEFAULT 'USD', status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE price_book_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    price_book_id UUID NOT NULL REFERENCES price_books(id),
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    price NUMERIC(12,2) NOT NULL, min_quantity NUMERIC(12,3) DEFAULT 1,
    created_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, price_book_id, variant_id, min_quantity)
);
```

### 5.6 Inventory Ledger
```sql
CREATE TABLE inventory_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    outlet_id UUID NOT NULL REFERENCES outlets(id),
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity_on_hand NUMERIC(14,3) DEFAULT 0,
    quantity_reserved NUMERIC(14,3) DEFAULT 0,
    quantity_available NUMERIC(14,3) DEFAULT 0,
    reorder_point NUMERIC(14,3) DEFAULT 0,
    reorder_quantity NUMERIC(14,3) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, outlet_id, variant_id)
);

CREATE TABLE inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    outlet_id UUID NOT NULL REFERENCES outlets(id),
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    movement_type VARCHAR(50) NOT NULL,  -- SALE, RETURN, PURCHASE_RECEIVE, TRANSFER_IN/OUT, ADJUSTMENT_IN/OUT, DAMAGE, LOSS, COUNT_CORRECTION
    direction VARCHAR(10) NOT NULL,
    quantity NUMERIC(14,3) NOT NULL,
    unit_cost NUMERIC(12,2),
    reference_type VARCHAR(100), reference_id UUID,
    reason TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE stock_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    transfer_number VARCHAR(100) NOT NULL,
    from_outlet_id UUID NOT NULL REFERENCES outlets(id),
    to_outlet_id UUID NOT NULL REFERENCES outlets(id),
    status VARCHAR(50) DEFAULT 'draft',
    requested_by UUID REFERENCES users(id),
    shipped_by UUID REFERENCES users(id),
    received_by UUID REFERENCES users(id),
    shipped_at TIMESTAMP, received_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, transfer_number)
);

CREATE TABLE stock_transfer_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    stock_transfer_id UUID NOT NULL REFERENCES stock_transfers(id),
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity_requested NUMERIC(14,3) NOT NULL,
    quantity_shipped NUMERIC(14,3) DEFAULT 0,
    quantity_received NUMERIC(14,3) DEFAULT 0
);
```

### 5.7 Customers
```sql
CREATE TABLE customer_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    price_book_id UUID REFERENCES price_books(id),
    discount_percentage NUMERIC(5,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    customer_group_id UUID REFERENCES customer_groups(id),
    customer_number VARCHAR(100),
    first_name VARCHAR(100), last_name VARCHAR(100), company_name VARCHAR(255),
    email VARCHAR(255), phone VARCHAR(50),
    customer_type VARCHAR(50) DEFAULT 'retail',
    tax_exempt BOOLEAN DEFAULT false, tax_number VARCHAR(100),
    credit_limit NUMERIC(12,2) DEFAULT 0,
    store_credit_balance NUMERIC(12,2) DEFAULT 0,
    loyalty_points NUMERIC(12,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, customer_number)
);
```

### 5.8 Orders & Sales
```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    outlet_id UUID NOT NULL REFERENCES outlets(id),
    register_id UUID REFERENCES registers(id),
    customer_id UUID REFERENCES customers(id),
    order_number VARCHAR(100) NOT NULL,
    channel VARCHAR(50) DEFAULT 'pos', order_type VARCHAR(50) DEFAULT 'sale',
    status VARCHAR(50) DEFAULT 'completed', currency CHAR(3) DEFAULT 'USD',
    subtotal NUMERIC(12,2) DEFAULT 0, discount_total NUMERIC(12,2) DEFAULT 0,
    tax_total NUMERIC(12,2) DEFAULT 0, shipping_total NUMERIC(12,2) DEFAULT 0,
    grand_total NUMERIC(12,2) DEFAULT 0, paid_total NUMERIC(12,2) DEFAULT 0,
    balance_due NUMERIC(12,2) DEFAULT 0,
    created_by UUID REFERENCES users(id),
    idempotency_key VARCHAR(255),
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, order_number),
    UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    variant_id UUID REFERENCES product_variants(id),
    product_name VARCHAR(255) NOT NULL, sku VARCHAR(100),
    quantity NUMERIC(14,3) NOT NULL, unit_price NUMERIC(12,2) NOT NULL,
    discount_amount NUMERIC(12,2) DEFAULT 0, tax_amount NUMERIC(12,2) DEFAULT 0,
    line_total NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP DEFAULT now()
);
```

### 5.9 Payments & Refunds
```sql
CREATE TABLE payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,  -- CASH, CARD, GIFT_CARD, STORE_CREDIT, BANK_TRANSFER, CHECK, ACCOUNT_CREDIT
    provider VARCHAR(100), is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    outlet_id UUID REFERENCES outlets(id),
    order_id UUID REFERENCES orders(id),
    payment_method_id UUID REFERENCES payment_methods(id),
    amount NUMERIC(12,2) NOT NULL, currency CHAR(3) DEFAULT 'USD',
    status VARCHAR(50) DEFAULT 'completed',
    provider VARCHAR(100), provider_transaction_id VARCHAR(255),
    authorization_code VARCHAR(255),
    processed_by UUID REFERENCES users(id),
    processed_at TIMESTAMP DEFAULT now()
);

CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    payment_id UUID REFERENCES payments(id),
    amount NUMERIC(12,2) NOT NULL, reason TEXT,
    status VARCHAR(50) DEFAULT 'completed',
    processed_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT now()
);
```

### 5.10 Returns
```sql
CREATE TABLE returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    return_number VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'completed', reason TEXT,
    created_by UUID REFERENCES users(id), created_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, return_number)
);

CREATE TABLE return_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    return_id UUID NOT NULL REFERENCES returns(id),
    order_item_id UUID REFERENCES order_items(id),
    variant_id UUID REFERENCES product_variants(id),
    quantity NUMERIC(14,3) NOT NULL, refund_amount NUMERIC(12,2) NOT NULL,
    restock BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT now()
);
```

### 5.11 Vendors & Purchasing
```sql
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    vendor_number VARCHAR(100), name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255), email VARCHAR(255), phone VARCHAR(50),
    website TEXT, tax_number VARCHAR(100), payment_terms VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, vendor_number)
);

CREATE TABLE vendor_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    vendor_sku VARCHAR(100), cost_price NUMERIC(12,2),
    minimum_order_quantity NUMERIC(14,3), lead_time_days INT,
    UNIQUE (tenant_id, vendor_id, variant_id)
);

CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    outlet_id UUID NOT NULL REFERENCES outlets(id),
    vendor_id UUID NOT NULL REFERENCES vendors(id),
    po_number VARCHAR(100) NOT NULL, status VARCHAR(50) DEFAULT 'draft',
    subtotal NUMERIC(12,2) DEFAULT 0, tax_total NUMERIC(12,2) DEFAULT 0,
    shipping_total NUMERIC(12,2) DEFAULT 0, grand_total NUMERIC(12,2) DEFAULT 0,
    expected_date DATE,
    created_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id), approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, po_number)
);

CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity_ordered NUMERIC(14,3) NOT NULL,
    quantity_received NUMERIC(14,3) DEFAULT 0,
    unit_cost NUMERIC(12,2) NOT NULL, line_total NUMERIC(12,2) NOT NULL
);
```

### 5.12 Taxes & Promotions
```sql
CREATE TABLE tax_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(100) NOT NULL, rate NUMERIC(8,4) NOT NULL,
    country VARCHAR(100), state VARCHAR(100), city VARCHAR(100), postal_code VARCHAR(50),
    is_default BOOLEAN DEFAULT false, status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE discounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL, code VARCHAR(100),
    discount_type VARCHAR(50) NOT NULL,  -- PERCENTAGE, FIXED_AMOUNT, BUY_X_GET_Y, CUSTOMER_GROUP, WHOLESALE, ORDER_LEVEL, ITEM_LEVEL
    value NUMERIC(12,2) NOT NULL,
    starts_at TIMESTAMP, ends_at TIMESTAMP,
    usage_limit INT, minimum_purchase_amount NUMERIC(12,2),
    status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT now()
);
```

### 5.13 Gift Cards
```sql
CREATE TABLE gift_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    card_number VARCHAR(100) NOT NULL,
    initial_value NUMERIC(12,2) NOT NULL, balance NUMERIC(12,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    issued_to_customer_id UUID REFERENCES customers(id),
    issued_by UUID REFERENCES users(id),
    issued_at TIMESTAMP DEFAULT now(), expires_at TIMESTAMP,
    UNIQUE (tenant_id, card_number)
);

CREATE TABLE gift_card_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
    order_id UUID REFERENCES orders(id),
    transaction_type VARCHAR(50) NOT NULL,
    amount NUMERIC(12,2) NOT NULL, balance_after NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP DEFAULT now()
);
```

### 5.14 Audit Logs
```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    user_id UUID REFERENCES users(id),
    action VARCHAR(150) NOT NULL, entity_type VARCHAR(100), entity_id UUID,
    old_values JSONB, new_values JSONB,
    ip_address VARCHAR(100), user_agent TEXT,
    created_at TIMESTAMP DEFAULT now()
);
```

Use for: login, logout, order refund, price change, inventory adjustment, role update, permission update, cash drawer close, payment void.

### 5.15 Offline Sync
```sql
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    outlet_id UUID REFERENCES outlets(id), register_id UUID REFERENCES registers(id),
    device_name VARCHAR(255), device_type VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active', last_seen_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE sync_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    device_id UUID REFERENCES devices(id),
    entity_type VARCHAR(100) NOT NULL, entity_id UUID NOT NULL,
    operation VARCHAR(50) NOT NULL, payload JSONB NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', conflict_status VARCHAR(50),
    created_at TIMESTAMP DEFAULT now(), processed_at TIMESTAMP,
    UNIQUE (tenant_id, idempotency_key)
);
```

### 5.16 Webhooks
```sql
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL, url TEXT NOT NULL,
    event_type VARCHAR(100) NOT NULL, secret TEXT,
    status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    webhook_id UUID NOT NULL REFERENCES webhooks(id),
    event_type VARCHAR(100) NOT NULL, payload JSONB NOT NULL,
    response_status INT, response_body TEXT,
    attempt_count INT DEFAULT 0, status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT now(), delivered_at TIMESTAMP
);
```

### 5.17 Reporting Cache
```sql
CREATE TABLE daily_sales_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    outlet_id UUID REFERENCES outlets(id),
    report_date DATE NOT NULL,
    gross_sales NUMERIC(12,2) DEFAULT 0, discounts NUMERIC(12,2) DEFAULT 0,
    returns NUMERIC(12,2) DEFAULT 0, net_sales NUMERIC(12,2) DEFAULT 0,
    tax_collected NUMERIC(12,2) DEFAULT 0, total_orders INT DEFAULT 0,
    average_order_value NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT now(),
    UNIQUE (tenant_id, outlet_id, report_date)
);
```

---

## 6. Required Indexes

```sql
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_variants_tenant_sku ON product_variants(tenant_id, sku);
CREATE INDEX idx_inventory_balance_lookup ON inventory_balances(tenant_id, outlet_id, variant_id);
CREATE INDEX idx_inventory_movements_lookup ON inventory_movements(tenant_id, variant_id, created_at);
CREATE INDEX idx_orders_tenant_created ON orders(tenant_id, created_at);
CREATE INDEX idx_orders_customer ON orders(tenant_id, customer_id);
CREATE INDEX idx_payments_order ON payments(tenant_id, order_id);
CREATE INDEX idx_customers_search ON customers(tenant_id, email, phone);
CREATE INDEX idx_purchase_orders_vendor ON purchase_orders(tenant_id, vendor_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(tenant_id, entity_type, entity_id);
CREATE INDEX idx_sync_events_status ON sync_events(tenant_id, status);
```

---

## 7. Core API Routes

```
Auth:      POST /api/auth/login|logout|refresh|forgot-password|reset-password  GET /api/auth/me
Products:  GET|POST /api/products  GET|PATCH|DELETE /api/products/:id
Inventory: GET /api/inventory/balances|movements  POST /api/inventory/adjustments|transfers
           POST /api/inventory/transfers/:id/ship|receive
Orders:    POST|GET /api/orders  GET /api/orders/:id  POST /api/orders/:id/void|return|refund
Payments:  POST|GET /api/payments  POST /api/payments/:id/refund|void
Customers: GET|POST /api/customers  GET|PATCH|DELETE /api/customers/:id
Purchasing:GET|POST /api/purchase-orders  POST /api/purchase-orders/:id/approve|receive|close
Sync:      POST /api/sync/push  GET /api/sync/pull  POST /api/sync/resolve-conflict
```

---

## 8. Checkout Workflow (15 steps)

1. Cashier opens register
2. Customer selected or guest checkout
3. Product barcode scanned
4. Product and price loaded
5. Tax engine calculates tax
6. Discount engine applies promotions
7. Payment captured
8. Order created
9. Payment recorded
10. Inventory movement created
11. Inventory balance updated
12. Receipt generated
13. Audit log written
14. Events emitted
15. Reports updated asynchronously

---

## 9. Inventory Receiving Workflow

1. Purchase order created → Manager approves
2. Vendor ships goods → Store receives
3. Received quantities entered
4. Inventory movements created → balances increase
5. PO status → partially received or received
6. Cost price updated if allowed
7. Audit log written

---

## 10. Security Requirements

- JWT access tokens + refresh token rotation
- MFA for admins
- Role-based + permission-based access control
- Tenant isolation, rate limiting, request validation
- Audit logging, Argon2 password hashing
- Encrypted secrets, device tracking, IP logging, session revocation

---

## 11. Enterprise Permission Set

```
products.view/create/update/delete
inventory.view/adjust/transfer/receive
orders.view/create/void/refund
payments.view/create/refund/void
customers.view/create/update/delete
vendors.view/create/update
purchase_orders.view/create/approve/receive
reports.view/export
team.view/invite/update/delete
settings.view/update
audit_logs.view
webhooks.manage
```

---

## 12. Build Roadmap

| Phase | Focus | Tables / Modules |
|---|---|---|
| **1 — Foundation** | Core identity & org | tenants, users, roles, permissions, outlets, registers, auth, audit_logs |
| **2 — Catalog & Inventory** | Products + ledger | categories, brands, products, product_variants, inventory_balances, inventory_movements |
| **3 — POS Sales** | Checkout flow | orders, order_items, payments, receipts, cash_drawer, tax, discounts |
| **4 — Customers & Loyalty** | CRM + rewards | customers, customer_groups, store_credit, gift_cards, loyalty_points |
| **5 — Purchasing** | Supply chain | vendors, vendor_products, purchase_orders, receiving, cost updates |
| **6 — Enterprise Layer** | Offline + integrations | sync_events, devices, webhooks, reports, approval workflows, advanced RBAC |
| **7 — Scale Layer** | Infrastructure scale | Read replicas, queue workers, analytics warehouse, search, marketplace, ERP sync |

---

## 13. Final Architecture Rule

Ascend must be designed as:
- **Inventory ledger system** — not simple stock counts
- **Financial transaction system** — immutable records, audit trails
- **Multi-tenant SaaS platform** — tenant_id on every table
- **Offline-first terminal** — IndexedDB, sync queue, idempotency
- **Enterprise reporting system** — event-driven, async aggregation
- **Integration-ready commerce platform** — webhooks, event bus, API-first

This foundation supports retail, wholesale, franchises, warehouses, and enterprise clients.
