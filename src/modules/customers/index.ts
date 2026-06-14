import type { PosModule } from "../types.js";
import { CustomersService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_CUSTOMERS_TABLE = `
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  points      BIGINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
`;

const CREATE_CUSTOMERS_INDEXES = `
CREATE INDEX IF NOT EXISTS customers_tenant_created_idx ON customers (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customers_tenant_email_idx ON customers (tenant_id, email);
`;

// Wave B — B2B customer profile + financial fields (idempotent ALTERs).
const ADD_PROFILE_COLUMNS = `
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier INTEGER NOT NULL DEFAULT 5;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dba TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS license_no TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_rep_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS store_credit_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS excess_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS verified INTEGER NOT NULL DEFAULT 0;
`;

/**
 * Customers + loyalty. Tenant-scoped. Reacts to `payment.captured`: looks up the
 * paid order's customer and awards loyalty points ($1 net spent = 1 point).
 * Net spent = amountCents − changeCents (i.e. the order total, change excluded).
 */
export const customersModule: PosModule = {
  name: "customers",
  migrations: [CREATE_CUSTOMERS_TABLE, CREATE_CUSTOMERS_INDEXES, ADD_PROFILE_COLUMNS],
  async register({ db, events, router }) {
    const service = new CustomersService(db, events);

    events.on("payment.captured", async (event) => {
      const p = event.payload as {
        tenantId?: string;
        orderId?: string;
        amountCents?: number;
        changeCents?: number;
      };
      const tenantId = p.tenantId ?? "";
      const orderId = p.orderId ?? "";
      if (!tenantId || !orderId) return;
      const customerId = await service.customerForOrder(orderId, tenantId);
      if (!customerId) return; // walk-in / no loyalty account
      const netSpent = (p.amountCents ?? 0) - (p.changeCents ?? 0);
      const points = Math.floor(netSpent / 100);
      await service.awardPoints(customerId, points, tenantId);
    });

    registerRoutes(router, service);
  },
};

export { CustomersService } from "./service.js";
export type { Customer, CreateCustomerInput } from "./service.js";
