/**
 * E2E seed script — provisions a demo tenant + owner user for Playwright tests.
 *
 * Run after the backend has started (migrations are applied on startup).
 * Bypasses the NODE_ENV=production guard in identityModule.seedDemo() because
 * the CI E2E job deliberately runs in production mode to test the real build.
 *
 * Idempotent: ON CONFLICT DO NOTHING everywhere, safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... tsx scripts/seed-e2e.ts
 */

import { openDb } from "../src/shared/db.js";
import bcrypt from "bcryptjs";

const DEMO_TENANT_ID = "tnt_demo";
const DEMO_EMAIL = "owner@finder-pos.dev";
const DEMO_PASSWORD = "FinderDemo!2026";

async function main() {
  // SECURITY: this script plants PUBLICLY-KNOWN demo credentials and bypasses
  // seedDemo()'s production guard. Running it against a real/production database
  // opens the live site to anyone. Require an explicit opt-in so a stray
  // `DATABASE_URL=<prod> tsx scripts/seed-e2e.ts` refuses instead of seeding.
  // The CI e2e job sets ALLOW_E2E_SEED=1 against its ephemeral test database.
  if (process.env["ALLOW_E2E_SEED"] !== "1") {
    console.error(
      "✗ Refusing to seed demo credentials.\n" +
        "  This inserts known demo logins and bypasses the production guard.\n" +
        "  Set ALLOW_E2E_SEED=1 ONLY against a disposable test/CI database — never production.",
    );
    process.exit(1);
  }

  const db = openDb();
  try {
    const now = Date.now();

    // Tenant
    await db.query(
      `INSERT INTO tenants (id, name, slug, created_at, updated_at)
       VALUES (@id, @name, @slug, @c, @u)
       ON CONFLICT (id) DO NOTHING`,
      { id: DEMO_TENANT_ID, name: "Demo Store", slug: "demo", c: now, u: now },
    );

    // Owner user
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    await db.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
       VALUES (@id, @t, @e, @h, @r, @c, @u)
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      {
        id: "usr_demo_owner",
        t: DEMO_TENANT_ID,
        e: DEMO_EMAIL,
        h: hash,
        r: "owner",
        c: now,
        u: now,
      },
    );

    // Demo products (searchable in checkout E2E test — at least one with "coffee")
    const products = [
      { id: "prd_demo_001", sku: "GRO-COFFEE-001", name: "Organic Dark Roast Coffee Beans", price_cents: 1499, category: "groceries", barcode: "0123456789012" },
      { id: "prd_demo_002", sku: "GRO-HONEY-001",  name: "Wildflower Honey",                 price_cents:  899, category: "groceries", barcode: "0123456789029" },
      { id: "prd_demo_003", sku: "APP-SHIRT-001",  name: "Ascend Logo T-Shirt",              price_cents: 2200, category: "apparel",   barcode: "0123456789036" },
      { id: "prd_demo_004", sku: "HOME-MUG-001",   name: "Ceramic Coffee Mug",               price_cents: 1200, category: "home",      barcode: "0123456789043" },
    ];
    for (const p of products) {
      await db.query(
        `INSERT INTO products (id, tenant_id, sku, name, price_cents, category, tax_class, barcode, status, created_at, updated_at)
         VALUES (@id, @t, @sku, @name, @price, @cat, 'standard', @barcode, 'active', @c, @u)
         ON CONFLICT (tenant_id, sku) DO NOTHING`,
        { id: p.id, t: DEMO_TENANT_ID, sku: p.sku, name: p.name, price: p.price_cents, cat: p.category, barcode: p.barcode, c: now, u: now },
      );
    }

    // Stock so checkout can sell without overselling guards interfering.
    for (const p of products) {
      await db.query(
        `INSERT INTO inventory (product_id, tenant_id, stock_qty, reorder_pt, updated_at)
         VALUES (@pid, @t, 100, 5, @u)
         ON CONFLICT (tenant_id, product_id) DO NOTHING`,
        { pid: p.id, t: DEMO_TENANT_ID, u: now },
      );
    }

    // A supplier + an open purchase order so the purchasing/receiving e2e
    // specs have a real row to open (2 lines, 10 × coffee + 5 × honey).
    // NB: the email must be a bound parameter — the @name placeholder compiler
    // would otherwise treat the "@e2e" inside a string literal as a parameter.
    await db.query(
      `INSERT INTO suppliers (id, tenant_id, name, email, created_at)
       VALUES ('sup_e2e_001', @t, 'E2E Coffee Supply Co', @email, @c)
       ON CONFLICT (id) DO NOTHING`,
      { t: DEMO_TENANT_ID, email: "orders@e2e-supply.dev", c: now },
    );
    await db.query(
      `INSERT INTO purchase_orders (id, tenant_id, supplier_id, status, total_cost_cents, created_at, receive_status)
       VALUES ('po_e2e_001', @t, 'sup_e2e_001', 'ordered', 12490, @c, 'pending')
       ON CONFLICT (id) DO NOTHING`,
      { t: DEMO_TENANT_ID, c: now },
    );
    const poLines = [
      { id: "pol_e2e_001", productId: "prd_demo_001", name: "Organic Dark Roast Coffee Beans", qty: 10, unit: 899 },
      { id: "pol_e2e_002", productId: "prd_demo_002", name: "Wildflower Honey", qty: 5, unit: 700 },
    ];
    for (const l of poLines) {
      await db.query(
        `INSERT INTO purchase_order_lines (id, tenant_id, po_id, product_id, product_name, quantity, unit_cost_cents, line_cost_cents, received_qty, remaining_qty)
         VALUES (@id, @t, 'po_e2e_001', @pid, @name, @qty, @unit, @line, 0, @qty)
         ON CONFLICT (id) DO NOTHING`,
        { id: l.id, t: DEMO_TENANT_ID, pid: l.productId, name: l.name, qty: l.qty, unit: l.unit, line: l.qty * l.unit },
      );
    }

    console.log("E2E seed complete — demo tenant, owner user, 4 products (stocked), and 1 open PO ready.");
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("seed-e2e failed:", err);
  process.exit(1);
});
