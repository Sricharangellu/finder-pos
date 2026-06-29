import type { PosModule, ModuleContext } from "../types.js";
import { educationService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_STUDENTS = `
CREATE TABLE IF NOT EXISTS students (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  phone         TEXT,
  date_of_birth TEXT,
  course_id     TEXT,
  enrolled_at   BIGINT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','graduated')),
  notes         TEXT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS students_tenant_status_idx ON students (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS students_tenant_email_idx ON students (tenant_id, email) WHERE email != '';
`;

const CREATE_FEE_RECORDS = `
CREATE TABLE IF NOT EXISTS fee_records (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  student_id     TEXT NOT NULL,
  description    TEXT NOT NULL,
  amount_cents   BIGINT NOT NULL,
  due_date       TEXT,
  paid_at        BIGINT,
  payment_method TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','waived')),
  created_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS fee_records_tenant_student_idx ON fee_records (tenant_id, student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fee_records_tenant_status_idx ON fee_records (tenant_id, status);
`;

export const educationModule: PosModule = {
  name: "education",
  migrations: [CREATE_STUDENTS, CREATE_FEE_RECORDS],
  register({ db, events, router }: ModuleContext) {
    const svc = educationService(db, events);
    registerRoutes(router, svc);
  },
};
