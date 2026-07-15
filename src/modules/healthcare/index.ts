import type { PosModule, ModuleContext } from "../types.js";
import { v7 as uuidv7 } from "uuid";
import { handler, parseBody, notFound } from "../../shared/http.js";
import { requireRole, requireModule } from "../../gateway/auth.js";
import { z } from "zod";
import type { Response } from "express";
import type { AuthPayload } from "../../gateway/auth.js";

// ── BE-HC1: Healthcare — Patients + Prescriptions ──────────────────────────

const CREATE_PATIENTS = `
CREATE TABLE IF NOT EXISTS patients (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  dob        TEXT,
  gender     TEXT,
  phone      TEXT,
  email      TEXT,
  allergies  TEXT,
  notes      TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS patients_tenant_name_idx ON patients (tenant_id, name);
`;

const CREATE_PRESCRIPTIONS = `
CREATE TABLE IF NOT EXISTS prescriptions (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  patient_id        TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  drug_name         TEXT NOT NULL,
  dosage            TEXT NOT NULL,
  prescriber        TEXT,
  instructions      TEXT,
  quantity          INTEGER NOT NULL DEFAULT 1,
  refills_remaining INTEGER NOT NULL DEFAULT 0,
  dispensed_at      BIGINT,
  expiry_date       BIGINT,
  created_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rx_tenant_patient_idx ON prescriptions (tenant_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rx_expiry_idx ON prescriptions (tenant_id, expiry_date) WHERE expiry_date IS NOT NULL;
`;

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const patientSchema = z.object({
  name:      z.string().min(1).max(150),
  dob:       z.string().optional(),
  gender:    z.string().optional(),
  phone:     z.string().max(30).optional(),
  email:     z.string().email().optional().or(z.literal("")),
  allergies: z.string().max(500).optional(),
  notes:     z.string().max(1000).optional(),
});

const rxSchema = z.object({
  drugName:          z.string().min(1).max(200),
  dosage:            z.string().min(1).max(100),
  prescriber:        z.string().max(100).optional(),
  instructions:      z.string().max(500).optional(),
  quantity:          z.number().int().positive().default(1),
  refillsRemaining:  z.number().int().nonnegative().default(0),
  expiryDate:        z.number().int().optional(),
});

export const healthcareModule: PosModule = {
  name: "healthcare",
  migrations: [CREATE_PATIENTS, CREATE_PRESCRIPTIONS],
  register({ db, router }: ModuleContext) {
    router.use(requireModule("patient_records"));

    // ── Patients ────────────────────────────────────────────────────────────

    router.get("/patients", handler(async (req, res) => {
      const t = tid(res);
      const q = typeof req.query.q === "string" ? req.query.q : undefined;
      const where = q ? "WHERE tenant_id = @t AND name ILIKE @q" : "WHERE tenant_id = @t";
      const params: Record<string, unknown> = { t };
      if (q) params.q = `%${q}%`;
      res.json({ items: await db.query(`SELECT * FROM patients ${where} ORDER BY name LIMIT 500`, params) });
    }));

    router.get("/patients/:id", handler(async (req, res) => {
      const patient = await db.one("SELECT * FROM patients WHERE id = @id AND tenant_id = @t",
        { id: String(req.params["id"]), t: tid(res) });
      if (!patient) { res.status(404).json({ error: { code: "not_found" } }); return; }
      const prescriptions = await db.query(
        "SELECT * FROM prescriptions WHERE patient_id = @id ORDER BY created_at DESC LIMIT 50",
        { id: String(req.params["id"]) },
      );
      res.json({ ...patient, prescriptions });
    }));

    router.post("/patients", handler(async (req, res) => {
      const body = parseBody(patientSchema, req.body);
      const t    = tid(res);
      const now  = Date.now();
      const id   = `pat_${uuidv7()}`;
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO patients (id, tenant_id, name, dob, gender, phone, email, allergies, notes, created_at, updated_at)
           VALUES (@id,@t,@name,@dob,@gender,@phone,@email,@allergies,@notes,@now,@now)`,
          { id, t, name: body.name, dob: body.dob ?? null, gender: body.gender ?? null,
            phone: body.phone ?? null, email: body.email ?? null,
            allergies: body.allergies ?? null, notes: body.notes ?? null, now },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM patients WHERE id = @id", { id }));
    }));

    // ── Prescriptions ───────────────────────────────────────────────────────

    router.get("/patients/:id/prescriptions", handler(async (req, res) => {
      res.json({ items: await db.query(
        "SELECT * FROM prescriptions WHERE patient_id = @id AND tenant_id = @t ORDER BY created_at DESC LIMIT 100",
        { id: String(req.params["id"]), t: tid(res) },
      )});
    }));

    router.post("/patients/:id/prescriptions", requireRole("manager"), handler(async (req, res) => {
      const body = parseBody(rxSchema, req.body);
      const t    = tid(res);
      const id   = `rx_${uuidv7()}`;
      const now  = Date.now();
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO prescriptions
             (id, tenant_id, patient_id, drug_name, dosage, prescriber, instructions,
              quantity, refills_remaining, expiry_date, created_at)
           VALUES (@id,@t,@patientId,@drugName,@dosage,@prescriber,@instructions,
                   @quantity,@refillsRemaining,@expiryDate,@now)`,
          { id, t, patientId: String(req.params["id"]),
            drugName: body.drugName, dosage: body.dosage,
            prescriber: body.prescriber ?? null, instructions: body.instructions ?? null,
            quantity: body.quantity, refillsRemaining: body.refillsRemaining,
            expiryDate: body.expiryDate ?? null, now },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM prescriptions WHERE id = @id", { id }));
    }));

    // Dispense a prescription (decrement refills)
    router.post("/prescriptions/:id/dispense", handler(async (req, res) => {
      const id = String(req.params["id"]);
      const t  = tid(res);
      const rx = await db.one<{ refills_remaining: number }>(
        "SELECT * FROM prescriptions WHERE id = @id AND tenant_id = @t",
        { id, t },
      );
      if (!rx) throw notFound(`prescription '${id}'`);
      const newRefills = Math.max(0, rx.refills_remaining - 1);
      await db.query(
        "UPDATE prescriptions SET refills_remaining = @r, dispensed_at = @now WHERE id = @id AND tenant_id = @t",
        { r: newRefills, now: Date.now(), id, t },
      );
      res.json(await db.one("SELECT * FROM prescriptions WHERE id = @id", { id }));
    }));
  },
};
