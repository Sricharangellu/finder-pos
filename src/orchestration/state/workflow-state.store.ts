import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { WorkflowInstance, WorkflowStepRow, WorkflowStatus, StepStatus, WorkflowContext } from "../types.js";

export class WorkflowStateStore {
  constructor(private readonly db: DB) {}

  async create(
    type: string,
    tenantId: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<WorkflowInstance> {
    const now = Date.now();
    const row: WorkflowInstance = {
      id: `wf_${uuidv7()}`,
      type,
      status: "pending",
      payload: JSON.stringify(payload),
      current_step: null,
      correlation_id: correlationId ?? null,
      tenant_id: tenantId,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    await this.db.query(
      `INSERT INTO workflow_instances
         (id, type, status, payload, current_step, correlation_id, tenant_id, created_at, updated_at, completed_at)
       VALUES
         (@id, @type, @status, @payload, @current_step, @correlation_id, @tenant_id, @created_at, @updated_at, @completed_at)`,
      row as unknown as Record<string, unknown>,
    );
    return row;
  }

  async updateStatus(
    id: string,
    status: WorkflowStatus,
    currentStep?: string | null,
    payloadPatch?: Record<string, unknown>,
  ): Promise<void> {
    const now = Date.now();
    const existing = await this.db.one<WorkflowInstance>(
      "SELECT payload FROM workflow_instances WHERE id = @id",
      { id },
    );
    const mergedPayload = payloadPatch && existing
      ? JSON.stringify({ ...JSON.parse(existing.payload), ...payloadPatch })
      : undefined;

    await this.db.query(
      `UPDATE workflow_instances
         SET status = @status,
             current_step = COALESCE(@currentStep, current_step),
             payload = COALESCE(@payload, payload),
             updated_at = @now,
             completed_at = CASE WHEN @status IN ('completed', 'failed', 'compensated') THEN @now ELSE completed_at END
       WHERE id = @id`,
      { status, currentStep: currentStep ?? null, payload: mergedPayload ?? null, now, id },
    );
  }

  async recordStep(
    workflowId: string,
    stepName: string,
    status: StepStatus,
    input?: Record<string, unknown> | null,
    output?: Record<string, unknown> | null,
    error?: string | null,
  ): Promise<WorkflowStepRow> {
    const now = Date.now();
    const existing = await this.db.one<WorkflowStepRow>(
      "SELECT id, attempts FROM workflow_steps WHERE workflow_id = @workflowId AND step_name = @stepName",
      { workflowId, stepName },
    );
    if (existing) {
      await this.db.query(
        `UPDATE workflow_steps
           SET status = @status, output = COALESCE(@output, output), error = @error,
               attempts = @attempts, completed_at = CASE WHEN @status IN ('completed','failed','compensated') THEN @now ELSE completed_at END
         WHERE id = @id`,
        {
          id: existing.id,
          status,
          output: output ? JSON.stringify(output) : null,
          error: error ?? null,
          attempts: existing.attempts + 1,
          now,
        },
      );
      return { ...existing, status, attempts: existing.attempts + 1 };
    }
    const row: WorkflowStepRow = {
      id: `ws_${uuidv7()}`,
      workflow_id: workflowId,
      step_name: stepName,
      status,
      input: input ? JSON.stringify(input) : null,
      output: output ? JSON.stringify(output) : null,
      error: error ?? null,
      attempts: 1,
      started_at: now,
      completed_at: ["completed", "failed", "compensated"].includes(status) ? now : null,
    };
    await this.db.query(
      `INSERT INTO workflow_steps
         (id, workflow_id, step_name, status, input, output, error, attempts, started_at, completed_at)
       VALUES
         (@id, @workflow_id, @step_name, @status, @input, @output, @error, @attempts, @started_at, @completed_at)`,
      row as unknown as Record<string, unknown>,
    );
    return row;
  }

  async get(id: string): Promise<WorkflowInstance | undefined> {
    const row = await this.db.one<WorkflowInstance>(
      "SELECT * FROM workflow_instances WHERE id = @id",
      { id },
    );
    return row;
  }

  async getByCorrelation(correlationId: string, type: string, tenantId: string): Promise<WorkflowInstance | undefined> {
    return this.db.one<WorkflowInstance>(
      "SELECT * FROM workflow_instances WHERE correlation_id = @correlationId AND type = @type AND tenant_id = @tenantId ORDER BY created_at DESC LIMIT 1",
      { correlationId, type, tenantId },
    );
  }

  async listByTenant(
    tenantId: string,
    type?: string,
    status?: string,
    limit = 50,
  ): Promise<WorkflowInstance[]> {
    const where = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId, limit };
    if (type) { where.push("type = @type"); params.type = type; }
    if (status) { where.push("status = @status"); params.status = status; }
    return this.db.query<WorkflowInstance>(
      `SELECT * FROM workflow_instances WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT @limit`,
      params,
    );
  }
}
