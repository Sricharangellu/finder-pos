import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { notFound } from "../../shared/http.js";

/**
 * Settings module (ERP benchmark #13): shipping methods, payment terms, payment
 * modes, tax rates, plus a key/value store for the business profile and feature
 * flags. Tenant-scoped. Mutations are role-gated at the route layer.
 */

export interface ShippingMethod {
  id: string; tenant_id: string; name: string; amount_cents: number; free_limit_cents: number | null;
  ecommerce: number; sequence: number; credit_account_id: string | null; debit_account_id: string | null; active: number;
}
export interface PaymentTerm { id: string; tenant_id: string; name: string; days_due: number; description: string | null; active: number; }
export interface PaymentMode { id: string; tenant_id: string; name: string; active: number; }
export interface TaxRate { id: string; tenant_id: string; name: string; rate_bps: number; apply_to_category: string | null; state: string | null; active: number; }

const DEFAULT_FLAGS: Record<string, boolean> = {
  quotations: true, achBatchPayout: false, imeiTracking: false, msaReporting: false,
  compositeProducts: false, customerPortal: false, ecommerce: true, commissionTracking: false,
  pickerFulfillment: true, batchDeposits: true,
};

export class SettingsService {
  constructor(private readonly db: DB) {}

  // ── Key/value: business profile + feature flags ──────────────────────────
  private async kvGet<T>(key: string, tenantId: string, fallback: T): Promise<T> {
    const row = await this.db.one<{ value_json: string }>("SELECT value_json FROM settings_kv WHERE tenant_id = @t AND key = @k", { t: tenantId, k: key });
    return row ? (JSON.parse(row.value_json) as T) : fallback;
  }
  private async kvSet(key: string, value: unknown, tenantId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO settings_kv (tenant_id, key, value_json, updated_at) VALUES (@t,@k,@v,@now)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at`,
      { t: tenantId, k: key, v: JSON.stringify(value), now: Date.now() },
    );
  }

  getBusiness(tenantId: string) { return this.kvGet("business", tenantId, {} as Record<string, unknown>); }
  async setBusiness(patch: Record<string, unknown>, tenantId: string) {
    const cur = await this.getBusiness(tenantId);
    const merged = { ...cur, ...patch };
    await this.kvSet("business", merged, tenantId);
    return merged;
  }
  async getFlags(tenantId: string) { return { ...DEFAULT_FLAGS, ...(await this.kvGet("feature_flags", tenantId, {} as Record<string, boolean>)) }; }
  async setFlags(patch: Record<string, boolean>, tenantId: string) {
    const cur = await this.kvGet("feature_flags", tenantId, {} as Record<string, boolean>);
    const merged = { ...cur, ...patch };
    await this.kvSet("feature_flags", merged, tenantId);
    return { ...DEFAULT_FLAGS, ...merged };
  }

  // ── Shipping methods ──────────────────────────────────────────────────────
  async listShipping(tenantId: string) {
    return this.db.query<ShippingMethod>("SELECT * FROM shipping_methods WHERE tenant_id = @t ORDER BY sequence ASC, name ASC", { t: tenantId });
  }
  async createShipping(b: { name: string; amountCents: number; freeLimitCents?: number; ecommerce?: boolean; sequence?: number; creditAccountId?: string; debitAccountId?: string }, tenantId: string) {
    const row: ShippingMethod = { id: `shm_${uuidv7()}`, tenant_id: tenantId, name: b.name, amount_cents: b.amountCents, free_limit_cents: b.freeLimitCents ?? null, ecommerce: b.ecommerce ? 1 : 0, sequence: b.sequence ?? 0, credit_account_id: b.creditAccountId ?? null, debit_account_id: b.debitAccountId ?? null, active: 1 };
    await this.db.query(
      `INSERT INTO shipping_methods (id, tenant_id, name, amount_cents, free_limit_cents, ecommerce, sequence, credit_account_id, debit_account_id, active)
       VALUES (@id,@tenant_id,@name,@amount_cents,@free_limit_cents,@ecommerce,@sequence,@credit_account_id,@debit_account_id,@active)`,
      row as unknown as Record<string, unknown>,
    );
    return row;
  }
  async deleteShipping(id: string, tenantId: string) {
    const r = await this.db.one("SELECT id FROM shipping_methods WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!r) throw notFound(`shipping method '${id}' not found`);
    await this.db.query("DELETE FROM shipping_methods WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    return { ok: true };
  }

  // ── Payment terms ─────────────────────────────────────────────────────────
  async listTerms(tenantId: string) { return this.db.query<PaymentTerm>("SELECT * FROM payment_terms WHERE tenant_id = @t ORDER BY days_due ASC", { t: tenantId }); }
  async createTerm(b: { name: string; daysDue: number; description?: string }, tenantId: string) {
    const row: PaymentTerm = { id: `pt_${uuidv7()}`, tenant_id: tenantId, name: b.name, days_due: b.daysDue, description: b.description ?? null, active: 1 };
    await this.db.query("INSERT INTO payment_terms (id, tenant_id, name, days_due, description, active) VALUES (@id,@tenant_id,@name,@days_due,@description,@active)", row as unknown as Record<string, unknown>);
    return row;
  }

  // ── Payment modes ─────────────────────────────────────────────────────────
  async listModes(tenantId: string) { return this.db.query<PaymentMode>("SELECT * FROM payment_modes WHERE tenant_id = @t ORDER BY name ASC", { t: tenantId }); }
  async createMode(b: { name: string }, tenantId: string) {
    const row: PaymentMode = { id: `pm_${uuidv7()}`, tenant_id: tenantId, name: b.name, active: 1 };
    await this.db.query("INSERT INTO payment_modes (id, tenant_id, name, active) VALUES (@id,@tenant_id,@name,@active)", row as unknown as Record<string, unknown>);
    return row;
  }

  // ── Tax rates ─────────────────────────────────────────────────────────────
  async listTaxRates(tenantId: string) { return this.db.query<TaxRate>("SELECT * FROM tax_rates WHERE tenant_id = @t ORDER BY name ASC", { t: tenantId }); }
  async createTaxRate(b: { name: string; rateBps: number; applyToCategory?: string; state?: string }, tenantId: string) {
    const row: TaxRate = { id: `tax_${uuidv7()}`, tenant_id: tenantId, name: b.name, rate_bps: b.rateBps, apply_to_category: b.applyToCategory ?? null, state: b.state ?? null, active: 1 };
    await this.db.query("INSERT INTO tax_rates (id, tenant_id, name, rate_bps, apply_to_category, state, active) VALUES (@id,@tenant_id,@name,@rate_bps,@apply_to_category,@state,@active)", row as unknown as Record<string, unknown>);
    return row;
  }

  /** Seed sensible defaults (idempotent: only when a table is empty). */
  async seedDefaults(tenantId: string) {
    const sm = await this.listShipping(tenantId);
    if (sm.length === 0) {
      await this.createShipping({ name: "Delivery", amountCents: 1500, sequence: 1, ecommerce: true }, tenantId);
      await this.createShipping({ name: "In-store Pickup", amountCents: 0, sequence: 2, ecommerce: true }, tenantId);
    }
    const pt = await this.listTerms(tenantId);
    if (pt.length === 0) {
      for (const [name, days] of [["COD", 0], ["Net 15", 15], ["Net 30", 30]] as Array<[string, number]>) await this.createTerm({ name, daysDue: days }, tenantId);
    }
    const pm = await this.listModes(tenantId);
    if (pm.length === 0) for (const name of ["Cash", "Check", "ACH", "Credit Card", "Wire"]) await this.createMode({ name }, tenantId);
    return { ok: true };
  }
}
