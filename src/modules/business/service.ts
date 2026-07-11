import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { badRequest, notFound, forbidden } from "../../shared/http.js";
import { DEMO_TENANT_ID } from "../../identity/service.js";

// ── Public shapes ───────────────────────────────────────────────────────────

export interface BusinessUnit {
  id: string;
  name: string;
  kind: string;               // "retail" | "wholesale" | "ecommerce" | ...
  channels: string[];         // "retail_pos" | "wholesale_b2b" | ...
  modules: string[];          // module keys the unit exposes in navigation
  defaultRoute: string;       // where this unit lands the user
  status?: string;
}

export interface MeContext {
  tenantId: string;
  userId: string;
  role: string;
  activeBusinessUnitId: string | null;
  businessUnits: BusinessUnit[];
  permissions: string[];
}

export interface CreateBusinessUnitInput {
  name: string;
  kind: string;
  channels?: string[];
  modules?: string[];
  defaultRoute?: string;
}

export interface UpdateBusinessUnitInput {
  name?: string;
  kind?: string;
  channels?: string[];
  modules?: string[];
  defaultRoute?: string;
  status?: "active" | "inactive";
}

export interface CapabilityRow {
  id: string;
  tenant_id: string;
  business_unit_id: string | null;
  capability: string;
  module_key: string;
  feature_key: string;
  enabled: boolean;
  config_json: string;
  created_at: number;
  updated_at: number;
}

export interface UpsertCapabilityInput {
  businessUnitId?: string | null;
  moduleKey: string;
  featureKey: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

// ── Internal row type ───────────────────────────────────────────────────────

interface BuRow {
  id: string;
  tenant_id: string;
  name: string;
  kind: string;
  modules: string;            // JSON array of module keys
  default_route: string;
  status: string;
  created_at: number;
  updated_at: number;
}

// Only the owner sees every business unit; managers/cashiers are scoped to the
// units granted in user_business_unit_access. This is the separation boundary.
function isPrivileged(role: string): boolean {
  return role === "owner";
}

// v1 permission derivation: each accessible unit's kind unlocks a representative
// permission set. Real per-user RBAC lives in the identity/permissions ticket;
// the frontend already keys navigation off these strings, so keep them stable.
const KIND_PERMISSIONS: Record<string, string[]> = {
  retail: [
    "retail.pos.checkout",
    "retail.orders.view",
    "retail.customers.view",
    "retail.inventory.view",
    "retail.reports.view",
  ],
  wholesale: [
    "wholesale.quotes.create",
    "wholesale.sales_orders.create",
    "wholesale.invoices.view",
    "wholesale.ar.view",
    "wholesale.warehouse.view",
  ],
  ecommerce: [
    "ecommerce.catalog.manage",
    "ecommerce.orders.view",
  ],
};

export class BusinessService {
  constructor(private readonly db: DB) {}

  // ── Context / listing ─────────────────────────────────────────────────────

  /** Assemble the caller's app context — the single source the frontend reads. */
  async getContext(tenantId: string, userId: string, role: string): Promise<MeContext> {
    const businessUnits = await this.listBusinessUnits(tenantId, userId, role);
    const active = await this.activeBusinessUnitId(tenantId, userId, businessUnits);
    return {
      tenantId,
      userId,
      role,
      activeBusinessUnitId: active,
      businessUnits,
      permissions: this.permissionsFor(businessUnits),
    };
  }

  /** Business units the caller may access, oldest first. */
  async listBusinessUnits(tenantId: string, userId: string, role: string): Promise<BusinessUnit[]> {
    const rows = isPrivileged(role)
      ? await this.db.query<BuRow>(
          "SELECT * FROM business_units WHERE tenant_id = @t AND status = 'active' ORDER BY created_at ASC",
          { t: tenantId },
        )
      : await this.db.query<BuRow>(
          `SELECT bu.* FROM business_units bu
             JOIN user_business_unit_access acc
               ON acc.business_unit_id = bu.id AND acc.tenant_id = bu.tenant_id
            WHERE bu.tenant_id = @t AND acc.user_id = @u AND bu.status = 'active'
            ORDER BY bu.created_at ASC`,
          { t: tenantId, u: userId },
        );
    return Promise.all(rows.map((r) => this.toBusinessUnit(r)));
  }

  /** Fetch one unit, enforcing access for non-owners. */
  async getBusinessUnit(id: string, tenantId: string, userId: string, role: string): Promise<BusinessUnit> {
    const row = await this.db.one<BuRow>(
      "SELECT * FROM business_units WHERE id = @id AND tenant_id = @t",
      { id, t: tenantId },
    );
    if (!row) throw notFound(`business unit '${id}' not found`);
    if (!isPrivileged(role) && !(await this.hasAccess(tenantId, userId, id))) {
      throw forbidden("You do not have access to this business unit.");
    }
    return this.toBusinessUnit(row);
  }

  async updateBusinessUnit(id: string, input: UpdateBusinessUnitInput, tenantId: string): Promise<BusinessUnit> {
    const row = await this.db.one<BuRow>(
      "SELECT * FROM business_units WHERE id = @id AND tenant_id = @t",
      { id, t: tenantId },
    );
    if (!row) throw notFound(`business unit '${id}' not found`);

    const now = Date.now();
    const nextModules = input.modules === undefined ? row.modules : JSON.stringify(dedupe(input.modules));
    const updated = await this.db.one<BuRow>(
      `UPDATE business_units
       SET name = @name, kind = @kind, modules = @modules, default_route = @route,
           status = @status, updated_at = @now
       WHERE id = @id AND tenant_id = @t
       RETURNING *`,
      {
        id,
        t: tenantId,
        name: input.name?.trim() ?? row.name,
        kind: input.kind?.trim() ?? row.kind,
        modules: nextModules,
        route: input.defaultRoute?.trim() ?? row.default_route,
        status: input.status ?? row.status ?? "active",
        now,
      },
    );
    if (!updated) throw notFound(`business unit '${id}' not found`);
    if (input.channels) await this.replaceChannels(tenantId, id, input.channels, now);
    return this.toBusinessUnit(updated);
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  /** Create a business unit plus its channels. Caller-gated to owner at the route. */
  async createBusinessUnit(input: CreateBusinessUnitInput, tenantId: string): Promise<BusinessUnit> {
    const now = Date.now();
    const id = `bu_${uuidv7()}`;
    await this.db.query(
      `INSERT INTO business_units (id, tenant_id, name, kind, modules, default_route, created_at, updated_at)
       VALUES (@id, @t, @name, @kind, @modules, @route, @now, @now)`,
      {
        id,
        t: tenantId,
        name: input.name.trim(),
        kind: input.kind.trim(),
        modules: JSON.stringify(input.modules ?? []),
        route: input.defaultRoute?.trim() || "/",
        now,
      },
    );
    for (const channel of dedupe(input.channels ?? [])) {
      await this.addChannel(tenantId, id, channel, now);
    }
    return this.toBusinessUnit(
      (await this.db.one<BuRow>("SELECT * FROM business_units WHERE id = @id AND tenant_id = @t", { id, t: tenantId }))!,
    );
  }

  async listCapabilities(tenantId: string, businessUnitId?: string): Promise<CapabilityRow[]> {
    const where = businessUnitId
      ? "tenant_id = @t AND business_unit_id = @bu"
      : "tenant_id = @t";
    return this.db.query<CapabilityRow>(
      `SELECT id, tenant_id, business_unit_id, capability,
              COALESCE(module_key, capability) AS module_key,
              COALESCE(feature_key, capability) AS feature_key,
              enabled, config_json, created_at, updated_at
       FROM tenant_capabilities
       WHERE ${where}
       ORDER BY module_key ASC, feature_key ASC`,
      { t: tenantId, bu: businessUnitId },
    );
  }

  async upsertCapability(input: UpsertCapabilityInput, tenantId: string): Promise<CapabilityRow> {
    const moduleKey = input.moduleKey.trim();
    const featureKey = input.featureKey.trim();
    if (!moduleKey || !featureKey) throw badRequest("moduleKey and featureKey are required");

    if (input.businessUnitId) {
      const unit = await this.db.one<{ id: string }>(
        "SELECT id FROM business_units WHERE id = @id AND tenant_id = @t",
        { id: input.businessUnitId, t: tenantId },
      );
      if (!unit) throw notFound(`business unit '${input.businessUnitId}' not found`);
    }

    const businessUnitId = input.businessUnitId ?? null;
    const existing = businessUnitId
      ? await this.db.one<CapabilityRow>(
          `SELECT * FROM tenant_capabilities
           WHERE tenant_id = @t AND business_unit_id = @bu AND module_key = @moduleKey AND feature_key = @featureKey`,
          { t: tenantId, bu: businessUnitId, moduleKey, featureKey },
        )
      : await this.db.one<CapabilityRow>(
          `SELECT * FROM tenant_capabilities
           WHERE tenant_id = @t AND business_unit_id IS NULL AND module_key = @moduleKey AND feature_key = @featureKey`,
          { t: tenantId, moduleKey, featureKey },
        );

    const now = Date.now();
    const configJson = JSON.stringify(input.config ?? {});
    if (existing) {
      const updated = await this.db.one<CapabilityRow>(
        `UPDATE tenant_capabilities
         SET enabled = @enabled, config_json = @configJson, updated_at = @now
         WHERE id = @id AND tenant_id = @t
         RETURNING id, tenant_id, business_unit_id, capability,
                   COALESCE(module_key, capability) AS module_key,
                   COALESCE(feature_key, capability) AS feature_key,
                   enabled, config_json, created_at, updated_at`,
        { id: existing.id, t: tenantId, enabled: input.enabled, configJson, now },
      );
      if (!updated) throw badRequest("failed to update capability");
      return updated;
    }

    const capability = businessUnitId ? `${businessUnitId}:${moduleKey}.${featureKey}` : `${moduleKey}.${featureKey}`;
    const created = await this.db.one<CapabilityRow>(
      `INSERT INTO tenant_capabilities
        (id, tenant_id, business_unit_id, capability, module_key, feature_key, enabled, config_json, created_at, updated_at)
       VALUES (@id, @t, @bu, @capability, @moduleKey, @featureKey, @enabled, @configJson, @now, @now)
       RETURNING id, tenant_id, business_unit_id, capability,
                 COALESCE(module_key, capability) AS module_key,
                 COALESCE(feature_key, capability) AS feature_key,
                 enabled, config_json, created_at, updated_at`,
      {
        id: `cap_${uuidv7()}`,
        t: tenantId,
        bu: businessUnitId,
        capability,
        moduleKey,
        featureKey,
        enabled: input.enabled,
        configJson,
        now,
      },
    );
    if (!created) throw badRequest("failed to create capability");
    return created;
  }

  async setActiveBusinessUnit(tenantId: string, userId: string, role: string, businessUnitId: string): Promise<MeContext> {
    await this.getBusinessUnit(businessUnitId, tenantId, userId, role);
    await this.db.query(
      `INSERT INTO user_active_business_units (tenant_id, user_id, business_unit_id, updated_at)
       VALUES (@t, @u, @bu, @now)
       ON CONFLICT (tenant_id, user_id)
       DO UPDATE SET business_unit_id = EXCLUDED.business_unit_id, updated_at = EXCLUDED.updated_at`,
      { t: tenantId, u: userId, bu: businessUnitId, now: Date.now() },
    );
    return this.getContext(tenantId, userId, role);
  }

  async setModuleVisibility(
    tenantId: string,
    businessUnitId: string,
    moduleKey: string,
    visible: boolean,
    userId?: string | null,
  ): Promise<void> {
    const unit = await this.db.one<{ id: string }>(
      "SELECT id FROM business_units WHERE id = @id AND tenant_id = @t",
      { id: businessUnitId, t: tenantId },
    );
    if (!unit) throw notFound(`business unit '${businessUnitId}' not found`);

    const existing = userId
      ? await this.db.one<{ id: string }>(
          `SELECT id FROM module_visibility
           WHERE tenant_id = @t AND business_unit_id = @bu AND user_id = @u AND module_key = @moduleKey`,
          { t: tenantId, bu: businessUnitId, u: userId, moduleKey },
        )
      : await this.db.one<{ id: string }>(
          `SELECT id FROM module_visibility
           WHERE tenant_id = @t AND business_unit_id = @bu AND user_id IS NULL AND module_key = @moduleKey`,
          { t: tenantId, bu: businessUnitId, moduleKey },
        );

    const now = Date.now();
    if (existing) {
      await this.db.query(
        "UPDATE module_visibility SET visible = @visible, updated_at = @now WHERE id = @id AND tenant_id = @t",
        { id: existing.id, t: tenantId, visible, now },
      );
      return;
    }

    await this.db.query(
      `INSERT INTO module_visibility (id, tenant_id, business_unit_id, user_id, module_key, visible, created_at, updated_at)
       VALUES (@id, @t, @bu, @u, @moduleKey, @visible, @now, @now)`,
      { id: `mv_${uuidv7()}`, t: tenantId, bu: businessUnitId, u: userId ?? null, moduleKey, visible, now },
    );
  }

  /** Grant a user access to a business unit (idempotent). */
  async grantAccess(tenantId: string, userId: string, businessUnitId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO user_business_unit_access (id, tenant_id, user_id, business_unit_id, created_at)
       VALUES (@id, @t, @u, @bu, @now)
       ON CONFLICT (tenant_id, user_id, business_unit_id) DO NOTHING`,
      { id: `uba_${uuidv7()}`, t: tenantId, u: userId, bu: businessUnitId, now: Date.now() },
    );
  }

  // ── Demo seed ───────────────────────────────────────────────────────────────

  /**
   * Idempotently seed the demo tenant with a retail and a wholesale unit so the
   * separation is visible out of the box. Skipped in production. The demo owner
   * gets both units; the demo cashier is scoped to retail only — a live example
   * of access separation.
   */
  async seedDemo(): Promise<void> {
    if (process.env["NODE_ENV"] === "production") return;
    const t = DEMO_TENANT_ID;
    const now = Date.now();

    const units: Array<{ id: string; name: string; kind: string; modules: string[]; route: string; channel: string }> = [
      { id: "bu_demo_retail", name: "Retail Stores", kind: "retail", modules: ["pos", "orders", "customers", "inventory", "reports"], route: "/retail/pos", channel: "retail_pos" },
      { id: "bu_demo_wholesale", name: "Wholesale", kind: "wholesale", modules: ["quotes", "sales-orders", "warehouse", "invoices", "ar"], route: "/wholesale/dashboard", channel: "wholesale_b2b" },
    ];
    for (const u of units) {
      await this.db.query(
        `INSERT INTO business_units (id, tenant_id, name, kind, modules, default_route, created_at, updated_at)
         VALUES (@id, @t, @name, @kind, @modules, @route, @now, @now)
         ON CONFLICT (id) DO NOTHING`,
        { id: u.id, t, name: u.name, kind: u.kind, modules: JSON.stringify(u.modules), route: u.route, now },
      );
      await this.addChannel(t, u.id, u.channel, now);
    }

    for (const capability of ["retail", "wholesale"]) {
      await this.db.query(
        `INSERT INTO tenant_capabilities (id, tenant_id, capability, enabled, created_at, updated_at)
         VALUES (@id, @t, @cap, true, @now, @now)
         ON CONFLICT (tenant_id, capability) DO NOTHING`,
        { id: `cap_${t}_${capability}`, t, cap: capability, now },
      );
    }

    const grants: Array<[string, string]> = [
      ["usr_demo_owner", "bu_demo_retail"],
      ["usr_demo_owner", "bu_demo_wholesale"],
      ["usr_demo_cashier", "bu_demo_retail"],
    ];
    for (const [uid, bu] of grants) {
      await this.grantAccess(t, uid, bu);
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async addChannel(tenantId: string, businessUnitId: string, channel: string, now: number): Promise<void> {
    await this.db.query(
      `INSERT INTO business_unit_channels (id, tenant_id, business_unit_id, channel, created_at)
       VALUES (@id, @t, @bu, @channel, @now)
       ON CONFLICT (tenant_id, business_unit_id, channel) DO NOTHING`,
      { id: `buc_${uuidv7()}`, t: tenantId, bu: businessUnitId, channel: channel.trim(), now },
    );
  }

  private async replaceChannels(tenantId: string, businessUnitId: string, channels: string[], now: number): Promise<void> {
    await this.db.tx(async (tx) => {
      await tx.query(
        "DELETE FROM business_unit_channels WHERE tenant_id = @t AND business_unit_id = @bu",
        { t: tenantId, bu: businessUnitId },
      );
      for (const channel of dedupe(channels)) {
        await tx.query(
          `INSERT INTO business_unit_channels (id, tenant_id, business_unit_id, channel, created_at)
           VALUES (@id, @t, @bu, @channel, @now)
           ON CONFLICT (tenant_id, business_unit_id, channel) DO NOTHING`,
          { id: `buc_${uuidv7()}`, t: tenantId, bu: businessUnitId, channel, now },
        );
      }
    });
  }

  private async activeBusinessUnitId(tenantId: string, userId: string, businessUnits: BusinessUnit[]): Promise<string | null> {
    if (businessUnits.length === 0) return null;
    const row = await this.db.one<{ business_unit_id: string }>(
      "SELECT business_unit_id FROM user_active_business_units WHERE tenant_id = @t AND user_id = @u",
      { t: tenantId, u: userId },
    );
    if (row && businessUnits.some((bu) => bu.id === row.business_unit_id)) return row.business_unit_id;
    return businessUnits[0]?.id ?? null;
  }

  private async hasAccess(tenantId: string, userId: string, businessUnitId: string): Promise<boolean> {
    const row = await this.db.one<{ ok: number }>(
      "SELECT 1 AS ok FROM user_business_unit_access WHERE tenant_id = @t AND user_id = @u AND business_unit_id = @bu",
      { t: tenantId, u: userId, bu: businessUnitId },
    );
    return !!row;
  }

  private async toBusinessUnit(row: BuRow): Promise<BusinessUnit> {
    const channels = await this.db.query<{ channel: string }>(
      "SELECT channel FROM business_unit_channels WHERE tenant_id = @t AND business_unit_id = @bu ORDER BY channel ASC",
      { t: row.tenant_id, bu: row.id },
    );
    const hidden = await this.db.query<{ module_key: string }>(
      `SELECT module_key FROM module_visibility
       WHERE tenant_id = @t AND business_unit_id = @bu AND user_id IS NULL AND visible = false`,
      { t: row.tenant_id, bu: row.id },
    );
    const hiddenModules = new Set(hidden.map((m) => m.module_key));
    const capabilityRows = await this.db.query<{ module_key: string }>(
      `SELECT COALESCE(module_key, capability) AS module_key
       FROM tenant_capabilities
       WHERE tenant_id = @t
         AND enabled = true
         AND (business_unit_id IS NULL OR business_unit_id = @bu)
         AND COALESCE(module_key, capability) IS NOT NULL`,
      { t: row.tenant_id, bu: row.id },
    );
    const capabilityModules = capabilityRows.map((r) => r.module_key);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      channels: channels.map((c) => c.channel),
      modules: dedupe([...parseModules(row.modules), ...capabilityModules]).filter((m) => !hiddenModules.has(m)),
      defaultRoute: row.default_route,
      status: row.status ?? "active",
    };
  }

  private permissionsFor(businessUnits: BusinessUnit[]): string[] {
    const perms = new Set<string>();
    for (const bu of businessUnits) {
      for (const p of KIND_PERMISSIONS[bu.kind] ?? []) perms.add(p);
    }
    return [...perms].sort();
  }
}

function parseModules(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
