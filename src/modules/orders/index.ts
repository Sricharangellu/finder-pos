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

export const ordersModule: PosModule = {
  name: "orders",
  migrations: [dropLegacyNoTenant("order_lines"), dropLegacyNoTenant("orders"), CREATE_ORDERS_TABLE, CREATE_ORDER_LINES_TABLE],
  register(ctx: ModuleContext): void {
    const service = new OrdersService(ctx.db, ctx.events);
    registerRoutes(ctx.router, service);

    // A captured payment completes the order it was made against.
    ctx.events.on("payment.captured", async (event) => {
      const payload = event.payload as { orderId?: string; tenantId?: string };
      const orderId = payload.orderId ?? event.aggregateId;
      const tenantId = payload.tenantId ?? "";
      if (orderId && tenantId) await service.markCompleted(orderId, tenantId);
    });
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
} from "./service.js";
export {
  computeOrderTax,
  rateFor,
  STATE_TAX_RATES,
  type TaxableLine,
  type OrderTax,
  type LineTax,
} from "./tax.js";
