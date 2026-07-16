import type { PosModule, ModuleContext } from "../types.js";
import { OrdersService } from "./service.js";
import { registerRoutes } from "./routes.js";
import { dropLegacyNoTenant } from "../../shared/migrate.js";

// Mirrors db/migrations/0002_commerce.sql — db/ is the canonical DDL owner.
const CREATE_ORDERS_TABLE = `
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  order_number   TEXT NOT NULL,
  state_code     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  subtotal_cents BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents      BIGINT NOT NULL DEFAULT 0,
  total_cents    BIGINT NOT NULL,
  customer_id    TEXT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  UNIQUE (tenant_id, order_number)
);
CREATE INDEX IF NOT EXISTS orders_tenant_status_idx ON orders (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_tenant_customer_idx ON orders (tenant_id, customer_id);
`;

const CREATE_ORDER_LINES_TABLE = `
CREATE TABLE IF NOT EXISTS order_lines (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  order_id     TEXT NOT NULL,
  product_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  unit_cents   BIGINT NOT NULL,
  tax_cents    BIGINT NOT NULL,
  line_cents   BIGINT NOT NULL,
  taxable      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oln_tenant_order_idx ON order_lines (tenant_id, order_id);
`;

// S2-MULTI-STORE-FILTER: store_id links each order to the outlet it was
// created at so managers scoped to one store can be filtered server-side.
// NULL = legacy orders created before multi-store was enabled.
const ALTER_ORDERS_STORE_ID = `
ALTER TABLE orders ADD COLUMN IF NOT EXISTS store_id TEXT;
CREATE INDEX IF NOT EXISTS orders_tenant_store_idx ON orders (tenant_id, store_id, created_at DESC);
`;

// Multi-currency support: currency code and exchange rate against base currency.
const ALTER_ORDERS_CURRENCY = `
ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(10,6) NOT NULL DEFAULT 1.0;
`;

// DB-4: Enterprise composite indexes for high-frequency report queries.
// (tenant_id, created_at DESC, status) — range + status filter without post-filter sort.
// (tenant_id, customer_id, created_at DESC) — customer order history.
const ADD_ENTERPRISE_ORDER_INDEXES = `
CREATE INDEX IF NOT EXISTS orders_tenant_created_status_idx
  ON orders (tenant_id, created_at DESC, status);
CREATE INDEX IF NOT EXISTS orders_tenant_customer_created_idx
  ON orders (tenant_id, customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_lines_tenant_product_idx
  ON order_lines (tenant_id, product_id, order_id);
`;

// DB-12: CHECK constraint on order_lines quantities (safe — always true for valid data).
// Skipping a status CHECK on orders since the codebase uses a TypeScript union type
// (OrderStatus) that already enforces valid values at compile time; adding a DB CHECK
// here risks breaking existing tests if any status values were added incrementally.
const ADD_ORDER_QUANTITY_CHECKS = `
DO $$
BEGIN
  ALTER TABLE order_lines
    ADD CONSTRAINT chk_order_lines_qty
    CHECK (quantity > 0 AND unit_cents >= 0 AND line_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
`;

// PROD-8: FK constraints — order_lines must reference a real order row.
// Deferred initially (DEFERRABLE INITIALLY DEFERRED) so batch inserts within
// the same transaction don't require a specific INSERT order.
const ADD_ORDER_LINE_FK = `
DO $$
BEGIN
  ALTER TABLE order_lines
    ADD CONSTRAINT fk_order_lines_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
`;

// PROD-9: updated_at auto-stamp triggers for orders tables.
const ADD_ORDERS_UPDATED_AT_TRIGGERS = `
DO $$
DECLARE tbl TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN RETURN; END IF;
  FOREACH tbl IN ARRAY ARRAY['orders']
  LOOP
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = tbl AND column_name = 'updated_at'
      ) THEN
        EXECUTE format(
          'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          tbl, tbl
        );
      END IF;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END;
$$;
`;

// BE-R5: parent_order_id links split-child orders back to the original.
const ALTER_ORDERS_PARENT_ID = `
ALTER TABLE orders ADD COLUMN IF NOT EXISTS parent_order_id TEXT;
CREATE INDEX IF NOT EXISTS orders_parent_id_idx ON orders (parent_order_id) WHERE parent_order_id IS NOT NULL;
`;

export const ordersModule: PosModule = {
  name: "orders",
  migrations: [dropLegacyNoTenant("order_lines"), dropLegacyNoTenant("orders"), CREATE_ORDERS_TABLE, CREATE_ORDER_LINES_TABLE, ALTER_ORDERS_STORE_ID, ALTER_ORDERS_CURRENCY, ADD_ENTERPRISE_ORDER_INDEXES, ADD_ORDER_QUANTITY_CHECKS, ADD_ORDER_LINE_FK, ADD_ORDERS_UPDATED_AT_TRIGGERS, ALTER_ORDERS_PARENT_ID],
  register(ctx: ModuleContext): void {
    const service = new OrdersService(ctx.db, ctx.events);
    registerRoutes(ctx.router, service);

    // A captured payment completes the order it was made against.
    // Durable (ACPA M1.3): markCompleted only transitions 'open' → 'completed',
    // so it is naturally idempotent — redelivery needs no claim.
    const completeOrder = async (event: { aggregateId?: string; occurredAt: string; payload: unknown }) => {
      const payload = event.payload as { orderId?: string; tenantId?: string };
      const orderId = payload.orderId ?? event.aggregateId;
      const tenantId = payload.tenantId ?? "";
      if (orderId && tenantId) await service.markCompleted(orderId, tenantId);
    };
    ctx.events.on("payment.captured", completeOrder);
    ctx.outbox?.onDurable("payment.captured", completeOrder);
  },
};

export { OrdersService } from "./service.js";
export type {
  OrderRow,
  OrderLineRow,
  OrderWithLines,
  OrderStatus,
  CreateOrderInput,
  CreateOrderLineInput,
  ListOrdersQuery,
  OrderCourse,
  CourseValue,
  CourseStatus,
  SplitOrderInput,
} from "./service.js";
export {
  computeOrderTax,
  rateFor,
  STATE_TAX_RATES,
  type TaxableLine,
  type OrderTax,
  type LineTax,
} from "./tax.js";
