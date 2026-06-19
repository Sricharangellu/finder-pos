import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";

export type SagaStatus = "started" | "completed" | "failed" | "compensated";

export interface SagaInstance {
  id: string;
  saga_type: string;
  status: SagaStatus;
  correlation_id: string;
  tenant_id: string;
  payload: string; // JSON
  created_at: number;
  updated_at: number;
}

/**
 * Tracks saga lifecycle in the workflow_instances table
 * (reuses the same table with a saga_type prefix to avoid schema sprawl).
 */
export class SagaStateStore {
  constructor(private readonly db: DB) {}

  async create(
    sagaType: string,
    tenantId: string,
    correlationId: string,
    payload: Record<string, unknown>,
  ): Promise<SagaInstance> {
    const now = Date.now();
    const row: SagaInstance = {
      id: `saga_${uuidv7()}`,
      saga_type: sagaType,
      status: "started",
      correlation_id: correlationId,
      tenant_id: tenantId,
      payload: JSON.stringify(payload),
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO workflow_instances
         (id, type, status, payload, current_step, correlation_id, tenant_id, created_at, updated_at, completed_at)
       VALUES
         (@id, @type, @status, @payload, NULL, @correlationId, @tenantId, @createdAt, @updatedAt, NULL)`,
      {
        id: row.id,
        type: `saga:${sagaType}`,
        status: row.status,
        payload: row.payload,
        correlationId: row.correlation_id,
        tenantId: row.tenant_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    );
    return row;
  }

  async updateStatus(id: string, status: SagaStatus): Promise<void> {
    await this.db.query(
      "UPDATE workflow_instances SET status = @status, updated_at = @now WHERE id = @id",
      { id, status, now: Date.now() },
    );
  }

  async getByCorrelation(sagaType: string, correlationId: string, tenantId: string): Promise<SagaInstance | undefined> {
    const row = await this.db.one<{ id: string; saga_type: string; status: SagaStatus; correlation_id: string; tenant_id: string; payload: string; created_at: number; updated_at: number }>(
      "SELECT id, type AS saga_type, status, correlation_id, tenant_id, payload, created_at, updated_at FROM workflow_instances WHERE type = @type AND correlation_id = @correlationId AND tenant_id = @tenantId ORDER BY created_at DESC LIMIT 1",
      { type: `saga:${sagaType}`, correlationId, tenantId },
    );
    if (!row) return undefined;
    return row as unknown as SagaInstance;
  }
}
