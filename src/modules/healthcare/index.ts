import type { PosModule, ModuleContext } from "../types.js";
import { healthcareService } from "./service.js";
import { registerRoutes } from "./routes.js";

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
  patient_id        TEXT NOT NULL,
  drug              TEXT NOT NULL,
  dosage            TEXT,
  prescriber        TEXT,
  refills_total     INTEGER NOT NULL DEFAULT 0,
  refills_remaining INTEGER NOT NULL DEFAULT 0,
  expiry_date       TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  notes             TEXT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS prescriptions_tenant_patient_idx ON prescriptions (tenant_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prescriptions_tenant_status_idx ON prescriptions (tenant_id, status);
`;

export const healthcareModule: PosModule = {
  name: "healthcare",
  migrations: [CREATE_PATIENTS, CREATE_PRESCRIPTIONS],
  register({ db, events, router }: ModuleContext) {
    const svc = healthcareService(db, events);
    registerRoutes(router, svc);
  },
};
