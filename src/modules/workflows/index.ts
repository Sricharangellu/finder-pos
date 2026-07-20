import type { PosModule } from "../types.js";
import { WorkflowsService } from "./service.js";
import { registerRoutes } from "./routes.js";
import { ApprovalChainsService } from "./approval-chains.js";
import { registerApprovalChainRoutes } from "./approval-chains-routes.js";
import { RunHistoryService } from "./run-history.js";
import { registerRunHistoryRoutes } from "./run-history-routes.js";

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

// Approval chains (2026-07-19, Phase 0 gap-closure): configurable multi-step
// sign-off rules, a NEW concept distinct from workflow_definitions/steps
// above — see approval-chains.ts's class doc comment for the full rationale
// and the NEEDS-SRI note on wiring real triggering events.
const CREATE_APPROVAL_CHAINS = `
CREATE TABLE IF NOT EXISTS approval_chains (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  trigger     TEXT NOT NULL,
  threshold   INTEGER,
  steps       TEXT NOT NULL DEFAULT '[]',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS approval_chains_tenant_idx ON approval_chains (tenant_id, enabled);
`;

// Append-only invocation log backing the real \`runs\` count on each chain.
// Nothing writes to this table yet — see approval-chains.ts doc comment.
const CREATE_APPROVAL_CHAIN_RUNS = `
CREATE TABLE IF NOT EXISTS approval_chain_runs (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  chain_id   TEXT NOT NULL REFERENCES approval_chains(id) ON DELETE CASCADE,
  actor_id   TEXT,
  actor_role TEXT,
  outcome    TEXT NOT NULL DEFAULT 'approved',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS approval_chain_runs_chain_idx ON approval_chain_runs (tenant_id, chain_id, created_at DESC);
`;

// Run history (2026-07-19, Phase 0 gap-closure): append-only log any
// workflow-adjacent action can write to. Grepped the tree for "run_history"
// first — nothing existed. Nothing writes to it yet either — see
// run-history.ts doc comment / WORK/LOOP_STATE.md NEEDS-SRI.
const CREATE_WORKFLOW_RUN_HISTORY = `
CREATE TABLE IF NOT EXISTS workflow_run_history (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_name TEXT NOT NULL,
  trigger       TEXT NOT NULL,
  status        TEXT NOT NULL,
  cashier       TEXT,
  outlet        TEXT,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  ran_at        BIGINT NOT NULL,
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_run_history_tenant_idx ON workflow_run_history (tenant_id, ran_at DESC, id DESC);
`;

/** Workflows module — configurable checkout process steps per outlet, plus
 *  approval chains and run history (see those files for scope notes). */
export const workflowsModule: PosModule = {
  name: "workflows",
  migrations: [
    CREATE_WORKFLOW_DEFINITIONS,
    CREATE_WORKFLOW_STEPS,
    CREATE_APPROVAL_CHAINS,
    CREATE_APPROVAL_CHAIN_RUNS,
    CREATE_WORKFLOW_RUN_HISTORY,
  ],
  register({ db, router }) {
    // Order matters: /approval-chains and /run-history are literal,
    // single-segment routes that must be registered before routes.ts's
    // `GET /:id` catch-all, or Express would swallow them as :id values.
    registerApprovalChainRoutes(router, new ApprovalChainsService(db));
    registerRunHistoryRoutes(router, new RunHistoryService(db));
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
export { ApprovalChainsService } from "./approval-chains.js";
export type { ApprovalChain, ApprovalStep } from "./approval-chains.js";
export { RunHistoryService } from "./run-history.js";
export type { RunRecord } from "./run-history.js";
