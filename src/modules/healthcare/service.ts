import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound, HttpError } from "../../shared/http.js";

export interface Patient {
  id: string;
  tenant_id: string;
  name: string;
  dob: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  allergies: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface Prescription {
  id: string;
  tenant_id: string;
  patient_id: string;
  drug: string;
  dosage: string | null;
  prescriber: string | null;
  refills_total: number;
  refills_remaining: number;
  expiry_date: string | null;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export type HealthcareService = ReturnType<typeof healthcareService>;

export function healthcareService(db: DB, events: EventBus) {
  return {
    async listPatients(tenantId: string, query?: string): Promise<Patient[]> {
      if (query) {
        return db.query<Patient>(
          "SELECT * FROM patients WHERE tenant_id = @t AND name ILIKE @q ORDER BY name LIMIT 100",
          { t: tenantId, q: `%${query}%` },
        );
      }
      return db.query<Patient>(
        "SELECT * FROM patients WHERE tenant_id = @t ORDER BY name LIMIT 200",
        { t: tenantId },
      );
    },

    async createPatient(tenantId: string, input: {
      name: string;
      dob?: string;
      gender?: string;
      phone?: string;
      email?: string;
      allergies?: string;
      notes?: string;
    }): Promise<Patient> {
      const now = Date.now();
      const row: Patient = {
        id: `pat_${uuidv7()}`,
        tenant_id: tenantId,
        name: input.name,
        dob: input.dob ?? null,
        gender: input.gender ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        allergies: input.allergies ?? null,
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      };
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO patients (id, tenant_id, name, dob, gender, phone, email, allergies, notes, created_at, updated_at)
           VALUES (@id, @tenant_id, @name, @dob, @gender, @phone, @email, @allergies, @notes, @created_at, @updated_at)`,
          row as unknown as Record<string, unknown>,
        );
      });
      return row;
    },

    async getPatient(tenantId: string, id: string): Promise<Patient> {
      const row = await db.one<Patient>(
        "SELECT * FROM patients WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!row) throw notFound(`patient '${id}'`);
      return row;
    },

    async updatePatient(tenantId: string, id: string, input: Partial<{
      name: string;
      dob: string;
      gender: string;
      phone: string;
      email: string;
      allergies: string;
      notes: string;
    }>): Promise<Patient> {
      const existing = await db.one<Patient>(
        "SELECT * FROM patients WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!existing) throw notFound(`patient '${id}'`);
      const now = Date.now();
      const updated: Patient = { ...existing, ...input, updated_at: now };
      await db.query(
        `UPDATE patients SET name=@name, dob=@dob, gender=@gender, phone=@phone, email=@email,
         allergies=@allergies, notes=@notes, updated_at=@updated_at WHERE id=@id AND tenant_id=@tenant_id`,
        updated as unknown as Record<string, unknown>,
      );
      return updated;
    },

    async listPrescriptions(tenantId: string, patientId: string): Promise<Prescription[]> {
      return db.query<Prescription>(
        "SELECT * FROM prescriptions WHERE tenant_id = @t AND patient_id = @patientId ORDER BY created_at DESC",
        { t: tenantId, patientId },
      );
    },

    async createPrescription(tenantId: string, patientId: string, input: {
      drug: string;
      dosage?: string;
      prescriber?: string;
      refillsTotal?: number;
      expiryDate?: string;
      notes?: string;
    }): Promise<Prescription> {
      const patient = await db.one<{ id: string }>(
        "SELECT id FROM patients WHERE id = @id AND tenant_id = @t",
        { id: patientId, t: tenantId },
      );
      if (!patient) throw notFound(`patient '${patientId}'`);
      const now = Date.now();
      const row: Prescription = {
        id: `rx_${uuidv7()}`,
        tenant_id: tenantId,
        patient_id: patientId,
        drug: input.drug,
        dosage: input.dosage ?? null,
        prescriber: input.prescriber ?? null,
        refills_total: input.refillsTotal ?? 0,
        refills_remaining: input.refillsTotal ?? 0,
        expiry_date: input.expiryDate ?? null,
        status: "active",
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      };
      await db.query(
        `INSERT INTO prescriptions (id, tenant_id, patient_id, drug, dosage, prescriber, refills_total, refills_remaining, expiry_date, status, notes, created_at, updated_at)
         VALUES (@id, @tenant_id, @patient_id, @drug, @dosage, @prescriber, @refills_total, @refills_remaining, @expiry_date, @status, @notes, @created_at, @updated_at)`,
        row as unknown as Record<string, unknown>,
      );
      void events.publish("healthcare.prescription_created", { tenantId, patientId, prescriptionId: row.id }, row.id);
      return row;
    },

    async refillPrescription(tenantId: string, prescriptionId: string): Promise<Prescription> {
      const rx = await db.one<Prescription>(
        "SELECT * FROM prescriptions WHERE id = @id AND tenant_id = @t",
        { id: prescriptionId, t: tenantId },
      );
      if (!rx) throw notFound(`prescription '${prescriptionId}'`);
      if (rx.refills_remaining <= 0) {
        throw new HttpError(409, "no_refills", "No refills remaining on this prescription.");
      }
      const now = Date.now();
      const updated = { ...rx, refills_remaining: rx.refills_remaining - 1, updated_at: now };
      await db.query(
        "UPDATE prescriptions SET refills_remaining = @refills_remaining, updated_at = @updated_at WHERE id = @id AND tenant_id = @tenant_id",
        { refills_remaining: updated.refills_remaining, updated_at: now, id: prescriptionId, tenant_id: tenantId },
      );
      void events.publish("healthcare.prescription_refilled", { tenantId, prescriptionId }, prescriptionId);
      return updated;
    },
  };
}
