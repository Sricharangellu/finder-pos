import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { notFound, forbidden } from "../../shared/http.js";
import { DEMO_TENANT_ID } from "../../identity/service.js";

// ── Public shapes ───────────────────────────────────────────────────────────

export interface BusinessUnit {
  id: string;
  name: string;
  kind: string;               // "retail" | "wholesale" | "ecommerce" | ...
  channels: string[];         // "retail_pos" | "wholesale_b2b" | ...
  modules: string[];          // module keys the unit exposes in navigation
  defaultRoute: string;       // where this unit lands the user
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

// ── Internal row type ───────────────────────────────────────────────────────

interface BuRow {
  id: string;
  tenant_id: string;
  name: string;
  kind: string;
  modules: string;            // JSON array of module keys
  default_route: string;
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
    return {
      tenantId,
      userId,
      role,
      activeBusinessUnitId: businessUnits[0]?.id ?? null,
      businessUnits,
      permissions: this.permissionsFor(businessUnits),
    };
  }

  /** Business units the caller may access, oldest first. */
  async listBusinessUnits(tenantId: string, userId: string, role: string): Promise<BusinessUnit[]> {
    const rows = isPrivileged(role)
      ? await this.db.query<BuRow>(
          "SELECT * FROM business_units WHERE tenant_id = @t ORDER BY created_at ASC",
          { t: tenantId },
        )
      : await this.db.query<BuRow>(
          `SELECT bu.* FROM business_units bu
             JOIN user_business_unit_access acc
               ON acc.business_unit_id = bu.id AND acc.tenant_id = bu.tenant_id
            WHERE bu.tenant_id = @t AND acc.user_id = @u
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
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      channels: channels.map((c) => c.channel),
      modules: parseModules(row.modules),
      defaultRoute: row.default_route,
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
