import type { PosModule, ModuleContext } from "../types.js";
import { v7 as uuidv7 } from "uuid";
import { handler, parseBody, notFound } from "../../shared/http.js";
import { requireRole, requireModule } from "../../gateway/auth.js";
import { z } from "zod";
import type { Response } from "express";
import type { AuthPayload } from "../../gateway/auth.js";

// ── BE-ED1: Education — Students + Fee Records ─────────────────────────────

const CREATE_STUDENTS = `
CREATE TABLE IF NOT EXISTS students (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  course      TEXT,
  enrolled_at BIGINT,
  status      TEXT NOT NULL DEFAULT 'active',
  notes       TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS students_tenant_name_idx ON students (tenant_id, name);
CREATE INDEX IF NOT EXISTS students_tenant_status_idx ON students (tenant_id, status);
CREATE INDEX IF NOT EXISTS students_tenant_course_idx ON students (tenant_id, course) WHERE course IS NOT NULL;
`;

const CREATE_FEE_RECORDS = `
CREATE TABLE IF NOT EXISTS fee_records (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  due_date     BIGINT,
  paid_at      BIGINT,
  method       TEXT,
  order_id     TEXT,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS fee_records_student_idx ON fee_records (tenant_id, student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fee_records_unpaid_idx ON fee_records (tenant_id, due_date) WHERE paid_at IS NULL;
`;

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const studentSchema = z.object({
  name:       z.string().min(1).max(150),
  email:      z.string().email().optional().or(z.literal("")),
  phone:      z.string().max(30).optional(),
  course:     z.string().max(150).optional(),
  enrolledAt: z.number().int().optional(),
  notes:      z.string().max(500).optional(),
});

const feeSchema = z.object({
  description: z.string().min(1).max(200),
  amountCents: z.number().int().positive(),
  dueDate:     z.number().int().optional(),
});

const collectSchema = z.object({
  method:  z.string().max(30).optional(),
  orderId: z.string().min(1).optional(),
});

export const educationModule: PosModule = {
  name: "education",
  migrations: [CREATE_STUDENTS, CREATE_FEE_RECORDS],
  register({ db, router }: ModuleContext) {
    router.use(requireModule("student_accounts"));

    // ── Students ──────────────────────────────────────────────────────────────

    router.get("/students", handler(async (req, res) => {
      const t      = tid(res);
      const q      = typeof req.query.q      === "string" ? req.query.q      : undefined;
      const course = typeof req.query.course === "string" ? req.query.course : undefined;
      const where: string[] = ["tenant_id = @t"];
      const params: Record<string, unknown> = { t };
      if (q) { where.push("(name ILIKE @q OR email ILIKE @q)"); params.q = `%${q}%`; }
      if (course) { where.push("course = @course"); params.course = course; }
      res.json({ items: await db.query(
        `SELECT * FROM students WHERE ${where.join(" AND ")} ORDER BY name ASC LIMIT 500`,
        params,
      )});
    }));

    router.get("/students/:id", handler(async (req, res) => {
      const id      = String(req.params["id"]);
      const student = await db.one("SELECT * FROM students WHERE id = @id AND tenant_id = @t",
        { id, t: tid(res) });
      if (!student) throw notFound(`student '${id}'`);
      const fees = await db.query(
        "SELECT * FROM fee_records WHERE student_id = @id ORDER BY created_at DESC LIMIT 50",
        { id },
      );
      const outstanding = fees
        .filter((f: Record<string, unknown>) => !f.paid_at)
        .reduce((sum: number, f: Record<string, unknown>) => sum + Number(f.amount_cents), 0);
      res.json({ ...student, fees, outstanding });
    }));

    router.post("/students", handler(async (req, res) => {
      const body = parseBody(studentSchema, req.body);
      const t    = tid(res);
      const now  = Date.now();
      const id   = `stu_${uuidv7()}`;
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO students (id, tenant_id, name, email, phone, course, enrolled_at, status, notes, created_at, updated_at)
           VALUES (@id,@t,@name,@email,@phone,@course,@enrolledAt,'active',@notes,@now,@now)`,
          { id, t, name: body.name, email: body.email ?? null, phone: body.phone ?? null,
            course: body.course ?? null, enrolledAt: body.enrolledAt ?? now,
            notes: body.notes ?? null, now },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM students WHERE id = @id", { id }));
    }));

    router.patch("/students/:id", handler(async (req, res) => {
      const id   = String(req.params["id"]);
      const t    = tid(res);
      const body = req.body as Record<string, unknown>;
      const now  = Date.now();
      const sets: string[] = ["updated_at = @now"];
      const params: Record<string, unknown> = { id, t, now };
      if (body.status) { sets.push("status = @status"); params.status = body.status; }
      if (body.course) { sets.push("course = @course"); params.course = body.course; }
      if (body.notes)  { sets.push("notes = @notes");   params.notes  = body.notes; }
      await db.query(
        `UPDATE students SET ${sets.join(", ")} WHERE id = @id AND tenant_id = @t`,
        params,
      );
      res.json(await db.one("SELECT * FROM students WHERE id = @id", { id }));
    }));

    // ── Fee Records ────────────────────────────────────────────────────────────

    router.post("/students/:id/fees", requireRole("manager"), handler(async (req, res) => {
      const body      = parseBody(feeSchema, req.body);
      const studentId = String(req.params["id"]);
      const t         = tid(res);
      const now       = Date.now();
      const id        = `fee_${uuidv7()}`;
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO fee_records (id, tenant_id, student_id, description, amount_cents, due_date, created_at)
           VALUES (@id,@t,@studentId,@desc,@amount,@dueDate,@now)`,
          { id, t, studentId, desc: body.description, amount: body.amountCents,
            dueDate: body.dueDate ?? null, now },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM fee_records WHERE id = @id", { id }));
    }));

    // Collect payment for a fee
    router.post("/fees/:id/collect", handler(async (req, res) => {
      const id  = String(req.params["id"]);
      const t   = tid(res);
      const now = Date.now();
      const fee = await db.one<{ paid_at: number | null }>(
        "SELECT * FROM fee_records WHERE id = @id AND tenant_id = @t",
        { id, t },
      );
      if (!fee) throw notFound(`fee_record '${id}'`);
      if (fee.paid_at) {
        res.status(409).json({ error: { code: "already_paid" } });
        return;
      }
      const body = parseBody(collectSchema, req.body);
      await db.query(
        "UPDATE fee_records SET paid_at = @now, method = @method, order_id = @orderId WHERE id = @id AND tenant_id = @t",
        { now, method: body.method ?? null, orderId: body.orderId ?? null, id, t },
      );
      res.json(await db.one("SELECT * FROM fee_records WHERE id = @id", { id }));
    }));
  },
};
