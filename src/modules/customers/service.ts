import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { HttpError, notFound } from "../../shared/http.js";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
}

export interface CustomerAddress {
  id: string;
  tenant_id: string;
  customer_id: string;
  address_type: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  county: string | null;
  is_default: boolean;
  created_at: number;
  updated_at: number;
}

export interface CustomerContact {
  id: string;
  tenant_id: string;
  customer_id: string;
  contact_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  created_at: number;
  updated_at: number;
}

export interface CustomerGroup {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface CustomerNote {
  id: string;
  tenant_id: string;
  customer_id: string;
  note: string;
  note_type: string;
  created_by: string | null;
  created_at: number;
}

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return 50;
  return Math.min(Math.floor(limit), 200);
}

export interface LoyaltyTierRule {
  id: string;
  tenant_id: string;
  name: string;
  tier_level: number;
  min_points: number;
  point_multiplier: number;
  discount_pct: number;
  created_at: number;
  updated_at: number;
}

export interface CreateTierRuleInput {
  name: string;
  tierLevel: number;
  minPoints: number;
  pointMultiplier: number;
  discountPct: number;
}

export interface LoyaltySummary {
  customerId: string;
  currentPoints: number;
  currentTierLevel: number;
  currentTierName: string | null;
  pointMultiplier: number;
  discountPct: number;
  nextTierName: string | null;
  pointsToNextTier: number | null;
}

/** Customers + loyalty. Tenant-scoped. Points are earned on payment.captured
 *  ($1 net spent = 1 point) and redeemed at 100 points = $5.00. */

export interface Customer {
  id: string;
  tenant_id: string;
  // Identity
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: number | null;
  driving_license_number: string | null;
  // Classification
  customer_type: 'retail' | 'business';
  primary_business: string | null;
  // Business profile
  company: string | null;
  dba: string | null;
  contact_person: string | null;
  fein_number: string | null;
  tax_id: string | null;
  license_no: string | null;
  sales_rep_id: string | null;
  sales_rep_name: string | null;
  // Regulatory/compliance licenses (tobacco/vape distribution)
  tobacco_id: string | null;
  tobacco_license_expiry: number | null;
  cigarette_id: string | null;
  cigarette_license_expiry: number | null;
  vapor_tax_id: string | null;
  vapor_tax_expiry: number | null;
  sales_tax_id: string | null;
  sales_tax_expiry: number | null;
  hemp_license_number: string | null;
  hemp_license_expiry: number | null;
  // Address (structured)
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  county: string | null;
  // Legacy address blobs (kept for backward compat)
  billing_address: string | null;
  shipping_address: string | null;
  // Financial
  tier: number;
  payment_term_days: number | null;
  credit_limit_cents: number | null;
  store_credit_cents: number;
  excess_cents: number;
  bank_name: string | null;
  // Status
  status: string;
  verified: number;
  ach_verified: number;
  points: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateCustomerInput {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  customerType?: 'retail' | 'business';
  primaryBusiness?: string | null;
  // Business profile
  company?: string | null;
  dba?: string | null;
  contactPerson?: string | null;
  feinNumber?: string | null;
  taxId?: string | null;
  licenseNo?: string | null;
  salesRepId?: string | null;
  salesRepName?: string | null;
  // Compliance licenses
  tobaccoId?: string | null;
  tobaccoLicenseExpiry?: number | null;
  cigaretteId?: string | null;
  cigaretteLicenseExpiry?: number | null;
  vaporTaxId?: string | null;
  vaporTaxExpiry?: number | null;
  salesTaxId?: string | null;
  salesTaxExpiry?: number | null;
  hempLicenseNumber?: string | null;
  hempLicenseExpiry?: number | null;
  // Address (structured)
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  county?: string | null;
  // Legacy address blobs
  billingAddress?: string | null;
  shippingAddress?: string | null;
  // Financial
  tier?: number;
  paymentTermDays?: number | null;
  creditLimitCents?: number | null;
  bankName?: string | null;
  // Retail
  dateOfBirth?: number | null;
  drivingLicenseNumber?: string | null;
  // Shared
  notes?: string | null;
}

/** Editable customer profile fields. All fields optional — only provided keys change. */
export interface UpdateCustomerInput {
  name?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  customerType?: 'retail' | 'business';
  primaryBusiness?: string | null;
  // Business profile
  company?: string | null;
  dba?: string | null;
  contactPerson?: string | null;
  feinNumber?: string | null;
  taxId?: string | null;
  licenseNo?: string | null;
  salesRepId?: string | null;
  salesRepName?: string | null;
  // Compliance licenses
  tobaccoId?: string | null;
  tobaccoLicenseExpiry?: number | null;
  cigaretteId?: string | null;
  cigaretteLicenseExpiry?: number | null;
  vaporTaxId?: string | null;
  vaporTaxExpiry?: number | null;
  salesTaxId?: string | null;
  salesTaxExpiry?: number | null;
  hempLicenseNumber?: string | null;
  hempLicenseExpiry?: number | null;
  // Address (structured)
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  county?: string | null;
  // Legacy address blobs
  billingAddress?: string | null;
  shippingAddress?: string | null;
  // Financial
  tier?: number;
  paymentTermDays?: number | null;
  creditLimitCents?: number | null;
  bankName?: string | null;
  // Retail
  dateOfBirth?: number | null;
  drivingLicenseNumber?: string | null;
  // Shared
  notes?: string | null;
  status?: string;
  verified?: boolean;
  achVerified?: boolean;
}

export interface CustomerFinancials {
  customerId: string;
  dueCents: number;        // open AR balance across invoices
  excessCents: number;     // overpayment credit on account
  storeCreditCents: number;
  openInvoices: number;
}

export interface CustomerSummary {
  customer: { id: string; name: string; email: string | null; phone: string | null; points: number };
  visits: number;
  totalSpentCents: number;
  avgOrderCents: number;
  lastVisitAt: number | null;
  recentOrders: Array<{ id: string; orderNumber: string; status: string; totalCents: number; createdAt: number }>;
}

/** Redemption rate: 100 points → 500 cents ($5.00). */
export const POINTS_PER_REDEEM_BLOCK = 100;
export const CENTS_PER_REDEEM_BLOCK = 500;

export class CustomersService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  async create(input: CreateCustomerInput, tenantId: string): Promise<Customer> {
    const now = Date.now();
    const id = `cus_${uuidv7()}`;
    await this.db.query(
      `INSERT INTO customers (
         id, tenant_id, name, first_name, last_name, email, phone, points,
         customer_type, primary_business,
         company, dba, contact_person, fein_number, tax_id, license_no,
         sales_rep_id, sales_rep_name,
         tobacco_id, tobacco_license_expiry,
         cigarette_id, cigarette_license_expiry,
         vapor_tax_id, vapor_tax_expiry,
         sales_tax_id, sales_tax_expiry,
         hemp_license_number, hemp_license_expiry,
         address1, address2, city, state, zip, country, county,
         billing_address, shipping_address,
         tier, payment_term_days, credit_limit_cents, bank_name,
         date_of_birth, driving_license_number, notes,
         created_at, updated_at
       ) VALUES (
         @id, @tenant_id, @name, @first_name, @last_name, @email, @phone, 0,
         @customer_type, @primary_business,
         @company, @dba, @contact_person, @fein_number, @tax_id, @license_no,
         @sales_rep_id, @sales_rep_name,
         @tobacco_id, @tobacco_license_expiry,
         @cigarette_id, @cigarette_license_expiry,
         @vapor_tax_id, @vapor_tax_expiry,
         @sales_tax_id, @sales_tax_expiry,
         @hemp_license_number, @hemp_license_expiry,
         @address1, @address2, @city, @state, @zip, @country, @county,
         @billing_address, @shipping_address,
         @tier, @payment_term_days, @credit_limit_cents, @bank_name,
         @date_of_birth, @driving_license_number, @notes,
         @created_at, @updated_at
       )`,
      {
        id,
        tenant_id: tenantId,
        name: input.name,
        first_name: input.firstName ?? null,
        last_name: input.lastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        customer_type: input.customerType ?? 'retail',
        primary_business: input.primaryBusiness ?? null,
        company: input.company ?? null,
        dba: input.dba ?? null,
        contact_person: input.contactPerson ?? null,
        fein_number: input.feinNumber ?? null,
        tax_id: input.taxId ?? null,
        license_no: input.licenseNo ?? null,
        sales_rep_id: input.salesRepId ?? null,
        sales_rep_name: input.salesRepName ?? null,
        tobacco_id: input.tobaccoId ?? null,
        tobacco_license_expiry: input.tobaccoLicenseExpiry ?? null,
        cigarette_id: input.cigaretteId ?? null,
        cigarette_license_expiry: input.cigaretteLicenseExpiry ?? null,
        vapor_tax_id: input.vaporTaxId ?? null,
        vapor_tax_expiry: input.vaporTaxExpiry ?? null,
        sales_tax_id: input.salesTaxId ?? null,
        sales_tax_expiry: input.salesTaxExpiry ?? null,
        hemp_license_number: input.hempLicenseNumber ?? null,
        hemp_license_expiry: input.hempLicenseExpiry ?? null,
        address1: input.address1 ?? null,
        address2: input.address2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        zip: input.zip ?? null,
        country: input.country ?? null,
        county: input.county ?? null,
        billing_address: input.billingAddress ?? null,
        shipping_address: input.shippingAddress ?? null,
        tier: input.tier ?? 5,
        payment_term_days: input.paymentTermDays ?? null,
        credit_limit_cents: input.creditLimitCents ?? null,
        bank_name: input.bankName ?? null,
        date_of_birth: input.dateOfBirth ?? null,
        driving_license_number: input.drivingLicenseNumber ?? null,
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      },
    );
    await this.events.publish("customer.created", { id, tenantId }, id);
    // Re-read so default-backed profile columns (tier, credit, status, …) are populated.
    return (await this.get(id, tenantId))!;
  }

  async get(id: string, tenantId: string): Promise<Customer | undefined> {
    return this.db.one<Customer>(
      "SELECT * FROM customers WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
  }

  async list(tenantId: string, query: { cursor?: string; limit?: number } = {}): Promise<CursorPage<Customer>> {
    const limit = clampLimit(query.limit);
    const cur = query.cursor
      ? (JSON.parse(Buffer.from(query.cursor, "base64url").toString()) as { at: number; id: string })
      : null;
    const where = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (cur) {
      where.push("(created_at, id) < (@curAt, @curId)");
      params.curAt = cur.at;
      params.curId = cur.id;
    }
    const items = await this.db.query<Customer>(
      `SELECT * FROM customers WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT @limit`,
      { ...params, limit },
    );
    const last = items[items.length - 1];
    const nextCursor =
      items.length === limit && last
        ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url")
        : null;
    return { items, nextCursor, limit };
  }

  /** Update editable profile fields. Only provided keys change. */
  async update(id: string, patch: UpdateCustomerInput, tenantId: string): Promise<Customer> {
    const current = await this.get(id, tenantId);
    if (!current) throw new HttpError(404, "not_found", `customer '${id}' not found`);
    if (patch.tier !== undefined && (patch.tier < 1 || patch.tier > 5)) throw new HttpError(400, "bad_request", "tier must be 1–5");
    const map: Record<string, unknown> = {
      name: patch.name,
      first_name: patch.firstName,
      last_name: patch.lastName,
      email: patch.email,
      phone: patch.phone,
      customer_type: patch.customerType,
      primary_business: patch.primaryBusiness,
      company: patch.company,
      dba: patch.dba,
      contact_person: patch.contactPerson,
      fein_number: patch.feinNumber,
      tax_id: patch.taxId,
      license_no: patch.licenseNo,
      sales_rep_id: patch.salesRepId,
      sales_rep_name: patch.salesRepName,
      tobacco_id: patch.tobaccoId,
      tobacco_license_expiry: patch.tobaccoLicenseExpiry,
      cigarette_id: patch.cigaretteId,
      cigarette_license_expiry: patch.cigaretteLicenseExpiry,
      vapor_tax_id: patch.vaporTaxId,
      vapor_tax_expiry: patch.vaporTaxExpiry,
      sales_tax_id: patch.salesTaxId,
      sales_tax_expiry: patch.salesTaxExpiry,
      hemp_license_number: patch.hempLicenseNumber,
      hemp_license_expiry: patch.hempLicenseExpiry,
      address1: patch.address1,
      address2: patch.address2,
      city: patch.city,
      state: patch.state,
      zip: patch.zip,
      country: patch.country,
      county: patch.county,
      billing_address: patch.billingAddress,
      shipping_address: patch.shippingAddress,
      tier: patch.tier,
      payment_term_days: patch.paymentTermDays,
      credit_limit_cents: patch.creditLimitCents,
      bank_name: patch.bankName,
      date_of_birth: patch.dateOfBirth,
      driving_license_number: patch.drivingLicenseNumber,
      notes: patch.notes,
      status: patch.status,
      verified: patch.verified === undefined ? undefined : patch.verified ? 1 : 0,
      ach_verified: patch.achVerified === undefined ? undefined : patch.achVerified ? 1 : 0,
    };
    const sets: string[] = [];
    const params: Record<string, unknown> = { id, tenantId, now: Date.now() };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { sets.push(`${col} = @${col}`); params[col] = val; }
    }
    if (sets.length === 0) return current;
    await this.db.query(`UPDATE customers SET ${sets.join(", ")}, updated_at = @now WHERE id = @id AND tenant_id = @tenantId`, params);
    return (await this.get(id, tenantId))!;
  }

  /** Financial summary: open AR due from invoices + on-account credit columns. */
  async financials(id: string, tenantId: string): Promise<CustomerFinancials> {
    const c = await this.get(id, tenantId);
    if (!c) throw new HttpError(404, "not_found", `customer '${id}' not found`);
    const row = await this.db.one<{ due: number; n: number }>(
      `SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS due, COUNT(*)::int AS n
         FROM invoices WHERE tenant_id = @t AND customer_id = @c AND status <> 'void' AND (total_cents - paid_cents) > 0`,
      { t: tenantId, c: id },
    );
    return {
      customerId: id,
      dueCents: Number(row?.due ?? 0),
      excessCents: Number(c.excess_cents ?? 0),
      storeCreditCents: Number(c.store_credit_cents ?? 0),
      openInvoices: Number(row?.n ?? 0),
    };
  }

  /** Redeem points for a cash-value discount. Must be a positive multiple of 100. */
  async redeem(
    customerId: string,
    points: number,
    tenantId: string,
  ): Promise<{ pointsRemaining: number; valueCents: number }> {
    if (points <= 0 || points % POINTS_PER_REDEEM_BLOCK !== 0) {
      throw new HttpError(400, "bad_request", `points must be a positive multiple of ${POINTS_PER_REDEEM_BLOCK}`);
    }
    const customer = await this.get(customerId, tenantId);
    if (!customer) throw new HttpError(404, "not_found", `customer '${customerId}' not found`);
    if (customer.points < points) {
      throw new HttpError(400, "insufficient_points", `balance ${customer.points} < requested ${points}`);
    }
    const remaining = customer.points - points;
    await this.db.query(
      "UPDATE customers SET points = @remaining, updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
      { remaining, now: Date.now(), id: customerId, tenantId },
    );
    const valueCents = (points / POINTS_PER_REDEEM_BLOCK) * CENTS_PER_REDEEM_BLOCK;
    await this.events.publish(
      "loyalty.points_redeemed",
      { customerId, tenantId, points, valueCents },
      customerId,
    );
    return { pointsRemaining: remaining, valueCents };
  }

  /** CRM summary: lifetime spend, visits, last visit, and a recent-orders timeline.
   *  Aggregates the shared orders table (completed orders) for this customer. */
  async summary(customerId: string, tenantId: string): Promise<CustomerSummary> {
    const customer = await this.get(customerId, tenantId);
    if (!customer) throw new HttpError(404, "not_found", `customer '${customerId}' not found`);
    const agg = await this.db.one<{ visits: number; spent: number; last: number | null }>(
      `SELECT COUNT(*)::int AS visits, COALESCE(SUM(total_cents),0) AS spent, MAX(created_at) AS last
         FROM orders WHERE tenant_id = @tenantId AND customer_id = @customerId AND status = 'completed'`,
      { tenantId, customerId },
    );
    const recent = await this.db.query<{ id: string; order_number: string; status: string; total_cents: number; created_at: number }>(
      `SELECT id, order_number, status, total_cents, created_at
         FROM orders WHERE tenant_id = @tenantId AND customer_id = @customerId
        ORDER BY created_at DESC LIMIT 10`,
      { tenantId, customerId },
    );
    const visits = Number(agg?.visits ?? 0);
    const totalSpentCents = Number(agg?.spent ?? 0);
    return {
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, points: Number(customer.points) },
      visits,
      totalSpentCents,
      avgOrderCents: visits > 0 ? Math.round(totalSpentCents / visits) : 0,
      lastVisitAt: agg?.last != null ? Number(agg.last) : null,
      recentOrders: recent.map((o) => ({
        id: o.id, orderNumber: o.order_number, status: o.status, totalCents: Number(o.total_cents), createdAt: Number(o.created_at),
      })),
    };
  }

  /** Resolve which customer (if any) an order belongs to. Reads the shared orders table. */
  async customerForOrder(orderId: string, tenantId: string): Promise<string | null> {
    const row = await this.db.one<{ customer_id: string | null }>(
      "SELECT customer_id FROM orders WHERE id = @orderId AND tenant_id = @tenantId",
      { orderId, tenantId },
    );
    return row?.customer_id ?? null;
  }

  // ── Loyalty tier rules ───────────────────────────────────────────────────────

  async listTierRules(tenantId: string): Promise<LoyaltyTierRule[]> {
    return this.db.query<LoyaltyTierRule>(
      "SELECT * FROM loyalty_tier_rules WHERE tenant_id = @t ORDER BY tier_level ASC",
      { t: tenantId },
    );
  }

  async upsertTierRule(tenantId: string, input: CreateTierRuleInput): Promise<LoyaltyTierRule> {
    const existing = await this.db.one<LoyaltyTierRule>(
      "SELECT * FROM loyalty_tier_rules WHERE tenant_id = @t AND tier_level = @l",
      { t: tenantId, l: input.tierLevel },
    );
    const now = Date.now();
    if (existing) {
      await this.db.query(
        `UPDATE loyalty_tier_rules SET name=@name, min_points=@mp, point_multiplier=@pm, discount_pct=@dp, updated_at=@now
         WHERE tenant_id=@t AND tier_level=@l`,
        { name: input.name, mp: input.minPoints, pm: input.pointMultiplier, dp: input.discountPct, now, t: tenantId, l: input.tierLevel },
      );
      return { ...existing, name: input.name, min_points: input.minPoints, point_multiplier: input.pointMultiplier, discount_pct: input.discountPct, updated_at: now };
    }
    const rule: LoyaltyTierRule = {
      id: uuidv7(), tenant_id: tenantId, name: input.name, tier_level: input.tierLevel,
      min_points: input.minPoints, point_multiplier: input.pointMultiplier, discount_pct: input.discountPct,
      created_at: now, updated_at: now,
    };
    await this.db.query(
      `INSERT INTO loyalty_tier_rules (id,tenant_id,name,tier_level,min_points,point_multiplier,discount_pct,created_at,updated_at)
       VALUES (@id,@t,@name,@l,@mp,@pm,@dp,@now,@now)`,
      { id: rule.id, t: tenantId, name: rule.name, l: rule.tier_level, mp: rule.min_points, pm: rule.point_multiplier, dp: rule.discount_pct, now },
    );
    return rule;
  }

  async deleteTierRule(tenantId: string, tierLevel: number): Promise<void> {
    await this.db.query(
      "DELETE FROM loyalty_tier_rules WHERE tenant_id = @t AND tier_level = @l",
      { t: tenantId, l: tierLevel },
    );
  }

  /** Add points and auto-upgrade tier if the customer now qualifies for a higher one. */
  async awardPoints(customerId: string, points: number, tenantId: string): Promise<void> {
    if (points <= 0) return;
    await this.db.query(
      `UPDATE customers SET points = points + @points, updated_at = @now
       WHERE id = @id AND tenant_id = @tenantId`,
      { points, now: Date.now(), id: customerId, tenantId },
    );
    // Auto-upgrade tier if tier rules are configured
    const rules = await this.listTierRules(tenantId);
    if (rules.length > 0) {
      const customer = await this.db.one<{ points: number; tier: number }>(
        "SELECT points, tier FROM customers WHERE id = @id AND tenant_id = @t",
        { id: customerId, t: tenantId },
      );
      if (customer) {
        const currentPoints = Number(customer.points);
        const bestTier = rules
          .filter((r) => currentPoints >= r.min_points)
          .sort((a, b) => b.tier_level - a.tier_level)[0];
        if (bestTier && bestTier.tier_level > Number(customer.tier)) {
          await this.db.query(
            "UPDATE customers SET tier = @tier, updated_at = @now WHERE id = @id AND tenant_id = @t",
            { tier: bestTier.tier_level, now: Date.now(), id: customerId, t: tenantId },
          );
          await this.events.publish("loyalty.tier_upgraded", { customerId, tenantId, newTier: bestTier.tier_level, tierName: bestTier.name }, customerId);
        }
      }
    }
    await this.events.publish(
      "loyalty.points_awarded",
      { customerId, tenantId, points },
      customerId,
    );
  }

  /** Loyalty summary: current tier info + points to next tier. */
  async loyaltySummary(customerId: string, tenantId: string): Promise<LoyaltySummary> {
    const customer = await this.get(customerId, tenantId);
    if (!customer) throw new HttpError(404, "not_found", `customer '${customerId}' not found`);
    const rules = await this.listTierRules(tenantId);
    const currentPoints = Number(customer.points);
    const currentRule = rules.find((r) => r.tier_level === Number(customer.tier)) ?? null;
    const nextRule = rules.find((r) => r.tier_level > Number(customer.tier) && r.min_points > currentPoints) ?? null;
    return {
      customerId,
      currentPoints,
      currentTierLevel: Number(customer.tier),
      currentTierName: currentRule?.name ?? null,
      pointMultiplier: currentRule?.point_multiplier ?? 1.0,
      discountPct: currentRule?.discount_pct ?? 0.0,
      nextTierName: nextRule?.name ?? null,
      pointsToNextTier: nextRule ? nextRule.min_points - currentPoints : null,
    };
  }

  // ── Customer Addresses ───────────────────────────────────────────────────────

  async addAddress(
    customerId: string,
    tenantId: string,
    input: {
      addressType?: string;
      addressLine1?: string | null;
      addressLine2?: string | null;
      city?: string | null;
      state?: string | null;
      zip?: string | null;
      country?: string;
      county?: string | null;
      isDefault?: boolean;
    },
  ): Promise<CustomerAddress> {
    const now = Date.now();
    const addr: CustomerAddress = {
      id: `cadr_${uuidv7()}`,
      tenant_id: tenantId,
      customer_id: customerId,
      address_type: input.addressType ?? "billing",
      address_line1: input.addressLine1 ?? null,
      address_line2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      zip: input.zip ?? null,
      country: input.country ?? "US",
      county: input.county ?? null,
      is_default: input.isDefault ?? false,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO customer_addresses (id, tenant_id, customer_id, address_type, address_line1, address_line2, city, state, zip, country, county, is_default, created_at, updated_at)
       VALUES (@id, @tenant_id, @customer_id, @address_type, @address_line1, @address_line2, @city, @state, @zip, @country, @county, @is_default, @created_at, @updated_at)`,
      addr as unknown as Record<string, unknown>,
    );
    return addr;
  }

  async listAddresses(customerId: string, tenantId: string): Promise<CustomerAddress[]> {
    return this.db.query<CustomerAddress>(
      "SELECT * FROM customer_addresses WHERE tenant_id = @tenantId AND customer_id = @customerId ORDER BY is_default DESC, created_at ASC",
      { tenantId, customerId },
    );
  }

  // ── Customer Contacts ────────────────────────────────────────────────────────

  async addContact(
    customerId: string,
    tenantId: string,
    input: {
      contactName: string;
      title?: string | null;
      email?: string | null;
      phone?: string | null;
      isPrimary?: boolean;
    },
  ): Promise<CustomerContact> {
    const now = Date.now();
    const contact: CustomerContact = {
      id: `ccnt_${uuidv7()}`,
      tenant_id: tenantId,
      customer_id: customerId,
      contact_name: input.contactName,
      title: input.title ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      is_primary: input.isPrimary ?? false,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO customer_contacts (id, tenant_id, customer_id, contact_name, title, email, phone, is_primary, created_at, updated_at)
       VALUES (@id, @tenant_id, @customer_id, @contact_name, @title, @email, @phone, @is_primary, @created_at, @updated_at)`,
      contact as unknown as Record<string, unknown>,
    );
    return contact;
  }

  async listContacts(customerId: string, tenantId: string): Promise<CustomerContact[]> {
    return this.db.query<CustomerContact>(
      "SELECT * FROM customer_contacts WHERE tenant_id = @tenantId AND customer_id = @customerId ORDER BY is_primary DESC, created_at ASC",
      { tenantId, customerId },
    );
  }

  async updateContact(
    contactId: string,
    tenantId: string,
    input: { contactName?: string; title?: string | null; email?: string | null; phone?: string | null; isPrimary?: boolean },
  ): Promise<CustomerContact> {
    const rows = await this.db.query<CustomerContact>(
      "SELECT * FROM customer_contacts WHERE id = @contactId AND tenant_id = @tenantId",
      { contactId, tenantId },
    );
    if (!rows[0]) throw notFound("customer_contact");
    const now = Date.now();
    const updated: CustomerContact = {
      ...rows[0],
      contact_name: input.contactName ?? rows[0].contact_name,
      title: input.title !== undefined ? input.title : rows[0].title,
      email: input.email !== undefined ? input.email : rows[0].email,
      phone: input.phone !== undefined ? input.phone : rows[0].phone,
      is_primary: input.isPrimary !== undefined ? input.isPrimary : rows[0].is_primary,
      updated_at: now,
    };
    await this.db.query(
      `UPDATE customer_contacts SET contact_name=@contact_name, title=@title, email=@email,
       phone=@phone, is_primary=@is_primary, updated_at=@updated_at WHERE id=@id`,
      { ...updated, id: contactId } as unknown as Record<string, unknown>,
    );
    return updated;
  }

  async deleteContact(contactId: string, tenantId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      "SELECT id FROM customer_contacts WHERE id = @contactId AND tenant_id = @tenantId",
      { contactId, tenantId },
    );
    if (!rows[0]) throw notFound("customer_contact");
    await this.db.query(
      "DELETE FROM customer_contacts WHERE id = @contactId AND tenant_id = @tenantId",
      { contactId, tenantId },
    );
  }

  async updateAddress(
    addressId: string,
    tenantId: string,
    input: { addressType?: string; addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string; county?: string | null; isDefault?: boolean },
  ): Promise<CustomerAddress> {
    const rows = await this.db.query<CustomerAddress>(
      "SELECT * FROM customer_addresses WHERE id = @addressId AND tenant_id = @tenantId",
      { addressId, tenantId },
    );
    if (!rows[0]) throw notFound("customer_address");
    const now = Date.now();
    const updated: CustomerAddress = {
      ...rows[0],
      address_type: input.addressType ?? rows[0].address_type,
      address_line1: input.addressLine1 !== undefined ? input.addressLine1 : rows[0].address_line1,
      address_line2: input.addressLine2 !== undefined ? input.addressLine2 : rows[0].address_line2,
      city: input.city !== undefined ? input.city : rows[0].city,
      state: input.state !== undefined ? input.state : rows[0].state,
      zip: input.zip !== undefined ? input.zip : rows[0].zip,
      country: input.country ?? rows[0].country,
      county: input.county !== undefined ? input.county : rows[0].county,
      is_default: input.isDefault !== undefined ? input.isDefault : rows[0].is_default,
      updated_at: now,
    };
    await this.db.query(
      `UPDATE customer_addresses SET address_type=@address_type, address_line1=@address_line1,
       address_line2=@address_line2, city=@city, state=@state, zip=@zip, country=@country,
       county=@county, is_default=@is_default, updated_at=@updated_at WHERE id=@id`,
      { ...updated, id: addressId } as unknown as Record<string, unknown>,
    );
    return updated;
  }

  async deleteAddress(addressId: string, tenantId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      "SELECT id FROM customer_addresses WHERE id = @addressId AND tenant_id = @tenantId",
      { addressId, tenantId },
    );
    if (!rows[0]) throw notFound("customer_address");
    await this.db.query(
      "DELETE FROM customer_addresses WHERE id = @addressId AND tenant_id = @tenantId",
      { addressId, tenantId },
    );
  }

  // ── Customer Groups ──────────────────────────────────────────────────────────

  async listGroups(tenantId: string): Promise<CustomerGroup[]> {
    return this.db.query<CustomerGroup>(
      "SELECT * FROM customer_groups WHERE tenant_id = @tenantId ORDER BY name ASC",
      { tenantId },
    );
  }

  async createGroup(tenantId: string, input: { name: string; description?: string | null }): Promise<CustomerGroup> {
    const now = Date.now();
    const group: CustomerGroup = {
      id: `cgrp_${uuidv7()}`,
      tenant_id: tenantId,
      name: input.name,
      description: input.description ?? null,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      "INSERT INTO customer_groups (id, tenant_id, name, description, created_at, updated_at) VALUES (@id, @tenant_id, @name, @description, @created_at, @updated_at)",
      group as unknown as Record<string, unknown>,
    );
    return group;
  }

  async addToGroup(customerId: string, groupId: string, tenantId: string): Promise<void> {
    const now = Date.now();
    await this.db.query(
      `INSERT INTO customer_group_members (id, tenant_id, customer_id, customer_group_id, created_at)
       VALUES (@id, @tenantId, @customerId, @groupId, @now)
       ON CONFLICT (tenant_id, customer_id, customer_group_id) DO NOTHING`,
      { id: `cgm_${uuidv7()}`, tenantId, customerId, groupId, now },
    );
  }

  // ── Customer Notes ───────────────────────────────────────────────────────────

  async addNote(
    customerId: string,
    tenantId: string,
    note: string,
    noteType?: string,
    createdBy?: string | null,
  ): Promise<CustomerNote> {
    const now = Date.now();
    const n: CustomerNote = {
      id: `cnote_${uuidv7()}`,
      tenant_id: tenantId,
      customer_id: customerId,
      note,
      note_type: noteType ?? "general",
      created_by: createdBy ?? null,
      created_at: now,
    };
    await this.db.query(
      "INSERT INTO customer_notes (id, tenant_id, customer_id, note, note_type, created_by, created_at) VALUES (@id, @tenant_id, @customer_id, @note, @note_type, @created_by, @created_at)",
      n as unknown as Record<string, unknown>,
    );
    return n;
  }

  async listNotes(customerId: string, tenantId: string): Promise<CustomerNote[]> {
    return this.db.query<CustomerNote>(
      "SELECT * FROM customer_notes WHERE tenant_id = @tenantId AND customer_id = @customerId ORDER BY created_at DESC",
      { tenantId, customerId },
    );
  }

  // ── Store Credit ───────────────────────────────────────────────────────────

  // ── Customer-specific price overrides (BE-39) ─────────────────────────────

  async listPriceOverrides(customerId: string, tenantId: string) {
    return this.db.query(
      "SELECT id, product_id, price_cents, updated_at FROM customer_product_prices WHERE tenant_id = @tenantId AND customer_id = @customerId ORDER BY updated_at DESC LIMIT 500",
      { tenantId, customerId },
    );
  }

  async upsertPriceOverride(
    customerId: string,
    productId: string,
    priceCents: number,
    tenantId: string,
  ) {
    const now = Date.now();
    const id = `cpp_${uuidv7()}`;
    await this.db.query(
      `INSERT INTO customer_product_prices (id, tenant_id, customer_id, product_id, price_cents, created_at, updated_at)
       VALUES (@id, @tenantId, @customerId, @productId, @priceCents, @now, @now)
       ON CONFLICT (tenant_id, customer_id, product_id)
       DO UPDATE SET price_cents = @priceCents, updated_at = @now`,
      { id, tenantId, customerId, productId, priceCents, now },
    );
    return this.db.one(
      "SELECT id, product_id, price_cents, updated_at FROM customer_product_prices WHERE tenant_id = @tenantId AND customer_id = @customerId AND product_id = @productId",
      { tenantId, customerId, productId },
    );
  }

  async deletePriceOverride(customerId: string, productId: string, tenantId: string) {
    await this.db.query(
      "DELETE FROM customer_product_prices WHERE tenant_id = @tenantId AND customer_id = @customerId AND product_id = @productId",
      { tenantId, customerId, productId },
    );
  }

  /** Resolve the effective price for a customer + product (Implementation Prompt §5.2 rule 1).
   *  Priority: customer-specific override → product standard price.
   */
  async resolvePriceForCustomer(customerId: string, productId: string, tenantId: string) {
    const override = await this.db.one<{ price_cents: number }>(
      "SELECT price_cents FROM customer_product_prices WHERE tenant_id = @tenantId AND customer_id = @customerId AND product_id = @productId",
      { tenantId, customerId, productId },
    );
    if (override) return { priceCents: Number(override.price_cents), source: "customer_override" as const };
    const product = await this.db.one<{ price_cents: number }>(
      "SELECT price_cents FROM products WHERE tenant_id = @tenantId AND id = @productId",
      { tenantId, productId },
    );
    return { priceCents: Number(product?.price_cents ?? 0), source: "standard" as const };
  }

  /** Return the current store credit balance for a customer. */
  async getStoreCredit(customerId: string, tenantId: string): Promise<{ balanceCents: number }> {
    const row = await this.db.one<{ store_credit_cents: number }>(
      "SELECT store_credit_cents FROM customers WHERE id = @id AND tenant_id = @t",
      { id: customerId, t: tenantId },
    );
    if (!row) throw new HttpError(404, "not_found", `customer '${customerId}' not found`);
    return { balanceCents: Number(row.store_credit_cents) };
  }

  /**
   * Apply a signed delta to a customer's store credit balance.
   * Positive delta = add credit (manager-gated at the route level).
   * Negative delta = deduct (checkout path).
   * Enforces balance ≥ 0 (rule #10 from Implementation Prompt).
   */
  async adjustStoreCredit(
    customerId: string,
    deltaCents: number,
    reason: string,
    tenantId: string,
  ): Promise<{ balanceCents: number }> {
    if (!Number.isInteger(deltaCents) || deltaCents === 0) {
      throw new HttpError(400, "bad_request", "deltaCents must be a non-zero integer");
    }

    return this.db.withTenant(tenantId).tx(async (tdb) => {
      const row = await tdb.one<{ store_credit_cents: number }>(
        "SELECT store_credit_cents FROM customers WHERE id = @id AND tenant_id = @t FOR UPDATE",
        { id: customerId, t: tenantId },
      );
      if (!row) throw new HttpError(404, "not_found", `customer '${customerId}' not found`);

      const current = Number(row.store_credit_cents);
      const next = current + deltaCents;

      if (next < 0) {
        throw new HttpError(
          400,
          "insufficient_store_credit",
          `Store credit balance ${current} is less than the requested deduction of ${Math.abs(deltaCents)}.`,
        );
      }

      await tdb.query(
        "UPDATE customers SET store_credit_cents = @next WHERE id = @id AND tenant_id = @t",
        { next, id: customerId, t: tenantId },
      );

      void this.events.publish(
        deltaCents > 0 ? "store_credit.added" : "store_credit.debited",
        { customerId, tenantId, deltaCents, balanceCents: next, reason },
        customerId,
      );

      return { balanceCents: next };
    });
  }

  /** Lightweight lookup for the merge dialog: name/email/phone substring match,
   *  small bounded result. Matches web CustomerSearchResult (shared.tsx). */
  async search(tenantId: string, q: string): Promise<{ items: Array<{ id: string; name: string; email: string; phone: string }> }> {
    const term = q.trim();
    if (!term) return { items: [] };
    const items = await this.db.query<{ id: string; name: string; email: string; phone: string }>(
      `SELECT id, name, COALESCE(email, '') AS email, COALESCE(phone, '') AS phone
       FROM customers
       WHERE tenant_id = @t
         AND (name ILIKE @like OR email ILIKE @like OR phone ILIKE @like)
       ORDER BY name ASC
       LIMIT 10`,
      { t: tenantId, like: `%${term}%` },
    );
    return { items };
  }

  /**
   * Merge a duplicate customer into another. One transaction:
   *  - both rows locked FOR UPDATE in a deterministic (sorted) order so two
   *    concurrent merges can't deadlock;
   *  - referencing rows (orders, invoices, quotes, sales orders) repointed;
   *  - satellite rows moved — group memberships and per-product price overrides
   *    only where the survivor doesn't already have the same row (survivor's
   *    own data always wins a conflict);
   *  - loyalty points and store credit balances added together;
   *  - the duplicate row deleted, and `customer.merged` published so other
   *    modules (verticals, analytics) can react without a hard dependency.
   */
  async merge(intoId: string, fromId: string, tenantId: string): Promise<Customer> {
    if (intoId === fromId) {
      throw new HttpError(400, "bad_request", "a customer cannot be merged into itself");
    }
    const merged = await this.db.withTenant(tenantId).tx(async (tdb) => {
      // Deterministic lock order prevents A→B / B→A merge deadlocks.
      const [firstId, secondId] = [intoId, fromId].sort();
      const lock = async (id: string) =>
        tdb.one<{ id: string; points: number; store_credit_cents: number }>(
          "SELECT id, points, store_credit_cents FROM customers WHERE id = @id AND tenant_id = @t FOR UPDATE",
          { id, t: tenantId },
        );
      const first = await lock(firstId);
      const second = await lock(secondId);
      const into = firstId === intoId ? first : second;
      const from = firstId === fromId ? first : second;
      if (!into) throw new HttpError(404, "not_found", `customer '${intoId}' not found`);
      if (!from) throw new HttpError(404, "not_found", `customer '${fromId}' not found`);

      // Repoint document history. (Same direct-table pattern the financials
      // endpoints in this module already use.)
      for (const table of ["orders", "customer_invoices", "quotations", "sales_orders"]) {
        await tdb.query(
          `UPDATE ${table} SET customer_id = @into WHERE tenant_id = @t AND customer_id = @from`,
          { into: intoId, from: fromId, t: tenantId },
        );
      }

      // Satellite data owned by this module.
      for (const table of ["customer_addresses", "customer_contacts", "customer_notes"]) {
        await tdb.query(
          `UPDATE ${table} SET customer_id = @into WHERE tenant_id = @t AND customer_id = @from`,
          { into: intoId, from: fromId, t: tenantId },
        );
      }
      // Group memberships: move only where the survivor isn't already a member.
      await tdb.query(
        `UPDATE customer_group_members m SET customer_id = @into
         WHERE m.tenant_id = @t AND m.customer_id = @from
           AND NOT EXISTS (
             SELECT 1 FROM customer_group_members e
             WHERE e.tenant_id = @t AND e.customer_id = @into
               AND e.customer_group_id = m.customer_group_id)`,
        { into: intoId, from: fromId, t: tenantId },
      );
      await tdb.query(
        "DELETE FROM customer_group_members WHERE tenant_id = @t AND customer_id = @from",
        { from: fromId, t: tenantId },
      );
      // Price overrides: survivor's own override wins; move the rest.
      await tdb.query(
        `UPDATE customer_product_prices p SET customer_id = @into
         WHERE p.tenant_id = @t AND p.customer_id = @from
           AND NOT EXISTS (
             SELECT 1 FROM customer_product_prices e
             WHERE e.tenant_id = @t AND e.customer_id = @into
               AND e.product_id = p.product_id)`,
        { into: intoId, from: fromId, t: tenantId },
      );
      await tdb.query(
        "DELETE FROM customer_product_prices WHERE tenant_id = @t AND customer_id = @from",
        { from: fromId, t: tenantId },
      );

      // Balances add together; the duplicate row goes away.
      await tdb.query(
        `UPDATE customers
         SET points = points + @pts, store_credit_cents = store_credit_cents + @credit, updated_at = @now
         WHERE id = @into AND tenant_id = @t`,
        { into: intoId, pts: Number(from.points), credit: Number(from.store_credit_cents), now: Date.now(), t: tenantId },
      );
      await tdb.query(
        "DELETE FROM customers WHERE id = @from AND tenant_id = @t",
        { from: fromId, t: tenantId },
      );

      return (await tdb.one<Customer>(
        "SELECT * FROM customers WHERE id = @into AND tenant_id = @t",
        { into: intoId, t: tenantId },
      ))!;
    });

    void this.events.publish(
      "customer.merged",
      { tenantId, mergedIntoId: intoId, mergedFromId: fromId },
      intoId,
    );
    return merged;
  }
}
