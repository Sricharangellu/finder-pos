import { v7 as uuidv7 } from "uuid";
import type { DB } from "./db.js";

export interface AuditInput {
  tenantId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

/**
 * Write a single audit-log row. Pass a transaction-scoped DB to make the
 * audit write atomic with the mutation it describes. Failures are swallowed
 * (best-effort) so a missing audit_log table never breaks a mutation path.
 */
export async function writeAudit(db: DB, input: AuditInput): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audit_log
         (id, tenant_id, actor_id, action, entity_type, entity_id,
          before_state, after_state, occurred_at, request_id)
       VALUES
         (@id, @tenant_id, @actor_id, @action, @entity_type, @entity_id,
          @before_state, @after_state, @occurred_at, @request_id)`,
      {
        id: `aud_${uuidv7()}`,
        tenant_id: input.tenantId,
        actor_id: input.actorId,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId,
        before_state: input.before !== undefined ? JSON.stringify(input.before) : null,
        after_state: input.after !== undefined ? JSON.stringify(input.after) : null,
        occurred_at: Date.now(),
        request_id: input.requestId ?? null,
      },
    );
  } catch {
    // Audit is best-effort — never let a logging failure break a business operation.
  }
}
