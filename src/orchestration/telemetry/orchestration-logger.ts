import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";

export class OrchestrationLogger {
  constructor(private readonly db: DB) {}

  async log(
    workflowId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO workflow_events (id, workflow_id, type, data, occurred_at)
       VALUES (@id, @workflowId, @type, @data, @occurredAt)`,
      {
        id: `wev_${uuidv7()}`,
        workflowId,
        type,
        data: JSON.stringify(data),
        occurredAt: Date.now(),
      },
    );
  }

  async logStep(
    workflowId: string,
    stepName: string,
    status: "started" | "completed" | "failed" | "compensating" | "compensated",
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.log(workflowId, `step.${stepName}.${status}`, { stepName, status, ...data });
  }

  async getEvents(workflowId: string): Promise<Array<{ type: string; data: unknown; occurred_at: number }>> {
    const rows = await this.db.query<{ type: string; data: string; occurred_at: number }>(
      "SELECT type, data, occurred_at FROM workflow_events WHERE workflow_id = @workflowId ORDER BY occurred_at ASC",
      { workflowId },
    );
    return rows.map((r) => ({ type: r.type, data: JSON.parse(r.data), occurred_at: r.occurred_at }));
  }
}
