import type { PosModule, ModuleContext } from "../types.js";
import { PaymentsService } from "./service.js";
import { registerRoutes } from "./routes.js";
import { dropLegacyNoTenant } from "../../shared/migrate.js";

// Mirrors db/migrations/0002_commerce.sql — db/ is the canonical DDL owner.
const MIGRATION = `
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  order_id      TEXT NOT NULL,
  method        TEXT NOT NULL,
  amount_cents  BIGINT NOT NULL,
  cash_cents    BIGINT NOT NULL DEFAULT 0,
  card_cents    BIGINT NOT NULL DEFAULT 0,
  change_cents  BIGINT NOT NULL DEFAULT 0,
  card_last4    TEXT,
  auth_code     TEXT,
  status        TEXT NOT NULL,
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_tenant_order_idx ON payments (tenant_id, order_id);
`;

export const paymentsModule: PosModule = {
  name: "payments",
  migrations: [dropLegacyNoTenant("payments"), MIGRATION],
  register(ctx: ModuleContext): void {
    const service = new PaymentsService(ctx.db, ctx.events);
    registerRoutes(ctx.router, service);
  },
};

export { PaymentsService } from "./service.js";
export type {
  PaymentRecord,
  PaymentMethod,
  PaymentStatus,
  CapturePaymentInput,
} from "./service.js";
