import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { notFound, badRequest, conflict } from "../../shared/http.js";

/**
 * Discounts & Promotions engine (ERP benchmark #11).
 *
 * Rules: simple ($/% off), volume (% off when qty threshold met), and buy-X-get-Y.
 * Each rule scopes to a product, a category, or the whole cart, can be gated by
 * customer tier, minimum order value/quantity, and a date window, and is either
 * auto-applicable or requires a coupon code. `evaluate` computes the discount for
 * a cart; `redeem` bumps usage against limits. Tenant-scoped, money in cents.
 */

export type RuleType = "simple" | "volume" | "bxgy";
export type DiscountType = "fixed" | "percent";
export type ApplyTo = "product" | "category" | "cart";
export type RuleStatus = "active" | "inactive" | "paused" | "archived";

export interface Discount {
  id: string;
  tenant_id: string;
  name: string;
  coupon_code: string | null;
  rule_type: RuleType;
  discount_type: DiscountType;
  value: number;            // cents (fixed) or whole-percent (percent)
  apply_to: ApplyTo;
  target_id: string | null; // product id or category name when scoped
  min_order_cents: number;
  min_qty: number;
  buy_qty: number;          // bxgy
  get_qty: number;          // bxgy
  tier_restriction: string | null; // csv of tiers e.g. "1,2"
  start_date: number | null;
  end_date: number | null;
  status: RuleStatus;
  auto_applicable: number;  // 1|0
  usage_limit: number | null;
  per_customer_limit: number | null;
  used_count: number;
  created_at: number;
  updated_at: number;
}

export interface CreateDiscountInput {
  name: string;
  couponCode?: string;
  ruleType: RuleType;
  discountType: DiscountType;
  value: number;
  applyTo: ApplyTo;
  targetId?: string;
  minOrderCents?: number;
  minQty?: number;
  buyQty?: number;
  getQty?: number;
  tierRestriction?: number[];
  startDate?: number;
  endDate?: number;
  autoApplicable?: boolean;
  usageLimit?: number;
  perCustomerLimit?: number;
}

export interface CartLine {
  productId: string;
  category?: string;
  quantity: number;
  unitCents: number;
}

export interface EvaluateInput {
  lines: CartLine[];
  customerTier?: number;
  couponCode?: string;
  now?: number;
}

export interface AppliedDiscount {
  discountId: string;
  name: string;
  ruleType: RuleType;
  amountCents: number;
}

export interface EvaluateResult {
  subtotalCents: number;
  discounts: AppliedDiscount[];
  totalDiscountCents: number;
  netCents: number;
}

export class DiscountsService {
  constructor(private readonly db: DB) {}

  async create(input: CreateDiscountInput, tenantId: string): Promise<Discount> {
    if (input.discountType === "percent" && (input.value < 0 || input.value > 100)) throw badRequest("percent value must be 0–100");
    if (input.value < 0) throw badRequest("value must be non-negative");
    const now = Date.now();
    const d: Discount = {
      id: `dsc_${uuidv7()}`, tenant_id: tenantId, name: input.name, coupon_code: input.couponCode ?? null,
      rule_type: input.ruleType, discount_type: input.discountType, value: input.value, apply_to: input.applyTo,
      target_id: input.targetId ?? null, min_order_cents: input.minOrderCents ?? 0, min_qty: input.minQty ?? 0,
      buy_qty: input.buyQty ?? 0, get_qty: input.getQty ?? 0,
      tier_restriction: input.tierRestriction && input.tierRestriction.length ? input.tierRestriction.join(",") : null,
      start_date: input.startDate ?? null, end_date: input.endDate ?? null, status: "active",
      auto_applicable: input.autoApplicable ? 1 : 0, usage_limit: input.usageLimit ?? null,
      per_customer_limit: input.perCustomerLimit ?? null, used_count: 0, created_at: now, updated_at: now,
    };
    try {
      await this.db.query(
        `INSERT INTO discounts (id, tenant_id, name, coupon_code, rule_type, discount_type, value, apply_to, target_id, min_order_cents, min_qty, buy_qty, get_qty, tier_restriction, start_date, end_date, status, auto_applicable, usage_limit, per_customer_limit, used_count, created_at, updated_at)
         VALUES (@id,@tenant_id,@name,@coupon_code,@rule_type,@discount_type,@value,@apply_to,@target_id,@min_order_cents,@min_qty,@buy_qty,@get_qty,@tier_restriction,@start_date,@end_date,@status,@auto_applicable,@usage_limit,@per_customer_limit,@used_count,@created_at,@updated_at)`,
        d as unknown as Record<string, unknown>,
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw conflict(`coupon code '${input.couponCode}' already exists`);
      throw err;
    }
    return d;
  }

  async list(tenantId: string, opts: { status?: RuleStatus; limit?: number; offset?: number } = {}): Promise<{ items: Discount[]; total: number }> {
    const limit = Math.min(opts.limit ?? 50, 500);
    const offset = opts.offset ?? 0;

    const conditions = ["tenant_id = @t"];
    const params: Record<string, unknown> = { t: tenantId, limit, offset };
    if (opts.status) {
      conditions.push("status = @s");
      params["s"] = opts.status;
    }
    const where = conditions.join(" AND ");

    const [items, countRows] = await Promise.all([
      this.db.query<Discount>(
        `SELECT * FROM discounts WHERE ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
        params,
      ),
      this.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM discounts WHERE ${where}`, params),
    ]);
    return { items, total: countRows[0]?.n ?? 0 };
  }

  async get(id: string, tenantId: string): Promise<Discount> {
    const d = await this.db.one<Discount>("SELECT * FROM discounts WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!d) throw notFound(`discount '${id}' not found`);
    return d;
  }

  async setStatus(id: string, status: RuleStatus, tenantId: string): Promise<Discount> {
    const d = await this.get(id, tenantId);
    await this.db.query("UPDATE discounts SET status = @s, updated_at = @now WHERE id = @id AND tenant_id = @t", { s: status, now: Date.now(), id, t: tenantId });
    return { ...d, status };
  }

  async update(id: string, input: Partial<CreateDiscountInput>, tenantId: string): Promise<Discount> {
    const d = await this.get(id, tenantId);
    
    if (input.name !== undefined) d.name = input.name;
    if (input.couponCode !== undefined) d.coupon_code = input.couponCode || null;
    if (input.ruleType !== undefined) d.rule_type = input.ruleType;
    if (input.discountType !== undefined) d.discount_type = input.discountType;
    if (input.value !== undefined) d.value = input.value;
    if (input.applyTo !== undefined) d.apply_to = input.applyTo;
    if (input.targetId !== undefined) d.target_id = input.targetId || null;
    if (input.minOrderCents !== undefined) d.min_order_cents = input.minOrderCents;
    if (input.minQty !== undefined) d.min_qty = input.minQty;
    if (input.buyQty !== undefined) d.buy_qty = input.buyQty;
    if (input.getQty !== undefined) d.get_qty = input.getQty;
    if (input.tierRestriction !== undefined) {
      d.tier_restriction = input.tierRestriction && input.tierRestriction.length ? input.tierRestriction.join(",") : null;
    }
    if (input.startDate !== undefined) d.start_date = input.startDate || null;
    if (input.endDate !== undefined) d.end_date = input.endDate || null;
    if (input.autoApplicable !== undefined) d.auto_applicable = input.autoApplicable ? 1 : 0;
    if (input.usageLimit !== undefined) d.usage_limit = input.usageLimit || null;
    if (input.perCustomerLimit !== undefined) d.per_customer_limit = input.perCustomerLimit || null;

    if (d.discount_type === "percent" && (d.value < 0 || d.value > 100)) throw badRequest("percent value must be 0–100");
    if (d.value < 0) throw badRequest("value must be non-negative");

    d.updated_at = Date.now();

    try {
      await this.db.query(
        `UPDATE discounts SET
          name = @name, coupon_code = @coupon_code, rule_type = @rule_type, discount_type = @discount_type,
          value = @value, apply_to = @apply_to, target_id = @target_id, min_order_cents = @min_order_cents,
          min_qty = @min_qty, buy_qty = @buy_qty, get_qty = @get_qty, tier_restriction = @tier_restriction,
          start_date = @start_date, end_date = @end_date, auto_applicable = @auto_applicable,
          usage_limit = @usage_limit, per_customer_limit = @per_customer_limit, updated_at = @updated_at
         WHERE id = @id AND tenant_id = @tenant_id`,
        d as unknown as Record<string, unknown>,
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw conflict(`coupon code '${d.coupon_code}' already exists`);
      throw err;
    }
    return d;
  }


  /** Increment usage, enforcing usage_limit and per_customer_limit.
   *  Pass `customerId` for per-customer tracking (BE-5). */
  async redeem(id: string, tenantId: string, customerId?: string, orderId?: string): Promise<Discount> {
    const d = await this.get(id, tenantId);
    if (d.usage_limit !== null && Number(d.used_count) >= Number(d.usage_limit)) throw conflict("discount usage limit reached");

    // BE-5: enforce per-customer limit when customerId is provided.
    if (d.per_customer_limit !== null && customerId) {
      const usageRow = await this.db.one<{ cnt: number }>(
        "SELECT COUNT(*)::int AS cnt FROM discount_usages WHERE tenant_id = @t AND discount_id = @d AND customer_id = @c",
        { t: tenantId, d: id, c: customerId },
      );
      if (Number(usageRow?.cnt ?? 0) >= Number(d.per_customer_limit)) {
        throw conflict(`This discount has already been used ${d.per_customer_limit} time(s) by this customer`);
      }
    }

    await this.db.query("UPDATE discounts SET used_count = used_count + 1, updated_at = @now WHERE id = @id AND tenant_id = @t", { now: Date.now(), id, t: tenantId });

    // Record per-customer usage for BE-5 tracking.
    if (customerId) {
      await this.db.query(
        "INSERT INTO discount_usages (id, tenant_id, discount_id, customer_id, order_id, used_at) VALUES (@id,@t,@d,@c,@o,@now)",
        { id: `dku_${uuidv7()}`, t: tenantId, d: id, c: customerId, o: orderId ?? null, now: Date.now() },
      );
    }

    return { ...d, used_count: Number(d.used_count) + 1 };
  }

  // ── Cart evaluation ────────────────────────────────────────────────────────
  async evaluate(input: EvaluateInput, tenantId: string): Promise<EvaluateResult> {
    const now = input.now ?? Date.now();
    const subtotal = input.lines.reduce((s, l) => s + l.unitCents * l.quantity, 0);

    // Candidate rules: active, in window, and either auto-applicable or coupon-matched.
    const all = await this.db.query<Discount>("SELECT * FROM discounts WHERE tenant_id = @t AND status = 'active'", { t: tenantId });
    const candidates = all.filter((d) => {
      if (d.start_date && now < Number(d.start_date)) return false;
      if (d.end_date && now > Number(d.end_date)) return false;
      const couponMatch = d.coupon_code && input.couponCode && d.coupon_code === input.couponCode;
      return d.auto_applicable === 1 || couponMatch;
    });

    const applied: AppliedDiscount[] = [];
    for (const d of candidates) {
      if (!this.eligible(d, input, subtotal)) continue;
      const amount = this.computeAmount(d, input, subtotal);
      if (amount > 0) applied.push({ discountId: d.id, name: d.name, ruleType: d.rule_type, amountCents: amount });
    }
    const totalDiscount = Math.min(subtotal, applied.reduce((s, a) => s + a.amountCents, 0));
    return { subtotalCents: subtotal, discounts: applied, totalDiscountCents: totalDiscount, netCents: subtotal - totalDiscount };
  }

  private eligible(d: Discount, input: EvaluateInput, subtotal: number): boolean {
    if (d.tier_restriction) {
      const tiers = d.tier_restriction.split(",").map((x) => Number(x));
      if (input.customerTier === undefined || !tiers.includes(input.customerTier)) return false;
    }
    if (Number(d.min_order_cents) > 0 && subtotal < Number(d.min_order_cents)) return false;
    const scopeLines = this.scopeLines(d, input.lines);
    if (scopeLines.length === 0 && d.apply_to !== "cart") return false;
    const scopeQty = scopeLines.reduce((s, l) => s + l.quantity, 0);
    if (Number(d.min_qty) > 0 && scopeQty < Number(d.min_qty)) return false;
    if (d.rule_type === "volume" && Number(d.min_qty) > 0 && scopeQty < Number(d.min_qty)) return false;
    if (d.rule_type === "bxgy" && scopeQty < Number(d.buy_qty) + Number(d.get_qty)) return false;
    return true;
  }

  private scopeLines(d: Discount, lines: CartLine[]): CartLine[] {
    if (d.apply_to === "cart") return lines;
    if (d.apply_to === "product") return lines.filter((l) => l.productId === d.target_id);
    return lines.filter((l) => (l.category ?? "") === d.target_id); // category
  }

  private computeAmount(d: Discount, input: EvaluateInput, subtotal: number): number {
    const scopeLines = this.scopeLines(d, input.lines);
    const base = d.apply_to === "cart" ? subtotal : scopeLines.reduce((s, l) => s + l.unitCents * l.quantity, 0);
    if (d.rule_type === "bxgy") {
      // Free get_qty units per (buy_qty + get_qty) group, valued at the cheapest eligible unit.
      const qty = scopeLines.reduce((s, l) => s + l.quantity, 0);
      const group = Number(d.buy_qty) + Number(d.get_qty);
      if (group <= 0) return 0;
      const freeUnits = Math.floor(qty / group) * Number(d.get_qty);
      const unit = Math.min(...scopeLines.map((l) => l.unitCents));
      return freeUnits * unit;
    }
    // simple + volume both reduce the scoped base.
    if (d.discount_type === "fixed") return Math.min(base, Number(d.value));
    return Math.round((base * Number(d.value)) / 100);
  }
}
