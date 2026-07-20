import type { PosModule, ModuleContext } from "../types.js";
import { v7 as uuidv7 } from "uuid";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole, requireModule } from "../../gateway/auth.js";
import { z } from "zod";
import type { Response } from "express";
import type { AuthPayload } from "../../gateway/auth.js";

// ── BE-S1: Appointments module ─────────────────────────────────────────────

const CREATE_APPOINTMENTS = `
CREATE TABLE IF NOT EXISTS appointments (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  customer_id TEXT,
  employee_id TEXT,
  service     TEXT NOT NULL,
  starts_at   BIGINT NOT NULL,
  ends_at     BIGINT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'scheduled',
  notes       TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS appt_tenant_date_idx ON appointments (tenant_id, starts_at ASC);
CREATE INDEX IF NOT EXISTS appt_tenant_employee_idx ON appointments (tenant_id, employee_id, starts_at ASC) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS appt_tenant_customer_idx ON appointments (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
`;

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const schema = z.object({
  service:    z.string().min(1).max(100),
  startsAt:   z.number().int().positive(),
  endsAt:     z.number().int().positive(),
  customerId: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
  notes:      z.string().max(500).optional(),
});

const patchSchema = z.object({
  status: z.enum(["scheduled","confirmed","in_progress","completed","cancelled","no_show"]).optional(),
  notes:  z.string().max(500).optional(),
  startsAt: z.number().int().positive().optional(),
  endsAt:   z.number().int().positive().optional(),
});

export const appointmentsModule: PosModule = {
  name: "appointments",
  migrations: [CREATE_APPOINTMENTS],
  register({ db, router }: ModuleContext) {
    router.use(requireModule("appointments"));
    // List — filter by date range, employee, or customer
    router.get("", handler(async (req, res) => {
      const t          = tid(res);
      const from       = typeof req.query.from === "string" ? Number(req.query.from) : undefined;
      const to         = typeof req.query.to   === "string" ? Number(req.query.to)   : undefined;
      const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
      const date       = typeof req.query.date === "string" ? req.query.date : undefined;

      const where: string[] = ["tenant_id = @t"];
      const params: Record<string, unknown> = { t };

      if (date) {
        // Day view: starts_at on given YYYY-MM-DD
        const start = new Date(date + "T00:00:00").getTime();
        const end   = new Date(date + "T23:59:59").getTime();
        where.push("starts_at >= @start AND starts_at <= @end");
        params.start = start; params.end = end;
      } else {
        if (from) { where.push("starts_at >= @from"); params.from = from; }
        if (to)   { where.push("starts_at <= @to");   params.to   = to;   }
      }
      if (employeeId) { where.push("employee_id = @emp"); params.emp = employeeId; }

      const items = await db.query(
        `SELECT * FROM appointments WHERE ${where.join(" AND ")} ORDER BY starts_at ASC LIMIT 200`,
        params,
      );
      res.json({ items });
    }));

    // Create
    router.post("", handler(async (req, res) => {
      const body = parseBody(schema, req.body);
      const t    = tid(res);
      const now  = Date.now();
      const id   = `apt_${uuidv7()}`;
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO appointments (id, tenant_id, customer_id, employee_id, service, starts_at, ends_at, status, notes, created_at, updated_at)
           VALUES (@id,@t,@customerId,@employeeId,@service,@startsAt,@endsAt,'scheduled',@notes,@now,@now)`,
          { id, t, customerId: body.customerId ?? null, employeeId: body.employeeId ?? null,
            service: body.service, startsAt: body.startsAt, endsAt: body.endsAt,
            notes: body.notes ?? null, now },
        );
      });
      const row = await db.one("SELECT * FROM appointments WHERE id = @id", { id });
      res.status(201).json(row);
    }));

    // Update
    router.patch("/:id", handler(async (req, res) => {
      const body = parseBody(patchSchema, req.body);
      const t    = tid(res);
      const sets: string[] = ["updated_at = @now"];
      const params: Record<string, unknown> = { id: String(req.params["id"]), t, now: Date.now() };
      if (body.status)   { sets.push("status = @status");     params.status   = body.status; }
      if (body.notes)    { sets.push("notes = @notes");       params.notes    = body.notes; }
      if (body.startsAt) { sets.push("starts_at = @startsAt"); params.startsAt = body.startsAt; }
      if (body.endsAt)   { sets.push("ends_at = @endsAt");    params.endsAt   = body.endsAt; }
      await db.query(
        `UPDATE appointments SET ${sets.join(", ")} WHERE id = @id AND tenant_id = @t`,
        params,
      );
      res.json(await db.one("SELECT * FROM appointments WHERE id = @id", { id: params.id }));
    }));

    // Delete
    router.delete("/:id", requireRole("manager"), handler(async (req, res) => {
      await db.query(
        "DELETE FROM appointments WHERE id = @id AND tenant_id = @t",
        { id: String(req.params["id"]), t: tid(res) },
      );
      res.status(204).end();
    }));
  },
};
