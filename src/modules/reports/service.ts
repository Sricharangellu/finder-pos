import type { DB } from "../../shared/db.js";

/** Tenant-scoped sales analytics. Read-only over the orders + order_lines +
 *  payments tables (a lightweight read model / CQRS-lite — reports owns no
 *  tables of its own). Supports a time window via `sinceMs` (epoch ms). */

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
    const kpiRow = await this.db.one<{
      sale_count: number;
      customer_count: number;
      total_items: number;
      discounted_cents: number;
      discounted_orders: number;
    }>(
      `SELECT
         COUNT(*)::int                                          AS sale_count,
         COUNT(DISTINCT customer_id)::int                      AS customer_count,
         COALESCE(SUM(item_count), 0)::int                     AS total_items,
         COALESCE(SUM(discount_cents), 0)                      AS discounted_cents,
         COUNT(*) FILTER (WHERE discount_cents > 0)::int       AS discounted_orders
       FROM (
         SELECT o.customer_id, o.discount_cents,
                (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id AND ol.tenant_id = o.tenant_id) AS item_count
         FROM orders o
         WHERE o.tenant_id = @tenantId AND o.status = 'completed' AND o.created_at >= @since
       ) sub`,
      { tenantId, since },
    );

    const saleCount = Number(kpiRow?.sale_count ?? 0);
    const customerCount = Number(kpiRow?.customer_count ?? 0);
    const totalItems = Number(kpiRow?.total_items ?? 0);
    const discountedCents = Number(kpiRow?.discounted_cents ?? 0);
    const discountedOrders = Number(kpiRow?.discounted_orders ?? 0);
    const avgSaleValueCents = saleCount > 0 ? Math.round(grossCents / saleCount) : 0;
    const avgItemsPerSale = saleCount > 0 ? Math.round((totalItems / saleCount) * 10) / 10 : 0;
    const discountedPct = saleCount > 0 ? Math.round((discountedOrders / saleCount) * 1000) / 10 : 0;

    // Sparkline: last 8 daily revenue + sale count buckets
    const sparkRows = await this.db.query<{ day: string; rev: number; cnt: number }>(
      `SELECT
         to_char(to_timestamp(created_at / 1000), 'YYYY-MM-DD') AS day,
         COALESCE(SUM(total_cents), 0)                           AS rev,
         COUNT(*)::int                                           AS cnt
       FROM orders
       WHERE tenant_id = @tenantId AND status = 'completed'
         AND created_at >= @spark
       GROUP BY day ORDER BY day ASC LIMIT 8`,
      { tenantId, spark: Date.now() - 7 * 86_400_000 },
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
}
