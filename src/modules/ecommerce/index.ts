import type { PosModule } from "../types.js";
import { EcommerceService } from "./service.js";
import { SalesService } from "../sales/service.js";
import { registerRoutes } from "./routes.js";

// Online visibility flag on catalog products (idempotent ALTER; products table
// is catalog-owned, extended here the same way sales added customers.tier).
const ADD_ECOMMERCE_FLAG = `ALTER TABLE products ADD COLUMN IF NOT EXISTS ecommerce INTEGER NOT NULL DEFAULT 0;`;
const INDEX = `CREATE INDEX IF NOT EXISTS products_ecommerce_idx ON products (tenant_id, ecommerce) WHERE ecommerce = 1;`;

/** Ecommerce — online catalog flag, storefront, checkout→SO, customer portal (#14). */
export const ecommerceModule: PosModule = {
  name: "ecommerce",
  migrations: [ADD_ECOMMERCE_FLAG, INDEX],
  register({ db, events, router }) {
    const sales = new SalesService(db, events);
    registerRoutes(router, new EcommerceService(db, sales));
  },
};

export { EcommerceService } from "./service.js";
