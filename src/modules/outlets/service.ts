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

export interface RegisterSession {
  id: string;
  tenant_id: string;
  register_id: string;
  opened_by: string;
  opening_float_cents: number;
  closing_float_cents: number | null;
  counted_cash_cents: number | null;
  variance_cents: number | null;
  status: "open" | "closed";
  opened_at: number;
  closed_at: number | null;
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

  // ── Register sessions (BE-17) ─────────────────────────────────────────────

  async openSession(registerId: string, openingFloatCents: number, openedBy: string, tenantId: string): Promise<RegisterSession> {
    const reg = await this.db.one<Register>(
      "SELECT * FROM registers WHERE id = @registerId AND tenant_id = @tenantId",
      { registerId, tenantId },
    );
    if (!reg) throw new HttpError(404, "not_found", `register '${registerId}' not found`);

    const existing = await this.db.one<{ id: string }>(
      "SELECT id FROM register_sessions WHERE register_id = @registerId AND tenant_id = @tenantId AND status = 'open' LIMIT 1",
      { registerId, tenantId },
    );
    if (existing) throw new HttpError(409, "conflict", `register '${registerId}' already has an open session`);

    const now = Date.now();
    const session: RegisterSession = {
      id: `ses_${uuidv7()}`,
      tenant_id: tenantId,
      register_id: registerId,
      opened_by: openedBy,
      opening_float_cents: openingFloatCents,
      closing_float_cents: null,
      counted_cash_cents: null,
      variance_cents: null,
      status: "open",
      opened_at: now,
      closed_at: null,
    };
    await this.db.query(
      `INSERT INTO register_sessions
         (id, tenant_id, register_id, opened_by, opening_float_cents, status, opened_at)
       VALUES (@id, @tenant_id, @register_id, @opened_by, @opening_float_cents, @status, @opened_at)`,
      session as unknown as Record<string, unknown>,
    );
    await this.setRegisterStatus(registerId, "open", tenantId);
    return session;
  }

  async getExpectedCash(registerId: string, tenantId: string): Promise<{ openingFloatCents: number; cashSalesCents: number; expectedCashCents: number }> {
    const session = await this.db.one<RegisterSession>(
      "SELECT * FROM register_sessions WHERE register_id = @registerId AND tenant_id = @tenantId AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
      { registerId, tenantId },
    );
    if (!session) {
      return { openingFloatCents: 0, cashSalesCents: 0, expectedCashCents: 0 };
    }

    const row = await this.db.one<{ cash_sales: number }>(
      `SELECT COALESCE(SUM(cash_cents - change_cents), 0)::int AS cash_sales
       FROM payments
       WHERE tenant_id = @tenantId
         AND created_at >= @openedAt
         AND status = 'captured'`,
      { tenantId, openedAt: session.opened_at },
    );

    const cashSalesCents = row?.cash_sales ?? 0;
    return {
      openingFloatCents: Number(session.opening_float_cents),
      cashSalesCents,
      expectedCashCents: Number(session.opening_float_cents) + cashSalesCents,
    };
  }

  async closeSession(registerId: string, countedCashCents: number, closingFloatCents: number, tenantId: string): Promise<RegisterSession> {
    const session = await this.db.one<RegisterSession>(
      "SELECT * FROM register_sessions WHERE register_id = @registerId AND tenant_id = @tenantId AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
      { registerId, tenantId },
    );
    if (!session) throw new HttpError(404, "not_found", `no open session for register '${registerId}'`);

    const expected = await this.getExpectedCash(registerId, tenantId);
    const varianceCents = expected.expectedCashCents - countedCashCents;
    const now = Date.now();
    await this.db.query(
      `UPDATE register_sessions
         SET status = 'closed', counted_cash_cents = @counted, closing_float_cents = @closing,
             variance_cents = @variance, closed_at = @now
       WHERE id = @id AND tenant_id = @tenantId`,
      { counted: countedCashCents, closing: closingFloatCents, variance: varianceCents, now, id: session.id, tenantId },
    );
    await this.setRegisterStatus(registerId, "closed", tenantId);
    return { ...session, status: "closed", counted_cash_cents: countedCashCents, closing_float_cents: closingFloatCents, variance_cents: varianceCents, closed_at: now };
  }


  async listSessions(registerId: string, tenantId: string, limit = 20): Promise<RegisterSession[]> {
    return this.db.query<RegisterSession>(
      "SELECT * FROM register_sessions WHERE register_id = @registerId AND tenant_id = @tenantId ORDER BY opened_at DESC LIMIT @limit",
      { registerId, tenantId, limit },
    );
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
