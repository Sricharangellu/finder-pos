import type { DB } from "../../shared/db.js";
import { badRequest } from "../../shared/http.js";

/** Tenant-scoped sales analytics. Read-only over the orders + order_lines +
 *  payments tables (a lightweight read model / CQRS-lite — reports owns no
 *  tables of its own). Supports a time window via `sinceMs` (epoch ms). */

export interface EndOfDayReport {
  date: string;
  businessDate: string;
  openedAt: number | null;
  closedAt: number | null;
  status: string;
  transactions: { count: number; voidCount: number; refundCount: number; averageTicket_cents: number };
  sales: {
    grossSales_cents: number;
    discounts_cents: number;
    refunds_cents: number;
    netSales_cents: number;
    taxCollected_cents: number;
    totalCollected_cents: number;
  };
  tenders: Array<{ method: string; count: number; total_cents: number }>;
  topItems: Array<{ productId: string; productName: string; quantitySold: number; total_cents: number }>;
  cashDrawer: {
    openingFloat_cents: number;
    cashSales_cents: number;
    cashRefunds_cents: number;
    expectedCash_cents: number;
    actualCash_cents: number | null;
    variance_cents: number | null;
  };
}

export interface SalesSummary {
  orders: { open: number; completed: number; refunded: number; voided: number; total: number };
  revenue: { grossCents: number; taxCents: number; netCents: number };
  payments: { capturedCount: number; capturedCents: number; byMethod: Record<string, number> };
  /** FE-41: Implementation Prompt §4.1 spec KPIs */
  kpi: {
    saleCount: number;
    grossProfitCents: number;
    customerCount: number;
    avgSaleValueCents: number;
    avgItemsPerSale: number;
    discountedAmountCents: number;
    discountedPct: number;          // 0–100
  };
  /** Sparkline points (last 8 daily buckets) for each KPI */
  sparklines: {
    revenue: number[];
    saleCount: number[];
  };
}

export interface TopProduct {
  productId: string;
  name: string;
  units: number;
  revenueCents: number;
}

export interface HourlyBucket {
  hour: number;        // 0–23 (UTC)
  label: string;       // "8 AM"
  orderCount: number;
  revenueCents: number;
  value: number;       // 0–100 index relative to the busiest hour
}

export interface TrendDay {
  date: string;          // "YYYY-MM-DD"
  label: string;         // "Mon", "Jun 18", etc.
  revenueCents: number;
  orderCount: number;
}

function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

export interface AgingRow {
  partyId: string; // customer_id (AR) or supplier_id (AP)
  buckets: AgingBuckets;
}

export interface AgingReport {
  totals: AgingBuckets;
  parties: AgingRow[];
}

export interface SalesByGroup {
  key: string;
  name: string;
  units: number;
  revenueCents: number;
}

export interface SalesByRepRow {
  repId: string;
  repName: string;
  totalCents: number;
  orderCount: number;
}

export interface SalesByVendorRow {
  vendorId: string;
  vendorName: string;
  totalCents: number;
  qty: number;
}

export interface PnlReport {
  revenueCents: number;          // gross from completed orders
  cogsCents: number;             // sum(cost_cents * qty) from order_lines via product_costs
  grossProfitCents: number;      // revenue − COGS
  operatingExpensesCents: number; // sum of expense account line items (from accounts)
  netIncomeCents: number;        // grossProfit − operatingExpenses
}

export interface ValuationRow {
  productId: string;
  name: string;
  stockQty: number;
  costCents: number;
  retailCents: number;
  costValueCents: number;
  retailValueCents: number;
}

export interface Valuation {
  rows: ValuationRow[];
  totalCostCents: number;
  totalRetailCents: number;
}

export interface SalesByProductItem {
  productId: string;
  sku: string;
  name: string;
  category: string;
  units: number;
  revenueCents: number;
  costCents: number;
  marginPct: number;
}

export interface MarginByCategoryItem {
  category: string;
  revenueCents: number;
  costCents: number;
  marginPct: number;
  units: number;
}

const emptyBuckets = (): AgingBuckets => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 });

/** Place an outstanding balance into an aging bucket by days overdue. */
function addToBucket(b: AgingBuckets, balance: number, dueDate: number | null, now: number): void {
  const daysOverdue = dueDate ? Math.floor((now - dueDate) / 86_400_000) : 0;
  if (daysOverdue <= 0) b.current += balance;
  else if (daysOverdue <= 30) b.d1_30 += balance;
  else if (daysOverdue <= 60) b.d31_60 += balance;
  else if (daysOverdue <= 90) b.d61_90 += balance;
  else b.d90_plus += balance;
  b.total += balance;
}

export interface RetailProofSignal {
  code: string;
  severity: "info" | "warning" | "critical";
  count: number;
  message: string;
}

/** A ranked, actionable recommendation derived from a retail-proof signal. */
export type RecommendationCategory = "setup" | "inventory" | "pricing" | "sales" | "expenses" | "profit";

export interface Recommendation {
  id: string;                       // stable, e.g. "rec_no_products"
  signalCode: string | null;        // source retail-proof signal, or null when derived from metrics
  category: RecommendationCategory;
  severity: "info" | "warning" | "critical";
  title: string;                    // short imperative label
  detail: string;                   // human explanation (the signal message)
  action: string;                   // the concrete next step to take
  href: string;                     // where in the app to act
  count: number;                    // affected entities (0 when not applicable)
  rank: number;                     // 1-based position after deterministic ordering (1 = most urgent)
}

export interface RecommendationReport {
  ready: boolean;                   // mirrors retail-proof readiness
  recommendations: Recommendation[];// ranked, most urgent first
  summary: { total: number; critical: number; warning: number; info: number };
  generatedAt: number;
  recentDays: number;
}

export interface RetailProof {
  ready: boolean;
  setup: {
    outlet: boolean; register: boolean; taxRate: boolean; paymentModes: boolean;
    receipt: boolean; firstProduct: boolean; firstReceiving: boolean;
    completed: number; total: number;
  };
  metrics: {
    productCount: number; activeProductCount: number; productsWithoutCost: number;
    totalStockUnits: number; lowStockCount: number; outOfStockCount: number;
    orderCount: number; revenueCents: number; cogsCents: number; grossProfitCents: number;
    expensesCents: number; netProfitCents: number;
    grossMarginPct: number | null; netMarginPct: number | null;
    productsNeverSold: number; productsNoRecentSales: number;
  };
  signals: RetailProofSignal[];
  expenses: { available: boolean; totalCents: number; count: number; uncategorizedCount: number; note?: string };
  generatedAt: number;
  recentDays: number;
}

/**
 * Deterministic recommendation playbook (NOT AI — see AGENTS.md AI rules).
 * Each retail-proof signal maps to an actionable recommendation: what to do and
 * where. Signals with no entry here are informational only and are not surfaced
 * as recommendations. Derived (non-signal) recommendations use the `null` code
 * and are keyed by their own id.
 */
const RECO_PLAYBOOK: Record<string, { category: RecommendationCategory; title: string; action: string; href: string }> = {
  no_products:           { category: "setup",     title: "Add your products",          action: "Add or import products so the register has something to sell.",        href: "/catalog" },
  setup_incomplete:      { category: "setup",     title: "Finish store setup",         action: "Complete the remaining setup tasks to get ready to sell.",             href: "/onboarding" },
  products_without_cost: { category: "pricing",   title: "Set cost prices",            action: "Add cost prices so gross profit and margin can be measured.",          href: "/catalog" },
  out_of_stock:          { category: "inventory", title: "Restock out-of-stock items", action: "Receive stock for products that are out of stock.",                    href: "/inventory" },
  negative_net_profit:   { category: "profit",    title: "Fix negative net profit",    action: "Raise margins or cut expenses — spending is outpacing gross profit.",  href: "/reports" },
  thin_margin:           { category: "pricing",   title: "Improve thin margin",        action: "Review pricing or supplier costs to lift a low gross margin.",         href: "/reports" },
  low_stock:             { category: "inventory", title: "Reorder low stock",          action: "Reorder products at or below their reorder point.",                    href: "/inventory" },
  no_sales_yet:          { category: "sales",     title: "Record your first sale",     action: "Ring up a sale at the register to start measuring performance.",       href: "/terminal" },
  products_never_sold:   { category: "sales",     title: "Review never-sold products", action: "Promote, reprice, or discontinue products that have never sold.",       href: "/catalog" },
  slow_movers:           { category: "sales",     title: "Clear slow movers",          action: "Discount or clear stock that has not sold recently.",                  href: "/catalog" },
  uncategorized_expenses:{ category: "expenses",  title: "Categorize expenses",        action: "Assign categories to expenses for accurate profit reporting.",         href: "/finance" },
};

/** Severity ordering (lower = more urgent) and a stable in-severity precedence. */
const SEVERITY_RANK: Record<Recommendation["severity"], number> = { critical: 0, warning: 1, info: 2 };
const CODE_ORDER = [
  "no_products", "setup_incomplete", "products_without_cost", "out_of_stock",
  "negative_net_profit", "thin_margin", "low_stock", "no_sales_yet",
  "products_never_sold", "slow_movers", "uncategorized_expenses",
];
/** Gross margin (%) at or below which a "thin margin" recommendation is raised. */
const THIN_MARGIN_PCT = 15;

export class ReportsService {
  constructor(private readonly db: DB) {}

  async salesSummary(tenantId: string, sinceMs?: number): Promise<SalesSummary> {
    const since = sinceMs ?? 0;
    const orderRows = await this.db.query<{ status: string; n: number }>(
      "SELECT status, COUNT(*)::int AS n FROM orders WHERE tenant_id = @tenantId AND created_at >= @since GROUP BY status",
      { tenantId, since },
    );
    const orders = { open: 0, completed: 0, refunded: 0, voided: 0, total: 0 };
    for (const r of orderRows) {
      const n = Number(r.n);
      if (r.status in orders) (orders as Record<string, number>)[r.status] = n;
      orders.total += n;
    }

    const rev = await this.db.one<{ gross: number; tax: number }>(
      `SELECT COALESCE(SUM(total_cents), 0) AS gross, COALESCE(SUM(tax_cents), 0) AS tax
         FROM orders WHERE tenant_id = @tenantId AND status = 'completed' AND created_at >= @since`,
      { tenantId, since },
    );
    const grossCents = Number(rev?.gross ?? 0);
    const taxCents = Number(rev?.tax ?? 0);

    const payRows = await this.db.query<{ method: string; amt: number; n: number }>(
      `SELECT method, COALESCE(SUM(amount_cents), 0) AS amt, COUNT(*)::int AS n
         FROM payments WHERE tenant_id = @tenantId AND status = 'captured' AND created_at >= @since
        GROUP BY method`,
      { tenantId, since },
    );
    const byMethod: Record<string, number> = {};
    let capturedCount = 0;
    let capturedCents = 0;
    for (const r of payRows) {
      byMethod[r.method] = Number(r.amt);
      capturedCount += Number(r.n);
      capturedCents += Number(r.amt);
    }

    // FE-41 spec KPIs from Implementation Prompt §4.1
    // Two simple queries: order-level aggregates + line-item count.
    const kpiRow = await this.db.one<{
      sale_count: number;
      customer_count: number;
      discounted_cents: number;
    }>(
      `SELECT
         COUNT(*)::int                     AS sale_count,
         COUNT(DISTINCT customer_id)::int  AS customer_count,
         COALESCE(SUM(discount_cents), 0)  AS discounted_cents
       FROM orders
       WHERE tenant_id = @tenantId AND status = 'completed' AND created_at >= @since`,
      { tenantId, since },
    );

    const discountedOrdersRow = await this.db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM orders
       WHERE tenant_id = @tenantId AND status = 'completed'
         AND created_at >= @since AND discount_cents > 0`,
      { tenantId, since },
    );

    const itemRow = await this.db.one<{ total_items: number }>(
      `SELECT COALESCE(SUM(ol.quantity), 0)::int AS total_items
       FROM order_lines ol
       JOIN orders o ON o.id = ol.order_id AND o.tenant_id = ol.tenant_id
       WHERE ol.tenant_id = @tenantId AND o.status = 'completed' AND o.created_at >= @since`,
      { tenantId, since },
    );

    const saleCount = Number(kpiRow?.sale_count ?? 0);
    const customerCount = Number(kpiRow?.customer_count ?? 0);
    const totalItems = Number(itemRow?.total_items ?? 0);
    const discountedCents = Number(kpiRow?.discounted_cents ?? 0);
    const discountedOrders = Number(discountedOrdersRow?.n ?? 0);
    const avgSaleValueCents = saleCount > 0 ? Math.round(grossCents / saleCount) : 0;
    const avgItemsPerSale = saleCount > 0 ? Math.round((totalItems / saleCount) * 10) / 10 : 0;
    const discountedPct = saleCount > 0 ? Math.round((discountedOrders / saleCount) * 1000) / 10 : 0;

    // DB-9: CQRS sparklines — read from daily_sales_summary (pre-aggregated).
    // Uses pre-computed ISO date string for comparison (avoids to_char/to_timestamp
    // which behaves differently on embedded-postgres vs production Postgres 16).
    const sparkStartDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const sparkRows = await this.db.query<{ day: string; rev: number; cnt: number }>(
      `SELECT
         summary_date        AS day,
         gross_sales_cents   AS rev,
         transaction_count   AS cnt
       FROM daily_sales_summary
       WHERE tenant_id = @tenantId
         AND summary_date >= @sparkStartDate
       ORDER BY summary_date ASC LIMIT 8`,
      { tenantId, sparkStartDate },
    );
    const sparkRevenue = sparkRows.map((r) => Number(r.rev));
    const sparkSaleCount = sparkRows.map((r) => Number(r.cnt));

    return {
      orders,
      revenue: { grossCents, taxCents, netCents: grossCents - taxCents },
      payments: { capturedCount, capturedCents, byMethod },
      kpi: {
        saleCount,
        grossProfitCents: grossCents, // full COGS tracking deferred to DB-14
        customerCount,
        avgSaleValueCents,
        avgItemsPerSale,
        discountedAmountCents: discountedCents,
        discountedPct,
      },
      sparklines: { revenue: sparkRevenue, saleCount: sparkSaleCount },
    };
  }

  /** Best-selling products by revenue from completed orders in the window. */
  async topProducts(tenantId: string, sinceMs?: number, limit = 10): Promise<TopProduct[]> {
    const since = sinceMs ?? 0;
    const lim = Math.min(Math.max(limit, 1), 50);
    const rows = await this.db.query<{ product_id: string; name: string; units: number; revenue: number }>(
      `SELECT ol.product_id, MAX(ol.name) AS name,
              SUM(ol.quantity)::int AS units,
              SUM(ol.line_cents) AS revenue
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id AND o.tenant_id = ol.tenant_id
        WHERE ol.tenant_id = @tenantId AND o.status = 'completed' AND o.created_at >= @since
        GROUP BY ol.product_id
        ORDER BY revenue DESC
        LIMIT @limit`,
      { tenantId, since, limit: lim },
    );
    return rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      units: Number(r.units),
      revenueCents: Number(r.revenue),
    }));
  }

  /** Sales bucketed by hour-of-day (UTC) from completed orders in the window.
   *  Returns all 24 hours; `value` is a 0–100 index vs the busiest hour. */
  async hourly(tenantId: string, sinceMs?: number): Promise<HourlyBucket[]> {
    const since = sinceMs ?? 0;
    const rows = await this.db.query<{ hour: number; orders: number; revenue: number }>(
      `SELECT EXTRACT(HOUR FROM to_timestamp(created_at / 1000.0))::int AS hour,
              COUNT(*)::int AS orders,
              COALESCE(SUM(total_cents), 0) AS revenue
         FROM orders
        WHERE tenant_id = @tenantId AND status = 'completed' AND created_at >= @since
        GROUP BY hour`,
      { tenantId, since },
    );
    const byHour = new Map<number, { orders: number; revenue: number }>();
    let max = 0;
    for (const r of rows) {
      const revenue = Number(r.revenue);
      byHour.set(Number(r.hour), { orders: Number(r.orders), revenue });
      if (revenue > max) max = revenue;
    }
    return Array.from({ length: 24 }, (_, hour) => {
      const b = byHour.get(hour) ?? { orders: 0, revenue: 0 };
      return {
        hour,
        label: hourLabel(hour),
        orderCount: b.orders,
        revenueCents: b.revenue,
        value: max > 0 ? Math.round((b.revenue / max) * 100) : 0,
      };
    });
  }

  /** Accounts Receivable aging — open invoice balances bucketed by days overdue. */
  async arAging(tenantId: string, now = Date.now()): Promise<AgingReport> {
    const rows = await this.db.query<{ customer_id: string; balance: number; due_date: number | null }>(
      `SELECT customer_id, (total_cents - paid_cents) AS balance, due_date
         FROM invoices
        WHERE tenant_id = @t AND status <> 'void' AND (total_cents - paid_cents) > 0`,
      { t: tenantId },
    );
    return this.buildAging(rows.map((r) => ({ partyId: r.customer_id, balance: Number(r.balance), dueDate: r.due_date })), now);
  }

  /** Dunning sweep: set dunning_level (1/2/3) on overdue open/partial invoices.
   *  Same bucketing as billing's runDunning; returns the number of rows whose
   *  level changed (the frontend's sweep-button contract). */
  async sweepArAging(tenantId: string, now = Date.now()): Promise<{ updated: number }> {
    const DAY = 86_400_000;
    const overdue = await this.db.query<{ id: string; due_date: number; dunning_level: number }>(
      `SELECT id, due_date, dunning_level FROM invoices
        WHERE tenant_id = @t
          AND status IN ('open', 'partial')
          AND due_date IS NOT NULL
          AND due_date < @now`,
      { t: tenantId, now },
    );
    let updated = 0;
    for (const inv of overdue) {
      const daysOverdue = Math.floor((now - Number(inv.due_date)) / DAY);
      const level = daysOverdue >= 90 ? 3 : daysOverdue >= 60 ? 2 : 1;
      if (Number(inv.dunning_level) === level) continue;
      await this.db.query(
        "UPDATE invoices SET dunning_level = @level WHERE id = @id AND tenant_id = @t",
        { level, id: inv.id, t: tenantId },
      );
      updated++;
    }
    return { updated };
  }

  /** Accounts Payable aging — open supplier bill balances bucketed by days overdue. */
  async apAging(tenantId: string, now = Date.now()): Promise<AgingReport> {
    const rows = await this.db.query<{ supplier_id: string; balance: number; due_date: number | null }>(
      `SELECT supplier_id, (total_cents - paid_cents) AS balance, due_date
         FROM bills
        WHERE tenant_id = @t AND status <> 'void' AND (total_cents - paid_cents) > 0`,
      { t: tenantId },
    );
    return this.buildAging(rows.map((r) => ({ partyId: r.supplier_id, balance: Number(r.balance), dueDate: r.due_date })), now);
  }

  private buildAging(rows: Array<{ partyId: string; balance: number; dueDate: number | null }>, now: number): AgingReport {
    const totals = emptyBuckets();
    const byParty = new Map<string, AgingBuckets>();
    for (const r of rows) {
      if (!byParty.has(r.partyId)) byParty.set(r.partyId, emptyBuckets());
      addToBucket(byParty.get(r.partyId)!, r.balance, r.dueDate, now);
      addToBucket(totals, r.balance, r.dueDate, now);
    }
    return { totals, parties: Array.from(byParty, ([partyId, buckets]) => ({ partyId, buckets })).sort((a, b) => b.buckets.total - a.buckets.total) };
  }

  /** Revenue + units grouped by product category (completed orders in window). */
  async salesByCategory(tenantId: string, sinceMs?: number): Promise<SalesByGroup[]> {
    const since = sinceMs ?? 0;
    const rows = await this.db.query<{ key: string; units: number; revenue: number }>(
      `SELECT COALESCE(p.category, 'Uncategorized') AS key,
              SUM(ol.quantity)::int AS units, SUM(ol.line_cents) AS revenue
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id AND o.tenant_id = ol.tenant_id
         LEFT JOIN products p ON p.id = ol.product_id AND p.tenant_id = ol.tenant_id
        WHERE ol.tenant_id = @t AND o.status = 'completed' AND o.created_at >= @since
        GROUP BY key ORDER BY revenue DESC`,
      { t: tenantId, since },
    );
    return rows.map((r) => ({ key: r.key, name: r.key, units: Number(r.units), revenueCents: Number(r.revenue) }));
  }

  /** Revenue + order units grouped by customer (completed orders in window). */
  async salesByCustomer(tenantId: string, sinceMs?: number): Promise<SalesByGroup[]> {
    const since = sinceMs ?? 0;
    const rows = await this.db.query<{ key: string; name: string; units: number; revenue: number }>(
      `SELECT o.customer_id AS key, COALESCE(MAX(c.name), 'Walk-in') AS name,
              COUNT(*)::int AS units, SUM(o.total_cents) AS revenue
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
        WHERE o.tenant_id = @t AND o.status = 'completed' AND o.created_at >= @since AND o.customer_id IS NOT NULL
        GROUP BY o.customer_id ORDER BY revenue DESC`,
      { t: tenantId, since },
    );
    return rows.map((r) => ({ key: r.key, name: r.name, units: Number(r.units), revenueCents: Number(r.revenue) }));
  }

  /** Revenue + order count grouped by sales rep (completed orders in window). */
  async salesByRep(tenantId: string, sinceMs?: number): Promise<SalesByRepRow[]> {
    const since = sinceMs ?? 0;
    const rows = await this.db.query<{ rep_id: string; rep_name: string; total: number; order_count: number }>(
      `SELECT o.sales_rep_id AS rep_id,
              COALESCE(MAX(u.name), o.sales_rep_id) AS rep_name,
              COALESCE(SUM(o.total_cents), 0) AS total,
              COUNT(*)::int AS order_count
         FROM orders o
         LEFT JOIN users u ON u.id = o.sales_rep_id AND u.tenant_id = o.tenant_id
        WHERE o.tenant_id = @tenantId AND o.status = 'completed' AND o.created_at >= @since
          AND o.sales_rep_id IS NOT NULL
        GROUP BY o.sales_rep_id
        ORDER BY total DESC`,
      { tenantId, since },
    );
    return rows.map((r) => ({
      repId: r.rep_id,
      repName: r.rep_name ?? r.rep_id,
      totalCents: Number(r.total),
      orderCount: Number(r.order_count),
    }));
  }

  /** Revenue + qty grouped by vendor/supplier (via products.preferred_vendor_id, completed orders). */
  async salesByVendor(tenantId: string, sinceMs?: number): Promise<SalesByVendorRow[]> {
    const since = sinceMs ?? 0;
    const rows = await this.db.query<{ vendor_id: string; vendor_name: string; total: number; qty: number }>(
      `SELECT p.preferred_vendor_id AS vendor_id,
              COALESCE(MAX(s.name), p.preferred_vendor_id) AS vendor_name,
              COALESCE(SUM(ol.line_cents), 0) AS total,
              SUM(ol.quantity)::int AS qty
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id AND o.tenant_id = ol.tenant_id
         LEFT JOIN products p ON p.id = ol.product_id AND p.tenant_id = ol.tenant_id
         LEFT JOIN suppliers s ON s.id = p.preferred_vendor_id AND s.tenant_id = ol.tenant_id
        WHERE ol.tenant_id = @tenantId AND o.status = 'completed' AND o.created_at >= @since
          AND p.preferred_vendor_id IS NOT NULL
        GROUP BY p.preferred_vendor_id
        ORDER BY total DESC`,
      { tenantId, since },
    );
    return rows.map((r) => ({
      vendorId: r.vendor_id,
      vendorName: r.vendor_name ?? r.vendor_id,
      totalCents: Number(r.total),
      qty: Number(r.qty),
    }));
  }

  /** Profit & Loss: revenue, COGS, gross profit, operating expenses, net income. */
  async pnl(tenantId: string, sinceMs?: number, untilMs?: number): Promise<PnlReport> {
    const since = sinceMs ?? 0;
    const until = untilMs ?? Date.now();

    // Revenue: gross from completed orders in the window.
    const revRow = await this.db.one<{ revenue: number }>(
      `SELECT COALESCE(SUM(total_cents), 0) AS revenue
         FROM orders
        WHERE tenant_id = @tenantId AND status = 'completed'
          AND created_at >= @since AND created_at <= @until`,
      { tenantId, since, until },
    );
    const revenueCents = Number(revRow?.revenue ?? 0);

    // COGS: sum(cost_cents * qty) joining order_lines to product_costs.
    const cogsRow = await this.db.one<{ cogs: number }>(
      `SELECT COALESCE(SUM(pc.cost_cents * ol.quantity), 0) AS cogs
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id AND o.tenant_id = ol.tenant_id
         LEFT JOIN product_costs pc ON pc.product_id = ol.product_id AND pc.tenant_id = ol.tenant_id
        WHERE ol.tenant_id = @tenantId AND o.status = 'completed'
          AND o.created_at >= @since AND o.created_at <= @until`,
      { tenantId, since, until },
    );
    const cogsCents = Number(cogsRow?.cogs ?? 0);

    // Operating expenses: accounts of type 'expense' (chart of accounts).
    // We use the sum of all expense account balances — approximated as bills
    // issued in the window. If no bills table is available, defaults to 0.
    let operatingExpensesCents = 0;
    try {
      const expRow = await this.db.one<{ expenses: number }>(
        `SELECT COALESCE(SUM(total_cents), 0) AS expenses
           FROM bills
          WHERE tenant_id = @tenantId AND status <> 'void'
            AND issued_at >= @since AND issued_at <= @until`,
        { tenantId, since, until },
      );
      operatingExpensesCents = Number(expRow?.expenses ?? 0);
    } catch {
      // bills table may not exist in all deployments; default to 0.
    }

    const grossProfitCents = revenueCents - cogsCents;
    const netIncomeCents = grossProfitCents - operatingExpensesCents;

    return { revenueCents, cogsCents, grossProfitCents, operatingExpensesCents, netIncomeCents };
  }

  /** Inventory valuation at cost and retail (on-hand qty × cost / price). */
  async inventoryValuation(tenantId: string): Promise<Valuation> {
    const rows = await this.db.query<{ product_id: string; name: string; stock_qty: number; cost_cents: number | null; price_cents: number | null }>(
      `SELECT i.product_id, COALESCE(p.name, i.product_id) AS name, i.stock_qty,
              pc.cost_cents, p.price_cents
         FROM inventory i
         LEFT JOIN products p ON p.id = i.product_id AND p.tenant_id = i.tenant_id
         LEFT JOIN product_costs pc ON pc.product_id = i.product_id AND pc.tenant_id = i.tenant_id
        WHERE i.tenant_id = @t AND i.stock_qty > 0
        ORDER BY i.stock_qty DESC`,
      { t: tenantId },
    );
    let totalCost = 0, totalRetail = 0;
    const out: ValuationRow[] = rows.map((r) => {
      const qty = Number(r.stock_qty);
      const cost = Number(r.cost_cents ?? 0);
      const retail = Number(r.price_cents ?? 0);
      const costValue = cost * qty;
      const retailValue = retail * qty;
      totalCost += costValue; totalRetail += retailValue;
      return { productId: r.product_id, name: r.name, stockQty: qty, costCents: cost, retailCents: retail, costValueCents: costValue, retailValueCents: retailValue };
    });
    return { rows: out, totalCostCents: totalCost, totalRetailCents: totalRetail };
  }

  // ── Revenue trend ────────────────────────────────────────────────────────────

  async revenueTrend(tenantId: string, days: 7 | 30 | 90): Promise<TrendDay[]> {
    const since = Date.now() - days * 86_400_000;
    const rows = await this.db.query<{ day: string; revenue: number; cnt: number }>(
      `SELECT to_char(to_timestamp(created_at / 1000.0), 'YYYY-MM-DD') AS day,
              COALESCE(SUM(total_cents), 0) AS revenue,
              COUNT(*)::int AS cnt
         FROM orders
        WHERE tenant_id = @tenantId AND status = 'completed' AND created_at >= @since
        GROUP BY day ORDER BY day`,
      { tenantId, since },
    );
    const byDay = new Map(rows.map((r) => [r.day, { revenueCents: Number(r.revenue), orderCount: Number(r.cnt) }]));
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      const entry = byDay.get(key) ?? { revenueCents: 0, orderCount: 0 };
      const label = days <= 7
        ? d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      return { date: key, label, revenueCents: entry.revenueCents, orderCount: entry.orderCount };
    });
  }

  async salesByProduct(tenantId: string, sinceMs?: number, limit = 20): Promise<SalesByProductItem[]> {
    const since = sinceMs ?? 0;
    const rows = await this.db.query<{
      product_id: string; sku: string; name: string; category: string;
      units: number; revenue: number; cost: number;
    }>(
      `SELECT ol.product_id,
              COALESCE(p.sku, '') AS sku,
              COALESCE(p.name, 'Unknown') AS name,
              COALESCE(p.category, 'Uncategorized') AS category,
              SUM(ol.quantity)::int AS units,
              SUM(ol.unit_price_cents * ol.quantity)::bigint AS revenue,
              SUM(COALESCE(p.cost_cents, 0) * ol.quantity)::bigint AS cost
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         LEFT JOIN products p ON p.id = ol.product_id
        WHERE o.tenant_id = @tenantId AND o.status = 'completed' AND o.created_at >= @since
        GROUP BY ol.product_id, p.sku, p.name, p.category
        ORDER BY revenue DESC
        LIMIT @limit`,
      { tenantId, since, limit }
    );
    return rows.map((r) => {
      const rev = Number(r.revenue);
      const cost = Number(r.cost);
      const marginPct = rev > 0 ? Math.round(((rev - cost) / rev) * 1000) / 10 : 0;
      return { productId: r.product_id, sku: r.sku, name: r.name, category: r.category,
               units: Number(r.units), revenueCents: rev, costCents: cost, marginPct };
    });
  }

  async marginByCategory(tenantId: string, sinceMs?: number): Promise<MarginByCategoryItem[]> {
    const since = sinceMs ?? 0;
    const rows = await this.db.query<{
      category: string; revenue: number; cost: number; units: number;
    }>(
      `SELECT COALESCE(p.category, 'Uncategorized') AS category,
              SUM(ol.unit_price_cents * ol.quantity)::bigint AS revenue,
              SUM(COALESCE(p.cost_cents, 0) * ol.quantity)::bigint AS cost,
              SUM(ol.quantity)::int AS units
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         LEFT JOIN products p ON p.id = ol.product_id
        WHERE o.tenant_id = @tenantId AND o.status = 'completed' AND o.created_at >= @since
        GROUP BY COALESCE(p.category, 'Uncategorized')
        ORDER BY revenue DESC`,
      { tenantId, since }
    );
    return rows.map((r) => {
      const rev = Number(r.revenue);
      const cost = Number(r.cost);
      const marginPct = rev > 0 ? Math.round(((rev - cost) / rev) * 1000) / 10 : 0;
      return { category: r.category, revenueCents: rev, costCents: cost, marginPct, units: Number(r.units) };
    });
  }

  async aggregateDailySales(tenantId: string, date: string): Promise<{ date: string; grossSalesCents: number; netSalesCents: number; taxCents: number; transactionCount: number }> {
    const startOfDay = new Date(`${date}T00:00:00Z`).getTime();
    const endOfDay = startOfDay + 86_400_000;
    const row = await this.db.one<{ gross: number; net: number; tax: number; cnt: number; discounts: number }>(
      `SELECT COALESCE(SUM(total_cents), 0) AS gross,
              COALESCE(SUM(total_cents - tax_cents), 0) AS net,
              COALESCE(SUM(tax_cents), 0) AS tax,
              COUNT(*)::int AS cnt,
              COALESCE(SUM(discount_cents), 0) AS discounts
         FROM orders
        WHERE tenant_id = @tenantId AND status = 'completed' AND created_at >= @start AND created_at < @end`,
      { tenantId, start: startOfDay, end: endOfDay }
    );
    return {
      date,
      grossSalesCents: Number(row?.gross ?? 0),
      netSalesCents: Number(row?.net ?? 0),
      taxCents: Number(row?.tax ?? 0),
      transactionCount: Number(row?.cnt ?? 0),
    };
  }

  // ── BE-40: Time Cards report ──────────────────────────────────────────────

  async timeCardsReport(
    tenantId: string,
    opts: { employeeId?: string; from?: number; to?: number },
  ) {
    const since = opts.from ?? (Date.now() - 30 * 86_400_000);
    const until = opts.to ?? Date.now();
    const where: string[] = [
      "te.tenant_id = @tenantId",
      "te.clock_in >= @since",
      "te.clock_in <= @until",
    ];
    const params: Record<string, unknown> = { tenantId, since, until };
    if (opts.employeeId) { where.push("te.employee_id = @employeeId"); params.employeeId = opts.employeeId; }

    const entries = await this.db.query<{
      employee_id: string;
      employee_name: string;
      clock_in: number;
      clock_out: number | null;
      break_minutes: number;
      worked_minutes: number | null;
    }>(
      `SELECT
         te.employee_id,
         e.name AS employee_name,
         te.clock_in,
         te.clock_out,
         te.break_minutes,
         CASE WHEN te.clock_out IS NOT NULL
              THEN (te.clock_out - te.clock_in) / 60000 - te.break_minutes
              ELSE NULL END AS worked_minutes
       FROM time_entries te
       JOIN employees e ON e.id = te.employee_id AND e.tenant_id = te.tenant_id
       WHERE ${where.join(" AND ")}
       ORDER BY te.clock_in ASC LIMIT 500`,
      params,
    );

    // Aggregate total hours per employee
    const totals = new Map<string, { name: string; totalMinutes: number; entries: number }>();
    for (const e of entries) {
      const rec = totals.get(e.employee_id) ?? { name: e.employee_name, totalMinutes: 0, entries: 0 };
      rec.totalMinutes += Number(e.worked_minutes ?? 0);
      rec.entries++;
      totals.set(e.employee_id, rec);
    }

    const summary = Array.from(totals.entries()).map(([employeeId, rec]) => ({
      employeeId,
      employeeName: rec.name,
      totalHours: Math.round((rec.totalMinutes / 60) * 10) / 10,
      entryCount: rec.entries,
    }));

    return { entries, summary };
  }

  // ── BE-36: Register Closures ───────────────────────────────────────────────

  async registerClosures(
    tenantId: string,
    opts: { registerId?: string; from?: number; to?: number; limit: number },
  ) {
    const where: string[] = ["rs.tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (opts.registerId) { where.push("rs.register_id = @registerId"); params["registerId"] = opts.registerId; }
    if (opts.from) { where.push("rs.opened_at >= @from"); params["from"] = opts.from; }
    if (opts.to)   { where.push("rs.opened_at <= @to");   params["to"] = opts.to; }
    params["limit"] = opts.limit;

    return this.db.query(
      `SELECT
         rs.id, rs.register_id, rs.opened_by, rs.opening_float_cents,
         rs.closing_float_cents, rs.counted_cash_cents, rs.variance_cents,
         rs.status, rs.opened_at, rs.closed_at,
         o.name AS outlet_name, r.name AS register_name
       FROM register_sessions rs
       LEFT JOIN registers r ON r.id = rs.register_id AND r.tenant_id = rs.tenant_id
       LEFT JOIN outlets   o ON o.id = r.outlet_id   AND o.tenant_id = rs.tenant_id
       WHERE ${where.join(" AND ")}
       ORDER BY rs.opened_at DESC
       LIMIT @limit`,
      params,
    );
  }

  async registerClosureDetail(tenantId: string, sessionId: string) {
    const session = await this.db.one(
      `SELECT rs.*, o.name AS outlet_name, r.name AS register_name
       FROM register_sessions rs
       LEFT JOIN registers r ON r.id = rs.register_id AND r.tenant_id = rs.tenant_id
       LEFT JOIN outlets   o ON o.id = r.outlet_id   AND o.tenant_id = rs.tenant_id
       WHERE rs.id = @id AND rs.tenant_id = @t`,
      { id: sessionId, t: tenantId },
    );
    if (!session) throw new Error(`session '${sessionId}' not found`);

    const cashMovements = await this.db.query(
      `SELECT id, movement_type, amount, reason, created_by, created_at
       FROM cash_drawer_movements
       WHERE tenant_id = @t AND shift_id = @id
       ORDER BY created_at ASC LIMIT 500`,
      { t: tenantId, id: sessionId },
    );

    const payments = await this.db.query(
      `SELECT p.method, SUM(p.amount_cents) AS total_cents, COUNT(*) AS count
       FROM payments p
       JOIN orders o ON o.id = p.order_id AND o.tenant_id = p.tenant_id
       WHERE p.tenant_id = @t
         AND p.created_at >= @opened AND p.created_at <= COALESCE(@closed, 9999999999999)
         AND o.store_id = (
           SELECT outlet_id FROM registers WHERE id = @regId AND tenant_id = @t LIMIT 1
         )
       GROUP BY p.method`,
      {
        t: tenantId,
        opened: (session as { opened_at: number }).opened_at,
        closed: (session as { closed_at: number | null }).closed_at,
        regId: (session as { register_id: string }).register_id,
      },
    );

    return { session, cashMovements, paymentBreakdown: payments };
  }

  // ── BE-37: Cash Movement ──────────────────────────────────────────────────

  async cashMovement(
    tenantId: string,
    opts: { registerId?: string; sessionId?: string; from?: number; to?: number; limit: number },
  ) {
    const where: string[] = ["tenant_id = @t"];
    const params: Record<string, unknown> = { t: tenantId };
    if (opts.registerId) { where.push("register_id = @regId"); params["regId"] = opts.registerId; }
    if (opts.sessionId)  { where.push("shift_id = @sessionId"); params["sessionId"] = opts.sessionId; }
    if (opts.from) { where.push("created_at >= @from"); params["from"] = opts.from; }
    if (opts.to)   { where.push("created_at <= @to");   params["to"] = opts.to; }
    params["limit"] = opts.limit;

    const rows = await this.db.query<{
      movement_type: string; amount: number; reason: string | null;
      created_by: string | null; created_at: number;
    }>(
      `SELECT movement_type, amount, reason, created_by, created_at
       FROM cash_drawer_movements
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC LIMIT @limit`,
      params,
    );

    const totalIn  = rows.filter((r) => r.movement_type !== "cash_out").reduce((s, r) => s + Number(r.amount), 0);
    const totalOut = rows.filter((r) => r.movement_type === "cash_out").reduce((s, r) => s + Number(r.amount), 0);
    return { items: rows, totalInCents: totalIn, totalOutCents: totalOut, netCents: totalIn - totalOut };
  }

  // ── BE-38: Purchase/AP Report ─────────────────────────────────────────────

  async purchasesReport(
    tenantId: string,
    opts: { vendorId?: string; from?: number; to?: number; limit: number },
  ) {
    const where: string[] = ["po.tenant_id = @t"];
    const params: Record<string, unknown> = { t: tenantId };
    if (opts.vendorId) { where.push("po.supplier_id = @vid"); params["vid"] = opts.vendorId; }
    if (opts.from) { where.push("po.created_at >= @from"); params["from"] = opts.from; }
    if (opts.to)   { where.push("po.created_at <= @to");   params["to"] = opts.to; }
    params["limit"] = opts.limit;

    return this.db.query(
      `SELECT
         po.id AS po_id, po.po_number, po.status, po.created_at,
         s.name AS vendor_name,
         SUM(l.quantity)      AS qty_ordered,
         SUM(l.received_qty)  AS qty_received,
         SUM(l.line_cost_cents) AS cost_cents,
         po.total_cost_cents,
         COALESCE(b.total_cents - b.paid_cents, 0) AS due_cents
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
       LEFT JOIN purchase_order_lines l ON l.po_id = po.id AND l.tenant_id = po.tenant_id
       LEFT JOIN bills b ON b.po_id = po.id AND b.tenant_id = po.tenant_id
       WHERE ${where.join(" AND ")}
       GROUP BY po.id, po.po_number, po.status, po.created_at, s.name, po.total_cost_cents, b.total_cents, b.paid_cents
       ORDER BY po.created_at DESC
       LIMIT @limit`,
      params,
    );
  }

  /**
   * End-of-day (Z-report) for one business day: transaction counts, sales
   * totals, tender breakdown, top items, and cash-drawer reconciliation.
   *
   * Semantics (the daily close sheet, not the general ledger):
   *  - Window is the UTC day [00:00, 24:00) of `date` (YYYY-MM-DD; default today).
   *  - "Sold" orders are status completed or refunded; voided orders count as
   *    transactions but contribute nothing to sales.
   *  - refunds_cents is the total of refunded orders; netSales = gross −
   *    discounts − refunds; totalCollected = netSales + taxCollected.
   *  - Cash tender is net of change given; card is card_cents as captured.
   *  - The drawer uses the latest register session opened in the window
   *    (optionally scoped by registerId); expected = openingFloat + cashSales −
   *    cashRefunds. actual/variance are null while the session is still open.
   */
  async endOfDay(tenantId: string, date?: string, registerId?: string): Promise<EndOfDayReport> {
    const day = date ?? new Date().toISOString().slice(0, 10);
    const startMs = Date.parse(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(startMs)) throw badRequest(`invalid date '${date}' — expected YYYY-MM-DD`);
    const endMs = startMs + 24 * 60 * 60 * 1000;
    const w = { tenantId, startMs, endMs };

    const tx = await this.db.one<{
      n: number; voids: number; refunds: number; sold: number;
      gross: number; discounts: number; refunded_total: number; tax: number; sold_total: number;
    }>(
      `SELECT COUNT(*)::int                                                     AS n,
              COUNT(*) FILTER (WHERE status = 'voided')::int                    AS voids,
              COUNT(*) FILTER (WHERE status = 'refunded')::int                  AS refunds,
              COUNT(*) FILTER (WHERE status IN ('completed','refunded'))::int   AS sold,
              COALESCE(SUM(subtotal_cents) FILTER (WHERE status IN ('completed','refunded')), 0)::bigint AS gross,
              COALESCE(SUM(discount_cents) FILTER (WHERE status IN ('completed','refunded')), 0)::bigint AS discounts,
              COALESCE(SUM(total_cents)    FILTER (WHERE status = 'refunded'), 0)::bigint                AS refunded_total,
              COALESCE(SUM(tax_cents)      FILTER (WHERE status IN ('completed','refunded')), 0)::bigint AS tax,
              COALESCE(SUM(total_cents)    FILTER (WHERE status IN ('completed','refunded')), 0)::bigint AS sold_total
         FROM orders
        WHERE tenant_id = @tenantId AND created_at >= @startMs AND created_at < @endMs
          AND status <> 'open'`,
      w,
    );

    const tenders = await this.db.one<{ cash_n: number; cash: number; card_n: number; card: number; refund_cash: number }>(
      `SELECT COUNT(*) FILTER (WHERE p.cash_cents > 0)::int                          AS cash_n,
              COALESCE(SUM(p.cash_cents - p.change_cents), 0)::bigint                AS cash,
              COUNT(*) FILTER (WHERE p.card_cents > 0)::int                          AS card_n,
              COALESCE(SUM(p.card_cents), 0)::bigint                                 AS card,
              COALESCE(SUM(p.cash_cents - p.change_cents)
                         FILTER (WHERE o.status = 'refunded'), 0)::bigint            AS refund_cash
         FROM payments p
         JOIN orders o ON o.id = p.order_id AND o.tenant_id = p.tenant_id
        WHERE p.tenant_id = @tenantId AND p.created_at >= @startMs AND p.created_at < @endMs
          AND p.status = 'captured'`,
      w,
    );

    const topItems = await this.db.query<{ product_id: string; name: string; qty: number; total: number }>(
      `SELECT l.product_id, l.name, SUM(l.quantity)::int AS qty, SUM(l.line_cents)::bigint AS total
         FROM order_lines l
         JOIN orders o ON o.id = l.order_id AND o.tenant_id = l.tenant_id
        WHERE l.tenant_id = @tenantId AND o.created_at >= @startMs AND o.created_at < @endMs
          AND o.status IN ('completed','refunded')
        GROUP BY l.product_id, l.name
        ORDER BY total DESC
        LIMIT 5`,
      w,
    );

    const sessionWhere = ["tenant_id = @tenantId", "opened_at >= @startMs", "opened_at < @endMs"];
    const sessionParams: Record<string, unknown> = { ...w };
    if (registerId) { sessionWhere.push("register_id = @registerId"); sessionParams["registerId"] = registerId; }
    const session = await this.db.one<{
      status: string; opened_at: number; closed_at: number | null;
      opening_float_cents: number; counted_cash_cents: number | null;
    }>(
      `SELECT status, opened_at, closed_at, opening_float_cents, counted_cash_cents
         FROM register_sessions WHERE ${sessionWhere.join(" AND ")}
        ORDER BY opened_at DESC LIMIT 1`,
      sessionParams,
    );

    const cashSales = Number(tenders?.cash ?? 0);
    const cashRefunds = Number(tenders?.refund_cash ?? 0);
    const openingFloat = Number(session?.opening_float_cents ?? 0);
    const expectedCash = openingFloat + cashSales - cashRefunds;
    const actualCash = session?.counted_cash_cents ?? null;
    const gross = Number(tx?.gross ?? 0);
    const discounts = Number(tx?.discounts ?? 0);
    const refundedTotal = Number(tx?.refunded_total ?? 0);
    const taxCollected = Number(tx?.tax ?? 0);
    const netSales = gross - discounts - refundedTotal;
    const sold = Number(tx?.sold ?? 0);

    return {
      date: day,
      businessDate: new Intl.DateTimeFormat("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
      }).format(new Date(startMs)),
      openedAt: session?.opened_at ?? null,
      closedAt: session?.closed_at ?? null,
      status: session?.status ?? "no_session",
      transactions: {
        count: Number(tx?.n ?? 0),
        voidCount: Number(tx?.voids ?? 0),
        refundCount: Number(tx?.refunds ?? 0),
        averageTicket_cents: sold > 0 ? Math.round(Number(tx?.sold_total ?? 0) / sold) : 0,
      },
      sales: {
        grossSales_cents: gross,
        discounts_cents: discounts,
        refunds_cents: refundedTotal,
        netSales_cents: netSales,
        taxCollected_cents: taxCollected,
        totalCollected_cents: netSales + taxCollected,
      },
      tenders: [
        { method: "Cash", count: Number(tenders?.cash_n ?? 0), total_cents: cashSales },
        { method: "Card", count: Number(tenders?.card_n ?? 0), total_cents: Number(tenders?.card ?? 0) },
      ],
      topItems: topItems.map((t) => ({
        productId: t.product_id,
        productName: t.name,
        quantitySold: Number(t.qty),
        total_cents: Number(t.total),
      })),
      cashDrawer: {
        openingFloat_cents: openingFloat,
        cashSales_cents: cashSales,
        cashRefunds_cents: cashRefunds,
        expectedCash_cents: expectedCash,
        actualCash_cents: actualCash,
        variance_cents: actualCash === null ? null : Number(actualCash) - expectedCash,
      },
    };
  }

  /**
   * Retail-proof audit — a real-data readiness report for the retail spine.
   * Answers the retailer questions from AGENTS.md (what I sell / in stock /
   * sold / made / low-slow-profitable-risky / what next) and is the backend
   * authority for the setup checklist + the deterministic (rule-based)
   * recommendation signals. Read-only; every figure comes from real tenant
   * tables. `recentDays` bounds "recent sales" (default 30).
   */
  async retailProof(tenantId: string, recentDays = 30): Promise<RetailProof> {
    const now = Date.now();
    const recentSince = now - recentDays * 86_400_000;

    // ── Setup tasks (backend authority) ──────────────────────────────────────
    const [outletN, registerN, taxN, modeN, productN] = await Promise.all([
      this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM outlets WHERE tenant_id = @t", { t: tenantId }),
      this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM registers WHERE tenant_id = @t", { t: tenantId }),
      this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM tax_rates WHERE tenant_id = @t", { t: tenantId }),
      this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM payment_modes WHERE tenant_id = @t", { t: tenantId }),
      this.db.one<{ n: number; active: number }>(
        "SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'active')::int AS active FROM products WHERE tenant_id = @t",
        { t: tenantId },
      ),
    ]);
    // Receipt configured = a saved template with any non-empty text.
    const receiptRows = await this.db.query<{ value_json: string }>(
      "SELECT value_json FROM settings_kv WHERE tenant_id = @t AND key LIKE 'receipt_template:%'",
      { t: tenantId },
    );
    const hasReceipt = receiptRows.some((r) => {
      try {
        const v = JSON.parse(r.value_json) as { headerText?: string; contactInfo?: string; footerText?: string };
        return Boolean((v.headerText ?? "").trim() || (v.contactInfo ?? "").trim() || (v.footerText ?? "").trim());
      } catch {
        return false;
      }
    });
    // First receiving = any stock on hand, or a recorded 'receiving' movement.
    const stockAgg = await this.db.one<{ total: number; low: number; out: number; rows: number }>(
      `SELECT COALESCE(SUM(stock_qty),0)::int AS total,
              COUNT(*) FILTER (WHERE reorder_pt > 0 AND stock_qty <= reorder_pt)::int AS low,
              COUNT(*) FILTER (WHERE stock_qty <= 0)::int AS out,
              COUNT(*)::int AS rows
         FROM inventory WHERE tenant_id = @t`,
      { t: tenantId },
    );
    const receivingN = await this.db.one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM inventory_movements WHERE tenant_id = @t AND reason = 'receiving'",
      { t: tenantId },
    );
    const hasReceiving = Number(stockAgg?.total ?? 0) > 0 || Number(receivingN?.n ?? 0) > 0;

    const setup = {
      outlet: Number(outletN?.n ?? 0) > 0,
      register: Number(registerN?.n ?? 0) > 0,
      taxRate: Number(taxN?.n ?? 0) > 0,
      paymentModes: Number(modeN?.n ?? 0) > 0,
      receipt: hasReceipt,
      firstProduct: Number(productN?.n ?? 0) > 0,
      firstReceiving: hasReceiving,
    };
    const setupDone = Object.values(setup).filter(Boolean).length;
    const setupTotal = Object.keys(setup).length;

    // ── Metrics ──────────────────────────────────────────────────────────────
    const productCount = Number(productN?.n ?? 0);
    const activeProductCount = Number(productN?.active ?? 0);

    const noCost = await this.db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM products p
        WHERE p.tenant_id = @t AND p.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM product_costs c WHERE c.tenant_id = p.tenant_id AND c.product_id = p.id AND c.cost_cents > 0)`,
      { t: tenantId },
    );

    const rev = await this.db.one<{ orders: number; revenue: number; cogs: number }>(
      `SELECT COUNT(DISTINCT o.id)::int AS orders,
              COALESCE(SUM(o.total_cents),0) AS revenue,
              COALESCE((SELECT SUM(ol.quantity * COALESCE(pc.cost_cents,0))
                          FROM order_lines ol
                          JOIN orders o2 ON o2.id = ol.order_id AND o2.tenant_id = ol.tenant_id
                          LEFT JOIN product_costs pc ON pc.tenant_id = ol.tenant_id AND pc.product_id = ol.product_id
                         WHERE o2.tenant_id = @t AND o2.status = 'completed'), 0) AS cogs
         FROM orders o WHERE o.tenant_id = @t AND o.status = 'completed'`,
      { t: tenantId },
    );
    const revenueCents = Number(rev?.revenue ?? 0);
    const cogsCents = Number(rev?.cogs ?? 0);
    const orderCount = Number(rev?.orders ?? 0);
    const grossProfitCents = revenueCents - cogsCents;

    // Expenses (queue #3 module) → net profit = gross profit − expenses.
    const exp = await this.db.one<{ total: number; count: number; uncat: number }>(
      `SELECT COALESCE(SUM(amount_cents),0) AS total,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE category IS NULL)::int AS uncat
         FROM expenses WHERE tenant_id = @t`,
      { t: tenantId },
    );
    const expensesCents = Number(exp?.total ?? 0);
    const expensesCount = Number(exp?.count ?? 0);
    const uncategorizedExpenses = Number(exp?.uncat ?? 0);
    const netProfitCents = grossProfitCents - expensesCents;
    const grossMarginPct = revenueCents > 0 ? Math.round((grossProfitCents / revenueCents) * 1000) / 10 : null;
    const netMarginPct = revenueCents > 0 ? Math.round((netProfitCents / revenueCents) * 1000) / 10 : null;

    // Active products with no sale ever, and none in the recent window.
    const neverSold = await this.db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM products p
        WHERE p.tenant_id = @t AND p.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM order_lines ol WHERE ol.tenant_id = p.tenant_id AND ol.product_id = p.id)`,
      { t: tenantId },
    );
    const staleProducts = await this.db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM products p
        WHERE p.tenant_id = @t AND p.status = 'active'
          AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.tenant_id = p.tenant_id AND ol.product_id = p.id)
          AND NOT EXISTS (
            SELECT 1 FROM order_lines ol
              JOIN orders o ON o.id = ol.order_id AND o.tenant_id = ol.tenant_id
             WHERE ol.tenant_id = p.tenant_id AND ol.product_id = p.id AND o.created_at >= @since)`,
      { t: tenantId, since: recentSince },
    );

    const metrics = {
      productCount,
      activeProductCount,
      productsWithoutCost: Number(noCost?.n ?? 0),
      totalStockUnits: Number(stockAgg?.total ?? 0),
      lowStockCount: Number(stockAgg?.low ?? 0),
      outOfStockCount: Number(stockAgg?.out ?? 0),
      orderCount,
      revenueCents,
      cogsCents,
      grossProfitCents,
      expensesCents,
      netProfitCents,
      grossMarginPct,
      netMarginPct,
      productsNeverSold: Number(neverSold?.n ?? 0),
      productsNoRecentSales: Number(staleProducts?.n ?? 0),
    };

    // ── Deterministic rule-based signals (NOT AI — AGENTS.md) ────────────────
    const signals: RetailProofSignal[] = [];
    const push = (code: string, severity: RetailProofSignal["severity"], count: number, message: string) =>
      signals.push({ code, severity, count, message });

    const setupMissing = setupTotal - setupDone;
    if (setupMissing > 0) push("setup_incomplete", "warning", setupMissing, `${setupMissing} setup task(s) remaining before the store is ready to sell.`);
    if (productCount === 0) push("no_products", "critical", 0, "No products yet — add or import products so the register has something to sell.");
    if (metrics.productsWithoutCost > 0) push("products_without_cost", "warning", metrics.productsWithoutCost, `${metrics.productsWithoutCost} active product(s) have no cost price, so profit cannot be measured.`);
    if (metrics.outOfStockCount > 0) push("out_of_stock", "warning", metrics.outOfStockCount, `${metrics.outOfStockCount} product(s) are out of stock.`);
    if (metrics.lowStockCount > 0) push("low_stock", "info", metrics.lowStockCount, `${metrics.lowStockCount} product(s) are at or below their reorder point.`);
    if (orderCount === 0 && productCount > 0) push("no_sales_yet", "info", 0, "No completed sales recorded yet.");
    if (metrics.productsNeverSold > 0 && orderCount > 0) push("products_never_sold", "info", metrics.productsNeverSold, `${metrics.productsNeverSold} active product(s) have never sold.`);
    if (metrics.productsNoRecentSales > 0) push("slow_movers", "info", metrics.productsNoRecentSales, `${metrics.productsNoRecentSales} product(s) had no sales in the last ${recentDays} days.`);
    // Profit signals — only meaningful once there is revenue to profit from.
    if (revenueCents > 0 && netProfitCents < 0) push("negative_net_profit", "critical", 0, `Net profit is negative (${grossMarginPct ?? 0}% gross, expenses exceed gross profit) — spending is outpacing margin.`);
    if (uncategorizedExpenses > 0) push("uncategorized_expenses", "info", uncategorizedExpenses, `${uncategorizedExpenses} expense(s) are uncategorized — categorize them for accurate reporting.`);

    const ready = setupDone === setupTotal && productCount > 0 && orderCount > 0;

    return {
      ready,
      setup: { ...setup, completed: setupDone, total: setupTotal },
      metrics,
      signals,
      // Expenses module (queue #3) is live — real totals feed net profit above.
      expenses: { available: true, totalCents: expensesCents, count: expensesCount, uncategorizedCount: uncategorizedExpenses },
      generatedAt: now,
      recentDays,
    };
  }

  /**
   * Deterministic, rule-based recommendation engine (NOT AI — AGENTS.md).
   * Consumes the retail-proof signals (the single source of truth for the rules)
   * and turns each actionable one into a ranked recommendation with a concrete
   * next step and destination. Also raises a small number of recommendations
   * derived directly from real metrics that the signals do not already cover.
   * Read-only and tenant-scoped (every figure traces back to real tenant data).
   */
  async retailRecommendations(tenantId: string, recentDays = 30): Promise<RecommendationReport> {
    const proof = await this.retailProof(tenantId, recentDays);
    const recs: Recommendation[] = [];

    // 1) Enrich every actionable signal into a recommendation.
    for (const s of proof.signals) {
      const play = RECO_PLAYBOOK[s.code];
      if (!play) continue; // purely informational signal — not an action
      recs.push({
        id: `rec_${s.code}`, signalCode: s.code, category: play.category, severity: s.severity,
        title: play.title, detail: s.message, action: play.action, href: play.href, count: s.count, rank: 0,
      });
    }

    // 2) Derived recommendation: thin gross margin. Only when there is revenue,
    //    margin is measurable, and net profit is NOT already negative (that case
    //    is covered by the more severe negative_net_profit recommendation).
    const gm = proof.metrics.grossMarginPct;
    const alreadyNegative = proof.signals.some((s) => s.code === "negative_net_profit");
    if (proof.metrics.revenueCents > 0 && gm !== null && gm <= THIN_MARGIN_PCT && !alreadyNegative) {
      const play = RECO_PLAYBOOK["thin_margin"]!;
      recs.push({
        id: "rec_thin_margin", signalCode: null, category: play.category, severity: "warning",
        title: play.title, detail: `Gross margin is ${gm}% — at or below the ${THIN_MARGIN_PCT}% healthy floor.`,
        action: play.action, href: play.href, count: 0, rank: 0,
      });
    }

    // 3) Deterministic ranking: severity first, then a fixed playbook precedence.
    const codeOf = (r: Recommendation) => r.id.replace(/^rec_/, "");
    const codeIndex = (r: Recommendation) => {
      const i = CODE_ORDER.indexOf(codeOf(r));
      return i === -1 ? CODE_ORDER.length : i;
    };
    recs.sort((a, b) =>
      SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]
        ? SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        : codeIndex(a) - codeIndex(b),
    );
    recs.forEach((r, i) => { r.rank = i + 1; });

    return {
      ready: proof.ready,
      recommendations: recs,
      summary: {
        total: recs.length,
        critical: recs.filter((r) => r.severity === "critical").length,
        warning: recs.filter((r) => r.severity === "warning").length,
        info: recs.filter((r) => r.severity === "info").length,
      },
      generatedAt: proof.generatedAt,
      recentDays: proof.recentDays,
    };
  }
}
