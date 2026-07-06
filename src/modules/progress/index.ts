import type { PosModule } from "../types.js";
import { ProgressService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_PROGRESS_TABLES = `
CREATE TABLE IF NOT EXISTS progress_hypotheses (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  statement        TEXT NOT NULL,
  category         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'planned',
  confidence_score INTEGER NOT NULL DEFAULT 0,
  success_criteria TEXT,
  created_by       TEXT NOT NULL,
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL,
  CONSTRAINT progress_hypotheses_status_chk CHECK (status IN (
    'not_started','planned','in_progress','self_reported_done','evidence_attached',
    'system_verified','validated','invalidated','blocked','skipped'
  )),
  CONSTRAINT progress_hypotheses_confidence_chk CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

CREATE TABLE IF NOT EXISTS progress_tasks (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  hypothesis_id       TEXT,
  title               TEXT NOT NULL,
  description         TEXT,
  category            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'planned',
  verification_source TEXT,
  due_at              BIGINT,
  completed_at        BIGINT,
  created_by          TEXT NOT NULL,
  created_at          BIGINT NOT NULL,
  updated_at          BIGINT NOT NULL,
  CONSTRAINT progress_tasks_status_chk CHECK (status IN (
    'not_started','planned','in_progress','self_reported_done','evidence_attached',
    'system_verified','validated','invalidated','blocked','skipped'
  ))
);

CREATE TABLE IF NOT EXISTS progress_evidence (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  task_id       TEXT,
  hypothesis_id TEXT,
  evidence_type TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT,
  notes         TEXT,
  source        TEXT NOT NULL DEFAULT 'manual',
  created_by    TEXT NOT NULL,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress_decisions (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  hypothesis_id TEXT NOT NULL,
  decision      TEXT NOT NULL,
  reason        TEXT,
  next_action   TEXT,
  created_by    TEXT NOT NULL,
  created_at    BIGINT NOT NULL
);
`;

const CREATE_PROGRESS_INDEXES = `
CREATE INDEX IF NOT EXISTS progress_hypotheses_tenant_idx ON progress_hypotheses (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS progress_tasks_tenant_status_idx ON progress_tasks (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS progress_tasks_hypothesis_idx ON progress_tasks (tenant_id, hypothesis_id);
CREATE INDEX IF NOT EXISTS progress_evidence_task_idx ON progress_evidence (tenant_id, task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS progress_evidence_hypothesis_idx ON progress_evidence (tenant_id, hypothesis_id, created_at DESC);
CREATE INDEX IF NOT EXISTS progress_decisions_hypothesis_idx ON progress_decisions (tenant_id, hypothesis_id, created_at DESC);
`;

export const progressModule: PosModule = {
  name: "progress",
  migrations: [CREATE_PROGRESS_TABLES, CREATE_PROGRESS_INDEXES],
  register({ db, router }) {
    registerRoutes(router, new ProgressService(db));
  },
};

export { ProgressService } from "./service.js";
export type {
  ProgressStatus,
  ProgressHypothesis,
  ProgressTask,
  ProgressEvidence,
  ProgressDecision,
} from "./service.js";
