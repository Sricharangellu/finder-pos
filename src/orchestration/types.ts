import type { DB } from "../shared/db.js";
import type { EventBus } from "../shared/events.js";

export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "compensated";

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface WorkflowInstance {
  id: string;
  type: string;
  status: WorkflowStatus;
  payload: string; // JSON
  current_step: string | null;
  correlation_id: string | null;
  tenant_id: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface WorkflowStepRow {
  id: string;
  workflow_id: string;
  step_name: string;
  status: StepStatus;
  input: string | null; // JSON
  output: string | null; // JSON
  error: string | null;
  attempts: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface WorkflowEventRow {
  id: string;
  workflow_id: string;
  type: string;
  data: string; // JSON
  occurred_at: number;
}

export interface JobRow {
  id: string;
  type: string;
  payload: string; // JSON
  tenant_id: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: number;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface IdempotencyKeyRow {
  key: string;
  tenant_id: string;
  workflow_id: string | null;
  result: string | null; // JSON
  created_at: number;
  expires_at: number;
}

export interface WorkflowLockRow {
  lock_key: string;
  holder: string;
  acquired_at: number;
  expires_at: number;
}

/** Runtime context passed between steps. Workflows extend this. */
export interface WorkflowContext {
  workflowId: string;
  tenantId: string;
  correlationId: string;
  [key: string]: unknown;
}

/** A single step in a workflow. execute() mutates and returns the updated context. */
export interface StepDefinition<Ctx extends WorkflowContext = WorkflowContext> {
  name: string;
  execute(ctx: Ctx, db: DB, events: EventBus): Promise<Ctx>;
  compensate?(ctx: Ctx, db: DB, events: EventBus): Promise<void>;
}

/** A complete workflow definition. */
export interface WorkflowDefinition<Ctx extends WorkflowContext = WorkflowContext> {
  type: string;
  /** Called once per event to decide if this workflow handles it. */
  triggers: string[];
  /** Build the initial context from the triggering event payload. */
  buildContext(
    triggerPayload: Record<string, unknown>,
    tenantId: string,
  ): Ctx;
  steps: StepDefinition<Ctx>[];
}

export interface EnqueueJobOptions {
  type: string;
  payload: Record<string, unknown>;
  tenantId: string;
  runAt?: number;
  maxAttempts?: number;
}
