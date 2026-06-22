import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound, badRequest, conflict } from "../../shared/http.js";

/**
 * Sales module — the B2B order-to-cash front half of the ERP benchmark:
 *   Quotation → Sales Order → (approve) → Invoice.
 *
 * Quotations and sales orders each carry their own line tables. Unit prices are
 * resolved from the catalog and adjusted by the customer's tier (Tier 1 = best
 * price). Converting a sales order to an invoice emits `sales_order.invoiced`,
 * which the billing module turns into an AR invoice — modules stay decoupled
 * through the EventBus. Tenant-scoped; money in integer cents.
 */

export type QuoteStatus = "draft" | "sent" | "accepted" | "expired" | "cancelled";
export type SOStatus = "pending_approve" | "approved" | "invoiced" | "partially_invoiced" | "cancelled";

/** Tier → line discount %. Tier 1 = best price. Placeholder until per-product
 *  tier prices land in Wave B; documented in ERP_BENCHMARK.md. */
const TIER_DISCOUNT_PCT: Record<number, number> = { 1: 10, 2: 7.5, 3: 5, 4: 2.5, 5: 0 };

export interface Quotation {
  id: string;
  tenant_id: string;
  quote_number: string;
  customer_id: string;
  status: QuoteStatus;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  sales_rep_id: string | null;
  store_id: string | null;
  valid_until: number | null;
  created_at: number;
  updated_at: number;
}

export interface SalesOrder {
  id: string;
  tenant_id: string;
  so_number: string;
  quotation_id: string | null;
  customer_id: string;
  status: SOStatus;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  sales_rep_id: string | null;
  picker_id: string | null;
  store_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface SalesLine {
  id: string;
  tenant_id: string;
  parent_id: string;
  product_id: string;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
}

export interface LineInput {
  productId: string;
  quantity: number;
  unitCents?: number; // override resolved price
}

export interface CreateQuoteInput {
  customerId: string;
  lines: LineInput[];
  salesRepId?: string | null;
  storeId?: string | null;
  validUntil?: number | null;
}

export interface CreateSOInput {
  customerId: string;
  lines: LineInput[];
  quotationId?: string | null;
  salesRepId?: string | null;
  pickerId?: string | null;
  storeId?: string | null;
}

interface ResolvedLine {
  product_id: string;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
}

const QUOTE_TERMINAL = new Set<QuoteStatus>(["expired", "cancelled"]);

// ── Sales reps (BE-29) ────────────────────────────────────────────────────────

export interface SalesRep {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  commission_pct: number;
  active: boolean;
  created_at: number;
}

/** Raw DB row — SQLite stores booleans as 0/1. Coerced before returning. */
interface SalesRepRow {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  commission_pct: number;
  active: number;
  created_at: number;
}

function rowToRep(r: SalesRepRow): SalesRep {
  return { ...r, commission_pct: Number(r.commission_pct), active: r.active === 1 };
}

export interface SalesRepPerformance {
  rep_id: string;
  rep_name: string;
  total_revenue_cents: number;
  order_count: number;
  avg_deal_cents: number;
  from_ts: number;
  to_ts: number;
}

export class SalesService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async nextNumber(table: string, prefix: string, tenantId: string): Promise<string> {
    const row = await this.db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = @t`,
      { t: tenantId },
    );
    const seq = Number(row?.n ?? 0) + 1;
    return `${prefix}-${String(seq).padStart(5, "0")}`;
  }

  private async customerTier(customerId: string, tenantId: string): Promise<number> {
    const c = await this.db.one<{ tier: number | null }>(
      "SELECT tier FROM customers WHERE id = @c AND tenant_id = @t",
      { c: customerId, t: tenantId },
    );
    if (!c) throw notFound(`customer '${customerId}' not found`);
    const tier = Number(c.tier ?? 5);
    return tier >= 1 && tier <= 5 ? tier : 5;
  }

  /** Resolve a unit price for (product, tier): an explicit per-product tier
   *  price wins; otherwise the list price minus the tier discount schedule. */
  private async tierPrice(productId: string, tier: number, basePrice: number, tenantId: string): Promise<{ unit: number; discounted: boolean }> {
    const row = await this.db.one<{ price_cents: number }>(
      "SELECT price_cents FROM product_tier_prices WHERE tenant_id = @t AND product_id = @p AND tier = @tier",
      { t: tenantId, p: productId, tier },
    );
    if (row) return { unit: Number(row.price_cents), discounted: false };
    return { unit: basePrice, discounted: true };
  }

  /** Resolve catalog prices, apply tier pricing, and compute line totals.
   *  Discount reported = list-vs-charged delta (from the tier schedule fallback). */
  private async resolveLines(lines: LineInput[], tier: number, tenantId: string): Promise<{ resolved: ResolvedLine[]; subtotal: number; discount: number }> {
    if (lines.length === 0) throw badRequest("at least one line is required");
    const pct = TIER_DISCOUNT_PCT[tier] ?? 0;
    const resolved: ResolvedLine[] = [];
    let subtotal = 0;
    let discount = 0;
    for (const l of lines) {
      if (l.quantity <= 0) throw badRequest("line quantity must be positive");
      const p = await this.db.one<{ name: string; price_cents: number; status: string }>(
        "SELECT name, price_cents, status FROM products WHERE id = @p AND tenant_id = @t",
        { p: l.productId, t: tenantId },
      );
      if (!p) throw notFound(`product '${l.productId}' not found`);
      const listUnit = Number(p.price_cents);
      // Explicit override on the line always wins; else resolve tier pricing.
      let chargedUnit: number;
      let applyScheduleDiscount = false;
      if (l.unitCents !== undefined) {
        chargedUnit = l.unitCents;
      } else {
        const tp = await this.tierPrice(l.productId, tier, listUnit, tenantId);
        chargedUnit = tp.unit;
        applyScheduleDiscount = tp.discounted;
      }
      const grossLine = listUnit * l.quantity;
      let netLine: number;
      let lineDiscount: number;
      if (applyScheduleDiscount) {
        lineDiscount = Math.round((chargedUnit * l.quantity * pct) / 100);
        netLine = chargedUnit * l.quantity - lineDiscount;
      } else {
        netLine = chargedUnit * l.quantity;
        lineDiscount = Math.max(0, grossLine - netLine);
      }
      subtotal += grossLine;
      discount += lineDiscount;
      resolved.push({ product_id: l.productId, name: p.name, quantity: l.quantity, unit_cents: chargedUnit, line_cents: netLine });
    }
    return { resolved, subtotal, discount };
  }

  // ── Per-product tier prices (Wave B) ─────────────────────────────────────
  async setTierPrices(productId: string, prices: Record<number, number>, tenantId: string): Promise<{ productId: string; prices: Array<{ tier: number; priceCents: number }> }> {
    const now = Date.now();
    for (const [tierStr, price] of Object.entries(prices)) {
      const tier = Number(tierStr);
      if (tier < 1 || tier > 5) throw badRequest("tier must be 1–5");
      if (price < 0) throw badRequest("price must be non-negative");
      await this.db.query(
        `INSERT INTO product_tier_prices (tenant_id, product_id, tier, price_cents, updated_at)
         VALUES (@t,@p,@tier,@price,@now)
         ON CONFLICT (tenant_id, product_id, tier) DO UPDATE SET price_cents = EXCLUDED.price_cents, updated_at = EXCLUDED.updated_at`,
        { t: tenantId, p: productId, tier, price, now },
      );
    }
    return this.getTierPrices(productId, tenantId);
  }

  async getTierPrices(productId: string, tenantId: string): Promise<{ productId: string; prices: Array<{ tier: number; priceCents: number }> }> {
    const rows = await this.db.query<{ tier: number; price_cents: number }>(
      "SELECT tier, price_cents FROM product_tier_prices WHERE tenant_id = @t AND product_id = @p ORDER BY tier",
      { t: tenantId, p: productId },
    );
    return { productId, prices: rows.map((r) => ({ tier: Number(r.tier), priceCents: Number(r.price_cents) })) };
  }

  private async insertLines(table: string, parentCol: string, parentId: string, lines: ResolvedLine[], tenantId: string, tdb: DB): Promise<SalesLine[]> {
    const out: SalesLine[] = [];
    for (const r of lines) {
      const line: SalesLine = { id: `sln_${uuidv7()}`, tenant_id: tenantId, parent_id: parentId, ...r };
      await tdb.query(
        `INSERT INTO ${table} (id, tenant_id, ${parentCol}, product_id, name, quantity, unit_cents, line_cents)
         VALUES (@id,@tenant_id,@parent_id,@product_id,@name,@quantity,@unit_cents,@line_cents)`,
        line as unknown as Record<string, unknown>,
      );
      out.push(line);
    }
    return out;
  }

  // ── Quotations ───────────────────────────────────────────────────────────
  async createQuotation(input: CreateQuoteInput, tenantId: string): Promise<Quotation & { lines: SalesLine[] }> {
    const tier = await this.customerTier(input.customerId, tenantId);
    const { resolved, subtotal, discount } = await this.resolveLines(input.lines, tier, tenantId);
    const now = Date.now();
    const q: Quotation = {
      id: `qot_${uuidv7()}`, tenant_id: tenantId, quote_number: await this.nextNumber("quotations", "QT", tenantId),
      customer_id: input.customerId, status: "draft", subtotal_cents: subtotal, discount_cents: discount,
      total_cents: subtotal - discount, sales_rep_id: input.salesRepId ?? null, store_id: input.storeId ?? null,
      valid_until: input.validUntil ?? now + 30 * 86_400_000, created_at: now, updated_at: now,
    };
    const lines = await this.db.tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO quotations (id, tenant_id, quote_number, customer_id, status, subtotal_cents, discount_cents, total_cents, sales_rep_id, store_id, valid_until, created_at, updated_at)
         VALUES (@id,@tenant_id,@quote_number,@customer_id,@status,@subtotal_cents,@discount_cents,@total_cents,@sales_rep_id,@store_id,@valid_until,@created_at,@updated_at)`,
        q as unknown as Record<string, unknown>,
      );
      return this.insertLines("quotation_lines", "quotation_id", q.id, resolved, tenantId, tdb);
    });
    return { ...q, lines };
  }

  async listQuotations(tenantId: string, status?: QuoteStatus): Promise<Quotation[]> {
    if (status) return this.db.query<Quotation>("SELECT * FROM quotations WHERE tenant_id = @t AND status = @s ORDER BY created_at DESC LIMIT 500", { t: tenantId, s: status });
    return this.db.query<Quotation>("SELECT * FROM quotations WHERE tenant_id = @t ORDER BY created_at DESC LIMIT 500", { t: tenantId });
  }

  async getQuotation(id: string, tenantId: string): Promise<Quotation & { lines: SalesLine[] }> {
    const q = await this.db.one<Quotation>("SELECT * FROM quotations WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!q) throw notFound(`quotation '${id}' not found`);
    const lines = await this.db.query<SalesLine>("SELECT * FROM quotation_lines WHERE quotation_id = @id AND tenant_id = @t", { id, t: tenantId });
    return { ...q, lines };
  }

  private async setQuoteStatus(id: string, from: QuoteStatus[], to: QuoteStatus, tenantId: string): Promise<Quotation> {
    const q = await this.db.one<Quotation>("SELECT * FROM quotations WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!q) throw notFound(`quotation '${id}' not found`);
    if (QUOTE_TERMINAL.has(q.status)) throw conflict(`quotation is ${q.status}`);
    if (!from.includes(q.status)) throw conflict(`cannot move quotation from ${q.status} to ${to}`);
    await this.db.query("UPDATE quotations SET status = @s, updated_at = @now WHERE id = @id AND tenant_id = @t", { s: to, now: Date.now(), id, t: tenantId });
    return { ...q, status: to };
  }

  sendQuotation(id: string, tenantId: string) { return this.setQuoteStatus(id, ["draft"], "sent", tenantId); }
  acceptQuotation(id: string, tenantId: string) { return this.setQuoteStatus(id, ["sent"], "accepted", tenantId); }
  cancelQuotation(id: string, tenantId: string) { return this.setQuoteStatus(id, ["draft", "sent", "accepted"], "cancelled", tenantId); }

  // ── Sales orders ───────────────────────────────────────────────────────────
  async createSalesOrder(input: CreateSOInput, tenantId: string): Promise<SalesOrder & { lines: SalesLine[] }> {
    const tier = await this.customerTier(input.customerId, tenantId);
    const { resolved, subtotal, discount } = await this.resolveLines(input.lines, tier, tenantId);
    return this.persistSO({ ...input, resolved, subtotal, discount }, tenantId);
  }

  /** Convert an accepted quotation into a pending-approval sales order (idempotent per quotation). */
  async convertQuotationToSO(quotationId: string, tenantId: string): Promise<SalesOrder & { lines: SalesLine[] }> {
    const q = await this.getQuotation(quotationId, tenantId);
    if (q.status === "cancelled" || q.status === "expired") throw conflict(`quotation is ${q.status}`);
    const existing = await this.db.one<SalesOrder>("SELECT * FROM sales_orders WHERE quotation_id = @q AND tenant_id = @t", { q: quotationId, t: tenantId });
    if (existing) {
      const lines = await this.db.query<SalesLine>("SELECT * FROM sales_order_lines WHERE sales_order_id = @id AND tenant_id = @t", { id: existing.id, t: tenantId });
      return { ...existing, lines };
    }
    if (q.status !== "accepted") await this.setQuoteStatus(quotationId, ["draft", "sent"], "accepted", tenantId);
    const resolved: ResolvedLine[] = q.lines.map((l) => ({ product_id: l.product_id, name: l.name, quantity: l.quantity, unit_cents: l.unit_cents, line_cents: l.line_cents }));
    return this.persistSO(
      { customerId: q.customer_id, quotationId, salesRepId: q.sales_rep_id, storeId: q.store_id, resolved, subtotal: q.subtotal_cents, discount: q.discount_cents },
      tenantId,
    );
  }

  private async persistSO(
    args: { customerId: string; quotationId?: string | null; salesRepId?: string | null; pickerId?: string | null; storeId?: string | null; resolved: ResolvedLine[]; subtotal: number; discount: number },
    tenantId: string,
  ): Promise<SalesOrder & { lines: SalesLine[] }> {
    const now = Date.now();
    const so: SalesOrder = {
      id: `sso_${uuidv7()}`, tenant_id: tenantId, so_number: await this.nextNumber("sales_orders", "SO", tenantId),
      quotation_id: args.quotationId ?? null, customer_id: args.customerId, status: "pending_approve",
      subtotal_cents: args.subtotal, discount_cents: args.discount, total_cents: args.subtotal - args.discount,
      sales_rep_id: args.salesRepId ?? null, picker_id: args.pickerId ?? null, store_id: args.storeId ?? null,
      created_at: now, updated_at: now,
    };
    const lines = await this.db.tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO sales_orders (id, tenant_id, so_number, quotation_id, customer_id, status, subtotal_cents, discount_cents, total_cents, sales_rep_id, picker_id, store_id, created_at, updated_at)
         VALUES (@id,@tenant_id,@so_number,@quotation_id,@customer_id,@status,@subtotal_cents,@discount_cents,@total_cents,@sales_rep_id,@picker_id,@store_id,@created_at,@updated_at)`,
        so as unknown as Record<string, unknown>,
      );
      return this.insertLines("sales_order_lines", "sales_order_id", so.id, args.resolved, tenantId, tdb);
    });
    return { ...so, lines };
  }

  async listSalesOrders(
    tenantId: string,
    filter: { status?: SOStatus; salesRepId?: string; pickerId?: string; cursor?: string; limit?: number } = {},
  ): Promise<{ items: SalesOrder[]; nextCursor: string | null; limit: number }> {
    const limit = Math.min(filter.limit ?? 50, 200);
    const where: string[] = ["tenant_id = @t"];
    const params: Record<string, unknown> = { t: tenantId };

    if (filter.status) { where.push("status = @s"); params.s = filter.status; }
    if (filter.salesRepId) { where.push("sales_rep_id = @r"); params.r = filter.salesRepId; }
    if (filter.pickerId) { where.push("picker_id = @p"); params.p = filter.pickerId; }

    if (filter.cursor) {
      const cur = JSON.parse(Buffer.from(filter.cursor, "base64url").toString()) as { at: number; id: string };
      where.push("(created_at < @curAt OR (created_at = @curAt AND id < @curId))");
      params.curAt = cur.at;
      params.curId = cur.id;
    }

    const items = await this.db.query<SalesOrder>(
      `SELECT * FROM sales_orders WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT @limit`,
      { ...params, limit },
    );

    const last = items.at(-1);
    const nextCursor =
      items.length === limit && last
        ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url")
        : null;

    return { items, nextCursor, limit };
  }

  async getSalesOrder(id: string, tenantId: string): Promise<SalesOrder & { lines: SalesLine[] }> {
    const so = await this.db.one<SalesOrder>("SELECT * FROM sales_orders WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!so) throw notFound(`sales order '${id}' not found`);
    const lines = await this.db.query<SalesLine>("SELECT * FROM sales_order_lines WHERE sales_order_id = @id AND tenant_id = @t", { id, t: tenantId });
    return { ...so, lines };
  }

  async approveSalesOrder(id: string, tenantId: string): Promise<SalesOrder> {
    const so = await this.db.one<SalesOrder>("SELECT * FROM sales_orders WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!so) throw notFound(`sales order '${id}' not found`);
    if (so.status !== "pending_approve") throw conflict(`cannot approve a ${so.status} sales order`);
    await this.db.query("UPDATE sales_orders SET status = 'approved', updated_at = @now WHERE id = @id AND tenant_id = @t", { now: Date.now(), id, t: tenantId });
    await this.events.publish("sales_order.approved", { salesOrderId: id, tenantId, customerId: so.customer_id }, id);
    return { ...so, status: "approved" };
  }

  async assignPicker(id: string, pickerId: string, tenantId: string): Promise<SalesOrder> {
    const so = await this.db.one<SalesOrder>("SELECT * FROM sales_orders WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!so) throw notFound(`sales order '${id}' not found`);
    await this.db.query("UPDATE sales_orders SET picker_id = @p, updated_at = @now WHERE id = @id AND tenant_id = @t", { p: pickerId, now: Date.now(), id, t: tenantId });
    return { ...so, picker_id: pickerId };
  }

  /** Approve→invoice: emits `sales_order.invoiced` for billing to raise an AR invoice. */
  async convertToInvoice(id: string, tenantId: string): Promise<SalesOrder> {
    const so = await this.db.one<SalesOrder>("SELECT * FROM sales_orders WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!so) throw notFound(`sales order '${id}' not found`);
    if (so.status === "cancelled") throw conflict("sales order is cancelled");
    if (so.status === "invoiced") throw conflict("sales order is already invoiced");
    if (so.status === "pending_approve") throw conflict("approve the sales order before invoicing");
    await this.db.query("UPDATE sales_orders SET status = 'invoiced', updated_at = @now WHERE id = @id AND tenant_id = @t", { now: Date.now(), id, t: tenantId });
    await this.events.publish(
      "sales_order.invoiced",
      { salesOrderId: id, tenantId, customerId: so.customer_id, totalCents: Number(so.total_cents) },
      id,
    );
    return { ...so, status: "invoiced" };
  }

  async cancelSalesOrder(id: string, tenantId: string): Promise<SalesOrder> {
    const so = await this.db.one<SalesOrder>("SELECT * FROM sales_orders WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!so) throw notFound(`sales order '${id}' not found`);
    if (so.status === "invoiced") throw conflict("cannot cancel an invoiced sales order");
    await this.db.query("UPDATE sales_orders SET status = 'cancelled', updated_at = @now WHERE id = @id AND tenant_id = @t", { now: Date.now(), id, t: tenantId });
    return { ...so, status: "cancelled" };
  }

  // ── Sales reps (BE-29) ───────────────────────────────────────────────────────

  async listReps(tenantId: string, activeOnly = false): Promise<SalesRep[]> {
    const where = activeOnly ? "tenant_id = @t AND active = 1" : "tenant_id = @t";
    const rows = await this.db.query<SalesRepRow>(
      `SELECT * FROM sales_reps WHERE ${where} ORDER BY name`,
      { t: tenantId },
    );
    return rows.map(rowToRep);
  }

  async createRep(input: { name: string; email?: string | null; commission_pct?: number }, tenantId: string): Promise<SalesRep> {
    if (!input.name.trim()) throw badRequest("name is required");
    const id = `rep_${uuidv7()}`;
    const now = Date.now();
    const rep: SalesRep = {
      id,
      tenant_id: tenantId,
      name: input.name.trim(),
      email: input.email ?? null,
      commission_pct: input.commission_pct ?? 0,
      active: true,
      created_at: now,
    };
    await this.db.query(
      `INSERT INTO sales_reps (id, tenant_id, name, email, commission_pct, active, created_at)
       VALUES (@id, @tenant_id, @name, @email, @commission_pct, 1, @created_at)`,
      { id: rep.id, tenant_id: rep.tenant_id, name: rep.name, email: rep.email, commission_pct: rep.commission_pct, created_at: rep.created_at },
    );
    return rep;
  }

  async updateRep(id: string, input: { name?: string; email?: string | null; commission_pct?: number; active?: boolean }, tenantId: string): Promise<SalesRep> {
    const row = await this.db.one<SalesRepRow>(
      "SELECT * FROM sales_reps WHERE id = @id AND tenant_id = @t",
      { id, t: tenantId },
    );
    if (!row) throw notFound(`sales rep '${id}' not found`);
    const name = input.name ?? row.name;
    const email = input.email !== undefined ? input.email : row.email;
    const commission_pct = input.commission_pct ?? Number(row.commission_pct);
    const active = input.active !== undefined ? (input.active ? 1 : 0) : row.active;
    await this.db.query(
      `UPDATE sales_reps SET name = @name, email = @email, commission_pct = @cp, active = @active WHERE id = @id AND tenant_id = @t`,
      { name, email, cp: commission_pct, active, id, t: tenantId },
    );
    return { ...row, name, email, commission_pct, active: active === 1 };
  }

  async getRepPerformance(id: string, tenantId: string, from: number, to: number): Promise<SalesRepPerformance> {
    const repRow = await this.db.one<SalesRepRow>(
      "SELECT * FROM sales_reps WHERE id = @id AND tenant_id = @t",
      { id, t: tenantId },
    );
    if (!repRow) throw notFound(`sales rep '${id}' not found`);
    const rep = rowToRep(repRow);
    const row = await this.db.one<{ total_revenue_cents: number; order_count: number }>(
      `SELECT COALESCE(SUM(total_cents), 0) AS total_revenue_cents, COUNT(*) AS order_count
       FROM sales_orders
       WHERE tenant_id = @t AND sales_rep_id = @id AND status != 'cancelled'
         AND created_at BETWEEN @from AND @to`,
      { t: tenantId, id, from, to },
    );
    const total = Number(row?.total_revenue_cents ?? 0);
    const count = Number(row?.order_count ?? 0);
    return {
      rep_id: id,
      rep_name: rep.name,
      total_revenue_cents: total,
      order_count: count,
      avg_deal_cents: count > 0 ? Math.round(total / count) : 0,
      from_ts: from,
      to_ts: to,
    };
  }
}
