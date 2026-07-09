/**
 * Demo data seed — populates a live Ascend tenant with realistic retail data.
 *
 * Seeds: 12 products · 3 categories · 8 customers · 25 orders · payments
 *
 * Idempotent: ON CONFLICT DO NOTHING everywhere.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... tsx scripts/seed-demo.ts
 *   DATABASE_URL=postgresql://... tsx scripts/seed-demo.ts --tenant tnt_demo
 */

import { openDb } from "../src/shared/db.js";

const TENANT_ID = process.argv.includes("--tenant")
  ? process.argv[process.argv.indexOf("--tenant") + 1]
  : "tnt_demo";

const NOW = Date.now();
const D = 86_400_000; // one day in ms

// ── Helpers ────────────────────────────────────────────────────────────────────

function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

function ago(days: number, hoursOffset = 0): number {
  return NOW - days * D - hoursOffset * 3_600_000;
}

function uid(prefix: string, n: number): string {
  return `${prefix}_${String(n).padStart(4, "0")}`;
}

// ── Seed data ──────────────────────────────────────────────────────────────────

const categories = [
  { id: uid("cat", 1), name: "Coffee & Espresso", parent_id: null },
  { id: uid("cat", 2), name: "Tea & Botanicals",  parent_id: null },
  { id: uid("cat", 3), name: "Food & Pastries",   parent_id: null },
  { id: uid("cat", 4), name: "Cold Drinks",        parent_id: null },
  { id: uid("cat", 5), name: "Merchandise",        parent_id: null },
];

const products = [
  { id: uid("prd", 1),  sku: "ESPR-DBL",   name: "Double Espresso",         category: "Coffee & Espresso", price_cents: cents(3.50),  tax_class: "food_bev",  barcode: "0001000100010" },
  { id: uid("prd", 2),  sku: "LATT-LGE",   name: "Large Latte",             category: "Coffee & Espresso", price_cents: cents(5.75),  tax_class: "food_bev",  barcode: "0001000100020" },
  { id: uid("prd", 3),  sku: "CAPP-REG",   name: "Cappuccino",              category: "Coffee & Espresso", price_cents: cents(4.50),  tax_class: "food_bev",  barcode: "0001000100030" },
  { id: uid("prd", 4),  sku: "COLD-BREW",  name: "Cold Brew 12oz",          category: "Cold Drinks",       price_cents: cents(4.75),  tax_class: "food_bev",  barcode: "0001000100040" },
  { id: uid("prd", 5),  sku: "MATCHA-LT",  name: "Matcha Latte",            category: "Tea & Botanicals",  price_cents: cents(5.50),  tax_class: "food_bev",  barcode: "0001000100050" },
  { id: uid("prd", 6),  sku: "CHAI-SPCE",  name: "Spiced Chai",             category: "Tea & Botanicals",  price_cents: cents(5.25),  tax_class: "food_bev",  barcode: "0001000100060" },
  { id: uid("prd", 7),  sku: "CROIS-BUT",  name: "Butter Croissant",        category: "Food & Pastries",   price_cents: cents(3.75),  tax_class: "food",      barcode: "0001000100070" },
  { id: uid("prd", 8),  sku: "MUFN-BLUB",  name: "Blueberry Muffin",        category: "Food & Pastries",   price_cents: cents(3.50),  tax_class: "food",      barcode: "0001000100080" },
  { id: uid("prd", 9),  sku: "AVT-TOAST",  name: "Avocado Toast",           category: "Food & Pastries",   price_cents: cents(8.50),  tax_class: "food",      barcode: "0001000100090" },
  { id: uid("prd", 10), sku: "MUG-12OZ",   name: "Ceramic Mug 12oz",        category: "Merchandise",       price_cents: cents(18.00), tax_class: "standard",  barcode: "0001000100100" },
  { id: uid("prd", 11), sku: "BEANS-12",   name: "House Blend Beans 12oz",  category: "Coffee & Espresso", price_cents: cents(16.50), tax_class: "food",      barcode: "0001000100110" },
  { id: uid("prd", 12), sku: "TOTE-BAG",   name: "Canvas Tote Bag",         category: "Merchandise",       price_cents: cents(14.00), tax_class: "standard",  barcode: "0001000100120" },
];

const customers = [
  { id: uid("cus", 1), name: "Ada Lovelace",    email: "ada@example.com",    phone: "555-0101", points: 420,  customer_type: "retail",   daysAgo: 120 },
  { id: uid("cus", 2), name: "Grace Hopper",    email: "grace@example.com",  phone: "555-0102", points: 185,  customer_type: "retail",   daysAgo: 90  },
  { id: uid("cus", 3), name: "Marie Curie",     email: "marie@example.com",  phone: "555-0103", points: 1050, customer_type: "retail",   daysAgo: 180 },
  { id: uid("cus", 4), name: "Rosalind Franklin", email: "rosalind@example.com", phone: "555-0104", points: 60, customer_type: "retail", daysAgo: 14  },
  { id: uid("cus", 5), name: "Hedy Lamarr",     email: "hedy@example.com",   phone: "555-0105", points: 0,    customer_type: "retail",   daysAgo: 5   },
  { id: uid("cus", 6), name: "Dorothy Vaughan", email: "dorothy@example.com",phone: "555-0106", points: 775,  customer_type: "retail",   daysAgo: 200 },
  { id: uid("cus", 7), name: "Tech Hub LLC",    email: "orders@techhub.com", phone: "555-0201", points: 0,    customer_type: "business", daysAgo: 60  },
  { id: uid("cus", 8), name: "Peak Wellness",   email: "cafe@peakwellness.com", phone: "555-0202", points: 0, customer_type: "business", daysAgo: 45  },
];

// 25 orders spanning the last 30 days
interface OrderSpec {
  id: string;
  number: string;
  customerId: string | null;
  status: "completed" | "open" | "voided" | "returned";
  daysAgo: number;
  hoursOffset: number;
  lines: Array<{ productId: string; name: string; qty: number; unitCents: number }>;
  paymentMethod: "cash" | "card" | "split";
}

const orders: OrderSpec[] = [
  {
    id: uid("ord", 1), number: "FP-0001", customerId: uid("cus", 1), status: "completed",
    daysAgo: 28, hoursOffset: 9,
    lines: [
      { productId: uid("prd", 2), name: "Large Latte",      qty: 1, unitCents: cents(5.75) },
      { productId: uid("prd", 7), name: "Butter Croissant", qty: 1, unitCents: cents(3.75) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 2), number: "FP-0002", customerId: uid("cus", 3), status: "completed",
    daysAgo: 27, hoursOffset: 10,
    lines: [
      { productId: uid("prd", 11), name: "House Blend Beans 12oz", qty: 2, unitCents: cents(16.50) },
      { productId: uid("prd", 10), name: "Ceramic Mug 12oz",       qty: 1, unitCents: cents(18.00) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 3), number: "FP-0003", customerId: null, status: "completed",
    daysAgo: 26, hoursOffset: 8,
    lines: [
      { productId: uid("prd", 1), name: "Double Espresso", qty: 1, unitCents: cents(3.50) },
      { productId: uid("prd", 8), name: "Blueberry Muffin", qty: 1, unitCents: cents(3.50) },
    ],
    paymentMethod: "cash",
  },
  {
    id: uid("ord", 4), number: "FP-0004", customerId: uid("cus", 6), status: "completed",
    daysAgo: 25, hoursOffset: 14,
    lines: [
      { productId: uid("prd", 3), name: "Cappuccino",  qty: 2, unitCents: cents(4.50) },
      { productId: uid("prd", 9), name: "Avocado Toast", qty: 1, unitCents: cents(8.50) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 5), number: "FP-0005", customerId: uid("cus", 2), status: "completed",
    daysAgo: 24, hoursOffset: 11,
    lines: [
      { productId: uid("prd", 5), name: "Matcha Latte", qty: 1, unitCents: cents(5.50) },
      { productId: uid("prd", 7), name: "Butter Croissant", qty: 2, unitCents: cents(3.75) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 6), number: "FP-0006", customerId: null, status: "completed",
    daysAgo: 23, hoursOffset: 9,
    lines: [
      { productId: uid("prd", 4), name: "Cold Brew 12oz", qty: 2, unitCents: cents(4.75) },
    ],
    paymentMethod: "cash",
  },
  {
    id: uid("ord", 7), number: "FP-0007", customerId: uid("cus", 7), status: "completed",
    daysAgo: 22, hoursOffset: 10,
    lines: [
      { productId: uid("prd", 11), name: "House Blend Beans 12oz", qty: 5, unitCents: cents(16.50) },
      { productId: uid("prd", 12), name: "Canvas Tote Bag",        qty: 3, unitCents: cents(14.00) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 8), number: "FP-0008", customerId: uid("cus", 1), status: "completed",
    daysAgo: 21, hoursOffset: 8,
    lines: [
      { productId: uid("prd", 2), name: "Large Latte",   qty: 1, unitCents: cents(5.75) },
      { productId: uid("prd", 6), name: "Spiced Chai",   qty: 1, unitCents: cents(5.25) },
      { productId: uid("prd", 8), name: "Blueberry Muffin", qty: 2, unitCents: cents(3.50) },
    ],
    paymentMethod: "split",
  },
  {
    id: uid("ord", 9), number: "FP-0009", customerId: null, status: "completed",
    daysAgo: 20, hoursOffset: 15,
    lines: [
      { productId: uid("prd", 3), name: "Cappuccino", qty: 1, unitCents: cents(4.50) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 10), number: "FP-0010", customerId: uid("cus", 3), status: "completed",
    daysAgo: 18, hoursOffset: 12,
    lines: [
      { productId: uid("prd", 10), name: "Ceramic Mug 12oz",      qty: 2, unitCents: cents(18.00) },
      { productId: uid("prd", 12), name: "Canvas Tote Bag",        qty: 1, unitCents: cents(14.00) },
      { productId: uid("prd", 11), name: "House Blend Beans 12oz", qty: 1, unitCents: cents(16.50) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 11), number: "FP-0011", customerId: uid("cus", 4), status: "completed",
    daysAgo: 16, hoursOffset: 9,
    lines: [
      { productId: uid("prd", 5), name: "Matcha Latte",  qty: 1, unitCents: cents(5.50) },
      { productId: uid("prd", 9), name: "Avocado Toast", qty: 1, unitCents: cents(8.50) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 12), number: "FP-0012", customerId: null, status: "completed",
    daysAgo: 15, hoursOffset: 10,
    lines: [
      { productId: uid("prd", 1), name: "Double Espresso", qty: 3, unitCents: cents(3.50) },
      { productId: uid("prd", 7), name: "Butter Croissant", qty: 3, unitCents: cents(3.75) },
    ],
    paymentMethod: "cash",
  },
  {
    id: uid("ord", 13), number: "FP-0013", customerId: uid("cus", 6), status: "completed",
    daysAgo: 14, hoursOffset: 11,
    lines: [
      { productId: uid("prd", 2), name: "Large Latte",   qty: 2, unitCents: cents(5.75) },
      { productId: uid("prd", 6), name: "Spiced Chai",   qty: 1, unitCents: cents(5.25) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 14), number: "FP-0014", customerId: uid("cus", 8), status: "completed",
    daysAgo: 13, hoursOffset: 13,
    lines: [
      { productId: uid("prd", 4), name: "Cold Brew 12oz", qty: 6, unitCents: cents(4.75) },
      { productId: uid("prd", 8), name: "Blueberry Muffin", qty: 4, unitCents: cents(3.50) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 15), number: "FP-0015", customerId: uid("cus", 5), status: "completed",
    daysAgo: 12, hoursOffset: 9,
    lines: [
      { productId: uid("prd", 3), name: "Cappuccino",       qty: 1, unitCents: cents(4.50) },
      { productId: uid("prd", 10), name: "Ceramic Mug 12oz", qty: 1, unitCents: cents(18.00) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 16), number: "FP-0016", customerId: null, status: "voided",
    daysAgo: 11, hoursOffset: 14,
    lines: [
      { productId: uid("prd", 2), name: "Large Latte", qty: 1, unitCents: cents(5.75) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 17), number: "FP-0017", customerId: uid("cus", 3), status: "completed",
    daysAgo: 10, hoursOffset: 8,
    lines: [
      { productId: uid("prd", 11), name: "House Blend Beans 12oz", qty: 3, unitCents: cents(16.50) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 18), number: "FP-0018", customerId: uid("cus", 1), status: "completed",
    daysAgo: 9, hoursOffset: 10,
    lines: [
      { productId: uid("prd", 2), name: "Large Latte",   qty: 1, unitCents: cents(5.75) },
      { productId: uid("prd", 7), name: "Butter Croissant", qty: 1, unitCents: cents(3.75) },
      { productId: uid("prd", 6), name: "Spiced Chai",   qty: 1, unitCents: cents(5.25) },
    ],
    paymentMethod: "split",
  },
  {
    id: uid("ord", 19), number: "FP-0019", customerId: null, status: "completed",
    daysAgo: 8, hoursOffset: 11,
    lines: [
      { productId: uid("prd", 5), name: "Matcha Latte", qty: 2, unitCents: cents(5.50) },
    ],
    paymentMethod: "cash",
  },
  {
    id: uid("ord", 20), number: "FP-0020", customerId: uid("cus", 2), status: "returned",
    daysAgo: 7, hoursOffset: 16,
    lines: [
      { productId: uid("prd", 9), name: "Avocado Toast", qty: 1, unitCents: cents(8.50) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 21), number: "FP-0021", customerId: uid("cus", 7), status: "completed",
    daysAgo: 6, hoursOffset: 9,
    lines: [
      { productId: uid("prd", 11), name: "House Blend Beans 12oz", qty: 10, unitCents: cents(16.50) },
      { productId: uid("prd", 10), name: "Ceramic Mug 12oz",        qty: 5,  unitCents: cents(18.00) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 22), number: "FP-0022", customerId: uid("cus", 6), status: "completed",
    daysAgo: 4, hoursOffset: 13,
    lines: [
      { productId: uid("prd", 2), name: "Large Latte",       qty: 2, unitCents: cents(5.75) },
      { productId: uid("prd", 3), name: "Cappuccino",        qty: 1, unitCents: cents(4.50) },
      { productId: uid("prd", 8), name: "Blueberry Muffin",  qty: 2, unitCents: cents(3.50) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 23), number: "FP-0023", customerId: null, status: "completed",
    daysAgo: 2, hoursOffset: 8,
    lines: [
      { productId: uid("prd", 4), name: "Cold Brew 12oz", qty: 1, unitCents: cents(4.75) },
      { productId: uid("prd", 7), name: "Butter Croissant", qty: 1, unitCents: cents(3.75) },
    ],
    paymentMethod: "cash",
  },
  {
    id: uid("ord", 24), number: "FP-0024", customerId: uid("cus", 4), status: "completed",
    daysAgo: 1, hoursOffset: 12,
    lines: [
      { productId: uid("prd", 5), name: "Matcha Latte",   qty: 1, unitCents: cents(5.50) },
      { productId: uid("prd", 9), name: "Avocado Toast",  qty: 1, unitCents: cents(8.50) },
      { productId: uid("prd", 12), name: "Canvas Tote Bag", qty: 1, unitCents: cents(14.00) },
    ],
    paymentMethod: "card",
  },
  {
    id: uid("ord", 25), number: "FP-0025", customerId: uid("cus", 1), status: "open",
    daysAgo: 0, hoursOffset: 2,
    lines: [
      { productId: uid("prd", 2), name: "Large Latte",    qty: 1, unitCents: cents(5.75) },
      { productId: uid("prd", 3), name: "Cappuccino",     qty: 1, unitCents: cents(4.50) },
    ],
    paymentMethod: "card",
  },
];

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  // SAFETY: this writes demo commerce data (products, customers, orders) into
  // whatever DATABASE_URL points at. Against a real/production database it
  // pollutes live data. Refuse in production, and require an explicit opt-in
  // everywhere else so a stray run against prod cannot silently seed.
  if (process.env["NODE_ENV"] === "production") {
    console.error("✗ Refusing to seed demo data: NODE_ENV=production. This is a live database.");
    process.exit(1);
  }
  if (process.env["ALLOW_DEMO_SEED"] !== "1") {
    console.error(
      "✗ Refusing to seed demo data.\n" +
        "  This inserts fake products/customers/orders into the target database.\n" +
        "  Set ALLOW_DEMO_SEED=1 ONLY against a disposable dev/demo database — never production.",
    );
    process.exit(1);
  }

  const db = openDb();
  try {
  console.log(`Seeding tenant: ${TENANT_ID}`);

  // ── Categories ──────────────────────────────────────────────────────────────
  console.log(`  Seeding ${categories.length} categories…`);
  for (const c of categories) {
    await db.query(
      `INSERT INTO categories (id, tenant_id, name, parent_id, created_at, updated_at)
       VALUES (@id, @tid, @name, @parentId, @now, @now)
       ON CONFLICT (id) DO NOTHING`,
      { id: c.id, tid: TENANT_ID, name: c.name, parentId: c.parent_id, now: NOW },
    );
  }

  // ── Products ────────────────────────────────────────────────────────────────
  console.log(`  Seeding ${products.length} products…`);
  for (const p of products) {
    await db.query(
      `INSERT INTO products (id, tenant_id, sku, name, price_cents, category, tax_class, barcode, status, created_at, updated_at)
       VALUES (@id, @tid, @sku, @name, @price, @cat, @taxClass, @barcode, 'active', @now, @now)
       ON CONFLICT (id) DO NOTHING`,
      { id: p.id, tid: TENANT_ID, sku: p.sku, name: p.name, price: p.price_cents,
        cat: p.category, taxClass: p.tax_class, barcode: p.barcode, now: NOW },
    );
  }

  // ── Customers ───────────────────────────────────────────────────────────────
  console.log(`  Seeding ${customers.length} customers…`);
  for (const c of customers) {
    const created = ago(c.daysAgo);
    await db.query(
      `INSERT INTO customers (id, tenant_id, name, email, phone, points, customer_type, status, created_at, updated_at)
       VALUES (@id, @tid, @name, @email, @phone, @pts, @type, 'active', @created, @created)
       ON CONFLICT (id) DO NOTHING`,
      { id: c.id, tid: TENANT_ID, name: c.name, email: c.email, phone: c.phone,
        pts: c.points, type: c.customer_type, created },
    );
  }

  // ── Orders + lines + payments ────────────────────────────────────────────────
  console.log(`  Seeding ${orders.length} orders…`);
  for (const o of orders) {
    const createdAt = ago(o.daysAgo, o.hoursOffset);
    const subtotal = o.lines.reduce((s, l) => s + l.qty * l.unitCents, 0);
    const taxCents = Math.round(subtotal * 0.085); // 8.5% tax rate
    const total = subtotal + taxCents;

    // Order
    await db.query(
      `INSERT INTO orders (id, tenant_id, order_number, state_code, status,
                           subtotal_cents, discount_cents, tax_cents, total_cents,
                           customer_id, currency, exchange_rate, created_at, updated_at)
       VALUES (@id, @tid, @num, 'CA', @status,
               @subtotal, 0, @tax, @total,
               @custId, 'USD', 1.0, @now, @now)
       ON CONFLICT (id) DO NOTHING`,
      { id: o.id, tid: TENANT_ID, num: o.number, status: o.status,
        subtotal, tax: taxCents, total, custId: o.customerId ?? null, now: createdAt },
    );

    // Order lines
    for (let i = 0; i < o.lines.length; i++) {
      const l = o.lines[i]!;
      const lineCents = l.qty * l.unitCents;
      const lineTax = Math.round(lineCents * 0.085);
      await db.query(
        `INSERT INTO order_lines (id, tenant_id, order_id, product_id, name, quantity, unit_cents, tax_cents, line_cents, taxable)
         VALUES (@id, @tid, @ordId, @prodId, @name, @qty, @unit, @tax, @line, 1)
         ON CONFLICT (id) DO NOTHING`,
        { id: `${o.id}_ln${i + 1}`, tid: TENANT_ID, ordId: o.id, prodId: l.productId,
          name: l.name, qty: l.qty, unit: l.unitCents, tax: lineTax, line: lineCents },
      );
    }

    // Payment (only for non-voided/non-open orders)
    if (o.status !== "open" && o.status !== "voided") {
      const method = o.paymentMethod;
      const cashCents = method === "cash" ? total : method === "split" ? Math.ceil(total * 0.5) : 0;
      const cardCents = total - cashCents;
      await db.query(
        `INSERT INTO payments (id, tenant_id, order_id, method, amount_cents,
                               cash_cents, card_cents, change_cents, status, created_at)
         VALUES (@id, @tid, @ordId, @method, @amount,
                 @cash, @card, @change, 'captured', @now)
         ON CONFLICT (id) DO NOTHING`,
        { id: `${o.id}_pay`, tid: TENANT_ID, ordId: o.id,
          method, amount: total, cash: cashCents, card: cardCents,
          change: method === "cash" ? Math.max(0, cashCents - total) : 0,
          now: createdAt + 60_000 },
      );
    }
  }

  console.log(`\nSeed complete for tenant ${TENANT_ID}.`);
  console.log(`  Products: ${products.length}`);
  console.log(`  Customers: ${customers.length}`);
  console.log(`  Orders: ${orders.length} (${orders.filter(o => o.status === "completed").length} completed, ${orders.filter(o => o.status === "open").length} open)`);
  console.log(`\nLogin: owner@finder-pos.dev / FinderDemo!2026`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
