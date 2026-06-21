import type { PosModule } from "../types.js";
import { WorkflowsService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_WORKFLOW_DEFINITIONS = `
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  outlet_id   TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_definitions_tenant_idx ON workflow_definitions (tenant_id, outlet_id, enabled);
`;

const CREATE_WORKFLOW_STEPS = `
CREATE TABLE IF NOT EXISTS workflow_steps (
  id                TEXT PRIMARY KEY,
  workflow_id       TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  step_type         TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  config            TEXT NOT NULL DEFAULT '{}',
  position          INTEGER NOT NULL DEFAULT 0,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_steps_workflow_idx ON workflow_steps (workflow_id, position ASC);
`;

/** Workflows module — configurable checkout process steps per outlet. */
export const workflowsModule: PosModule = {
  name: "workflows",
  migrations: [CREATE_WORKFLOW_DEFINITIONS, CREATE_WORKFLOW_STEPS],
  register({ db, router }) {
    registerRoutes(router, new WorkflowsService(db));
  },
};

export { WorkflowsService } from "./service.js";
export type {
  WorkflowDefinition,
  WorkflowStep,
  TriggerCondition,
  StepType,
} from "./service.js";
