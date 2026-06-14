import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { HttpError } from "../../shared/http.js";

/** Outlets (locations) + registers (tills). Lightspeed-style multi-location core.
 *  Tenant-scoped. A register opens/closes for a trading session. */

export interface Register {
  id: string;
  tenant_id: string;
  outlet_id: string;
  name: string;
  status: "open" | "closed";
  created_at: number;
  updated_at: number;
}

export interface Outlet {
  id: string;
  tenant_id: string;
  name: string;
  timezone: string;
  created_at: number;
  updated_at: number;
}

export interface OutletWithRegisters extends Outlet {
  registers: Register[];
}

export class OutletsService {
  constructor(private readonly db: DB) {}

  async list(tenantId: string): Promise<OutletWithRegisters[]> {
    const outlets = await this.db.query<Outlet>(
      "SELECT * FROM outlets WHERE tenant_id = @tenantId ORDER BY created_at ASC",
      { tenantId },
    );
    const registers = await this.db.query<Register>(
      "SELECT * FROM registers WHERE tenant_id = @tenantId ORDER BY created_at ASC",
      { tenantId },
    );
    return outlets.map((o) => ({ ...o, registers: registers.filter((r) => r.outlet_id === o.id) }));
  }

  async createOutlet(name: string, timezone: string | undefined, tenantId: string): Promise<Outlet> {
    const now = Date.now();
    const outlet: Outlet = {
      id: `otl_${uuidv7()}`,
      tenant_id: tenantId,
      name,
      timezone: timezone ?? "America/Los_Angeles",
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      "INSERT INTO outlets (id, tenant_id, name, timezone, created_at, updated_at) VALUES (@id,@tenant_id,@name,@timezone,@created_at,@updated_at)",
      outlet as unknown as Record<string, unknown>,
    );
    return outlet;
  }

  async createRegister(outletId: string, name: string, tenantId: string): Promise<Register> {
    const outlet = await this.db.one<Outlet>(
      "SELECT id FROM outlets WHERE id = @outletId AND tenant_id = @tenantId",
      { outletId, tenantId },
    );
    if (!outlet) throw new HttpError(404, "not_found", `outlet '${outletId}' not found`);
    const now = Date.now();
    const reg: Register = {
      id: `reg_${uuidv7()}`,
      tenant_id: tenantId,
      outlet_id: outletId,
      name,
      status: "closed",
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      "INSERT INTO registers (id, tenant_id, outlet_id, name, status, created_at, updated_at) VALUES (@id,@tenant_id,@outlet_id,@name,@status,@created_at,@updated_at)",
      reg as unknown as Record<string, unknown>,
    );
    return reg;
  }

  async setRegisterStatus(registerId: string, status: "open" | "closed", tenantId: string): Promise<Register> {
    const reg = await this.db.one<Register>(
      "SELECT * FROM registers WHERE id = @registerId AND tenant_id = @tenantId",
      { registerId, tenantId },
    );
    if (!reg) throw new HttpError(404, "not_found", `register '${registerId}' not found`);
    await this.db.query(
      "UPDATE registers SET status = @status, updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
      { status, now: Date.now(), id: registerId, tenantId },
    );
    return { ...reg, status, updated_at: Date.now() };
  }

  /** Idempotent: ensure the demo tenant has a default outlet + register so the
   *  store/register selector has data on first boot. */
  async seedDefault(tenantId: string): Promise<void> {
    const existing = await this.db.one<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM outlets WHERE tenant_id = @tenantId",
      { tenantId },
    );
    if (existing && Number(existing.c) > 0) return;
    const outlet = await this.createOutlet("Main Store", "America/Los_Angeles", tenantId);
    await this.createRegister(outlet.id, "Register 1", tenantId);
  }
}
