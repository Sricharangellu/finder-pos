import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound } from "../../shared/http.js";

export type ShiftRole = "cashier" | "manager" | "stock" | "supervisor" | "delivery";
export type TimeOffStatus = "pending" | "approved" | "denied";

export interface Employee {
  id: string;
  tenant_id: string;
  name: string;
  role: ShiftRole;
  email: string;
  avatar_color: string;
  active: number;
  created_at: number;
  updated_at: number;
}

export interface Shift {
  id: string;
  tenant_id: string;
  employee_id: string;
  employee_name: string;
  role: ShiftRole;
  date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface TimeOffRequest {
  id: string;
  tenant_id: string;
  employee_id: string;
  employee_name: string;
  date_from: string;
  date_to: string;
  reason: string | null;
  status: TimeOffStatus;
  created_at: number;
}

export type WorkforceService = ReturnType<typeof workforceService>;

export function workforceService(db: DB, _events: EventBus) {
  return {
    // ── Employees ──────────────────────────────────────────────────────────

    async listEmployees(tenantId: string): Promise<Employee[]> {
      return db.query<Employee>(
        "SELECT * FROM employees WHERE tenant_id = @tenantId AND active = 1 ORDER BY name",
        { tenantId }
      );
    },

    async createEmployee(tenantId: string, input: {
      name: string;
      role?: ShiftRole;
      email?: string;
      avatar_color?: string;
    }): Promise<Employee> {
      const now = Date.now();
      const row: Employee = {
        id: `emp_${uuidv7()}`,
        tenant_id: tenantId,
        name: input.name,
        role: input.role ?? "cashier",
        email: input.email ?? "",
        avatar_color: input.avatar_color ?? "#64748b",
        active: 1,
        created_at: now,
        updated_at: now,
      };
      await db.query(
        `INSERT INTO employees (id, tenant_id, name, role, email, avatar_color, active, created_at, updated_at)
         VALUES (@id, @tenant_id, @name, @role, @email, @avatar_color, @active, @created_at, @updated_at)`,
        { ...row }
      );
      return row;
    },

    async updateEmployee(tenantId: string, id: string, input: Partial<{
      name: string; role: ShiftRole; email: string; avatar_color: string; active: number;
    }>): Promise<Employee> {
      const rows = await db.query<Employee>(
        "SELECT * FROM employees WHERE id = @id AND tenant_id = @tenantId",
        { id, tenantId }
      );
      if (!rows[0]) throw notFound("employee");
      const now = Date.now();
      const updated = { ...rows[0], ...input, updated_at: now };
      await db.query(
        `UPDATE employees SET name=@name, role=@role, email=@email, avatar_color=@avatar_color,
         active=@active, updated_at=@updated_at WHERE id=@id AND tenant_id=@tenant_id`,
        { ...updated }
      );
      return updated;
    },

    // ── Shifts ────────────────────────────────────────────────────────────

    async listShifts(tenantId: string, opts: {
      date_from?: string; date_to?: string; employee_id?: string;
    } = {}): Promise<Shift[]> {
      const { date_from, date_to, employee_id } = opts;
      const where: string[] = ["s.tenant_id = @tenantId"];
      const params: Record<string, unknown> = { tenantId };
      if (date_from) { where.push("s.date >= @date_from"); params["date_from"] = date_from; }
      if (date_to)   { where.push("s.date <= @date_to");   params["date_to"] = date_to; }
      if (employee_id) { where.push("s.employee_id = @employee_id"); params["employee_id"] = employee_id; }
      return db.query<Shift>(
        `SELECT s.*, e.name AS employee_name, e.role
         FROM schedule_shifts s
         JOIN employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
         WHERE ${where.join(" AND ")}
         ORDER BY s.date, s.start_time`,
        params
      );
    },

    async createShift(tenantId: string, input: {
      employee_id: string;
      date: string;
      start_time: string;
      end_time: string;
      notes?: string | null;
    }): Promise<Shift> {
      const emp = await db.one<Employee>(
        "SELECT * FROM employees WHERE id = @id AND tenant_id = @tenantId",
        { id: input.employee_id, tenantId }
      );
      if (!emp) throw notFound("employee");
      const now = Date.now();
      const id = `sh_${uuidv7()}`;
      await db.query(
        `INSERT INTO schedule_shifts (id, tenant_id, employee_id, date, start_time, end_time, notes, created_at, updated_at)
         VALUES (@id, @tenantId, @employee_id, @date, @start_time, @end_time, @notes, @now, @now)`,
        { id, tenantId, employee_id: input.employee_id, date: input.date, start_time: input.start_time, end_time: input.end_time, notes: input.notes ?? null, now }
      );
      return {
        id, tenant_id: tenantId, employee_id: input.employee_id,
        employee_name: emp.name, role: emp.role,
        date: input.date, start_time: input.start_time, end_time: input.end_time,
        notes: input.notes ?? null, created_at: now, updated_at: now,
      };
    },

    async updateShift(tenantId: string, id: string, input: Partial<{
      date: string; start_time: string; end_time: string; notes: string | null;
    }>): Promise<Shift> {
      const rows = await db.query<{ id: string }>(
        "SELECT id FROM schedule_shifts WHERE id = @id AND tenant_id = @tenantId",
        { id, tenantId }
      );
      if (!rows[0]) throw notFound("shift");
      const now = Date.now();
      if (input.date !== undefined)       await db.query("UPDATE schedule_shifts SET date=@v, updated_at=@now WHERE id=@id", { v: input.date, now, id });
      if (input.start_time !== undefined) await db.query("UPDATE schedule_shifts SET start_time=@v, updated_at=@now WHERE id=@id", { v: input.start_time, now, id });
      if (input.end_time !== undefined)   await db.query("UPDATE schedule_shifts SET end_time=@v, updated_at=@now WHERE id=@id", { v: input.end_time, now, id });
      if (input.notes !== undefined)      await db.query("UPDATE schedule_shifts SET notes=@v, updated_at=@now WHERE id=@id", { v: input.notes, now, id });
      const updated = await db.one<Shift>(
        `SELECT s.*, e.name AS employee_name, e.role
         FROM schedule_shifts s JOIN employees e ON e.id = s.employee_id
         WHERE s.id = @id`,
        { id }
      );
      return updated!;
    },

    async deleteShift(tenantId: string, id: string): Promise<void> {
      const rows = await db.query<{ id: string }>(
        "SELECT id FROM schedule_shifts WHERE id = @id AND tenant_id = @tenantId",
        { id, tenantId }
      );
      if (!rows[0]) throw notFound("shift");
      await db.query("DELETE FROM schedule_shifts WHERE id = @id AND tenant_id = @tenantId", { id, tenantId });
    },

    // ── Time-off requests ─────────────────────────────────────────────────

    async listTimeOff(tenantId: string): Promise<TimeOffRequest[]> {
      return db.query<TimeOffRequest>(
        `SELECT r.*, e.name AS employee_name
         FROM time_off_requests r
         JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
         WHERE r.tenant_id = @tenantId
         ORDER BY r.created_at DESC`,
        { tenantId }
      );
    },

    async createTimeOff(tenantId: string, input: {
      employee_id: string;
      date_from: string;
      date_to: string;
      reason?: string | null;
    }): Promise<TimeOffRequest> {
      const emp = await db.one<Employee>(
        "SELECT * FROM employees WHERE id = @id AND tenant_id = @tenantId",
        { id: input.employee_id, tenantId }
      );
      if (!emp) throw notFound("employee");
      const now = Date.now();
      const id = `to_${uuidv7()}`;
      await db.query(
        `INSERT INTO time_off_requests (id, tenant_id, employee_id, date_from, date_to, reason, status, created_at)
         VALUES (@id, @tenantId, @employee_id, @date_from, @date_to, @reason, 'pending', @now)`,
        { id, tenantId, employee_id: input.employee_id, date_from: input.date_from, date_to: input.date_to, reason: input.reason ?? null, now }
      );
      return {
        id, tenant_id: tenantId, employee_id: input.employee_id,
        employee_name: emp.name,
        date_from: input.date_from, date_to: input.date_to,
        reason: input.reason ?? null, status: "pending", created_at: now,
      };
    },

    async updateTimeOffStatus(tenantId: string, id: string, status: TimeOffStatus): Promise<TimeOffRequest> {
      const rows = await db.query<TimeOffRequest>(
        `SELECT r.*, e.name AS employee_name
         FROM time_off_requests r
         JOIN employees e ON e.id = r.employee_id
         WHERE r.id = @id AND r.tenant_id = @tenantId`,
        { id, tenantId }
      );
      if (!rows[0]) throw notFound("time_off_request");
      await db.query(
        "UPDATE time_off_requests SET status = @status WHERE id = @id AND tenant_id = @tenantId",
        { status, id, tenantId }
      );
      return { ...rows[0], status };
    },

    // ── Time clock (BE-40) ───────────────────────────────────────────────────

    async clockIn(employeeId: string, tenantId: string, notes?: string) {
      // Verify the employee actually exists for this tenant. Without this
      // check, a typo'd/bogus employeeId would silently insert an orphaned
      // time_entries row: listTimeEntries INNER JOINs employees, so the row
      // would never appear in any listing, and the subsequent duplicate-entry
      // guard below would then block the bogus id from ever being clocked in
      // again — an invisible, permanently "stuck" entry with no way to see or
      // resolve it via the API. createShift/createTimeOff already validate
      // employee existence the same way; clockIn should too.
      const emp = await db.one<{ id: string }>(
        "SELECT id FROM employees WHERE id = @employeeId AND tenant_id = @tenantId",
        { employeeId, tenantId },
      );
      if (!emp) throw notFound("employee");
      // Prevent duplicate open entries
      const open = await db.one<{ id: string }>(
        "SELECT id FROM time_entries WHERE tenant_id = @tenantId AND employee_id = @employeeId AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1",
        { tenantId, employeeId },
      );
      if (open) throw new (await import("../../shared/http.js")).HttpError(409, "already_clocked_in", "Employee is already clocked in.");
      const id = `te_${uuidv7()}`;
      const now = Date.now();
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          "INSERT INTO time_entries (id, tenant_id, employee_id, clock_in, notes, created_at) VALUES (@id, @tenantId, @employeeId, @now, @notes, @now)",
          { id, tenantId, employeeId, now, notes: notes ?? null },
        );
      });
      return { id, employee_id: employeeId, clock_in: now, clock_out: null, break_minutes: 0, notes: notes ?? null };
    },

    async clockOut(entryId: string, tenantId: string, breakMinutes?: number) {
      const entry = await db.one<{ id: string; employee_id: string; clock_in: number; clock_out: number | null }>(
        "SELECT id, employee_id, clock_in, clock_out FROM time_entries WHERE id = @id AND tenant_id = @tenantId",
        { id: entryId, tenantId },
      );
      if (!entry) throw notFound(`time_entry '${entryId}'`);
      if (entry.clock_out !== null) throw new (await import("../../shared/http.js")).HttpError(409, "already_clocked_out", "Entry already has a clock-out time.");
      const now = Date.now();
      await db.query(
        "UPDATE time_entries SET clock_out = @now, break_minutes = @break WHERE id = @id AND tenant_id = @tenantId",
        { now, break: breakMinutes ?? 0, id: entryId, tenantId },
      );
      return { ...entry, clock_out: now, break_minutes: breakMinutes ?? 0 };
    },

    async listTimeEntries(tenantId: string, opts: { employeeId?: string; from?: number; to?: number; limit?: number }) {
      const where: string[] = ["te.tenant_id = @tenantId"];
      const params: Record<string, unknown> = { tenantId };
      if (opts.employeeId) { where.push("te.employee_id = @employeeId"); params.employeeId = opts.employeeId; }
      if (opts.from)       { where.push("te.clock_in >= @from"); params.from = opts.from; }
      if (opts.to)         { where.push("te.clock_in <= @to");   params.to   = opts.to;   }
      params.limit = Math.min(opts.limit ?? 200, 500);
      return db.query(
        `SELECT te.id, te.employee_id, e.name AS employee_name,
                te.clock_in, te.clock_out, te.break_minutes, te.notes,
                CASE WHEN te.clock_out IS NOT NULL
                     THEN (te.clock_out - te.clock_in) / 60000 - te.break_minutes
                     ELSE NULL END AS worked_minutes
         FROM time_entries te
         JOIN employees e ON e.id = te.employee_id AND e.tenant_id = te.tenant_id
         WHERE ${where.join(" AND ")}
         ORDER BY te.clock_in DESC LIMIT @limit`,
        params,
      );
    },
  };
}
