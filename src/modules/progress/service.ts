import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { badRequest, notFound } from "../../shared/http.js";
import { writeAudit } from "../../shared/audit.js";

export type ProgressStatus =
  | "not_started"
  | "planned"
  | "in_progress"
  | "self_reported_done"
  | "evidence_attached"
  | "system_verified"
  | "validated"
  | "invalidated"
  | "blocked"
  | "skipped";

const manualStatuses = new Set<ProgressStatus>([
  "not_started",
  "planned",
  "in_progress",
  "self_reported_done",
  "blocked",
  "skipped",
]);

export interface ProgressHypothesis {
  id: string;
  tenant_id: string;
  statement: string;
  category: string;
  status: ProgressStatus;
  confidence_score: number;
  success_criteria: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface ProgressTask {
  id: string;
  tenant_id: string;
  hypothesis_id: string | null;
  title: string;
  description: string | null;
  category: string;
  status: ProgressStatus;
  verification_source: string | null;
  due_at: number | null;
  completed_at: number | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface ProgressEvidence {
  id: string;
  tenant_id: string;
  task_id: string | null;
  hypothesis_id: string | null;
  evidence_type: string;
  title: string;
  url: string | null;
  notes: string | null;
  source: string;
  created_by: string;
  created_at: number;
}

export interface ProgressDecision {
  id: string;
  tenant_id: string;
  hypothesis_id: string;
  decision: string;
  reason: string | null;
  next_action: string | null;
  created_by: string;
  created_at: number;
}

export class ProgressService {
  constructor(private readonly db: DB) {}

  async createHypothesis(input: {
    statement: string;
    category?: string;
    confidenceScore?: number;
    successCriteria?: string | null;
  }, tenantId: string, actorId: string): Promise<ProgressHypothesis> {
    const now = Date.now();
    const row: ProgressHypothesis = {
      id: `hyp_${uuidv7()}`,
      tenant_id: tenantId,
      statement: input.statement.trim(),
      category: input.category?.trim() || "business_validation",
      status: "planned",
      confidence_score: input.confidenceScore ?? 0,
      success_criteria: input.successCriteria?.trim() || null,
      created_by: actorId,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO progress_hypotheses
         (id, tenant_id, statement, category, status, confidence_score, success_criteria, created_by, created_at, updated_at)
       VALUES
         (@id, @tenant_id, @statement, @category, @status, @confidence_score, @success_criteria, @created_by, @created_at, @updated_at)`,
      row as unknown as Record<string, unknown>,
    );
    await writeAudit(this.db, {
      tenantId, actorId, action: "progress.hypothesis_created", entityType: "progress_hypothesis", entityId: row.id,
      after: { statement: row.statement, category: row.category, status: row.status },
    });
    return row;
  }

  async listHypotheses(tenantId: string): Promise<{ items: ProgressHypothesis[] }> {
    const items = await this.db.query<ProgressHypothesis>(
      "SELECT * FROM progress_hypotheses WHERE tenant_id = @tenantId ORDER BY created_at DESC",
      { tenantId },
    );
    return { items };
  }

  async createTask(input: {
    title: string;
    description?: string | null;
    category?: string;
    hypothesisId?: string | null;
    verificationSource?: string | null;
    dueAt?: number | null;
  }, tenantId: string, actorId: string): Promise<ProgressTask> {
    if (input.hypothesisId) await this.getHypothesis(input.hypothesisId, tenantId);
    const now = Date.now();
    const row: ProgressTask = {
      id: `tsk_${uuidv7()}`,
      tenant_id: tenantId,
      hypothesis_id: input.hypothesisId ?? null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      category: input.category?.trim() || "retail_readiness",
      status: "planned",
      verification_source: input.verificationSource?.trim() || null,
      due_at: input.dueAt ?? null,
      completed_at: null,
      created_by: actorId,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO progress_tasks
         (id, tenant_id, hypothesis_id, title, description, category, status, verification_source, due_at, completed_at, created_by, created_at, updated_at)
       VALUES
         (@id, @tenant_id, @hypothesis_id, @title, @description, @category, @status, @verification_source, @due_at, @completed_at, @created_by, @created_at, @updated_at)`,
      row as unknown as Record<string, unknown>,
    );
    await writeAudit(this.db, {
      tenantId, actorId, action: "progress.task_created", entityType: "progress_task", entityId: row.id,
      after: { title: row.title, status: row.status, verification_source: row.verification_source },
    });
    return row;
  }

  async listTasks(tenantId: string, status?: ProgressStatus): Promise<{ items: ProgressTask[] }> {
    const params: Record<string, unknown> = { tenantId };
    const where = ["tenant_id = @tenantId"];
    if (status) {
      where.push("status = @status");
      params["status"] = status;
    }
    const items = await this.db.query<ProgressTask>(
      `SELECT * FROM progress_tasks WHERE ${where.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    return { items };
  }

  async updateTaskStatus(id: string, tenantId: string, actorId: string, status: ProgressStatus): Promise<ProgressTask> {
    if (!manualStatuses.has(status)) {
      throw badRequest("validated, invalidated, evidence_attached, and system_verified require evidence, decision, or system verification endpoints");
    }
    const before = await this.getTask(id, tenantId);
    const completedAt = status === "self_reported_done" ? Date.now() : null;
    const row = await this.updateTask(id, tenantId, status, completedAt);
    await writeAudit(this.db, {
      tenantId, actorId, action: "progress.task_status_changed", entityType: "progress_task", entityId: id,
      before: { status: before.status }, after: { status: row.status },
    });
    return row;
  }

  async addEvidence(input: {
    taskId?: string | null;
    hypothesisId?: string | null;
    evidenceType?: string;
    title: string;
    url?: string | null;
    notes?: string | null;
    source?: string;
  }, tenantId: string, actorId: string): Promise<ProgressEvidence> {
    if (!input.taskId && !input.hypothesisId) throw badRequest("evidence must link to a task or hypothesis");
    if (input.taskId) await this.getTask(input.taskId, tenantId);
    if (input.hypothesisId) await this.getHypothesis(input.hypothesisId, tenantId);
    const now = Date.now();
    const row: ProgressEvidence = {
      id: `evd_${uuidv7()}`,
      tenant_id: tenantId,
      task_id: input.taskId ?? null,
      hypothesis_id: input.hypothesisId ?? null,
      evidence_type: input.evidenceType?.trim() || "note",
      title: input.title.trim(),
      url: input.url?.trim() || null,
      notes: input.notes?.trim() || null,
      source: input.source?.trim() || "manual",
      created_by: actorId,
      created_at: now,
    };
    await this.db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO progress_evidence
           (id, tenant_id, task_id, hypothesis_id, evidence_type, title, url, notes, source, created_by, created_at)
         VALUES
           (@id, @tenant_id, @task_id, @hypothesis_id, @evidence_type, @title, @url, @notes, @source, @created_by, @created_at)`,
        row as unknown as Record<string, unknown>,
      );
      if (row.task_id) {
        await tx.query(
          "UPDATE progress_tasks SET status = 'evidence_attached', completed_at = COALESCE(completed_at, @now), updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
          { id: row.task_id, tenantId, now },
        );
      }
      if (row.hypothesis_id) {
        await tx.query(
          "UPDATE progress_hypotheses SET status = 'evidence_attached', updated_at = @now WHERE id = @id AND tenant_id = @tenantId AND status NOT IN ('validated','invalidated')",
          { id: row.hypothesis_id, tenantId, now },
        );
      }
    });
    await writeAudit(this.db, {
      tenantId, actorId, action: "progress.evidence_attached", entityType: "progress_evidence", entityId: row.id,
      after: { task_id: row.task_id, hypothesis_id: row.hypothesis_id, evidence_type: row.evidence_type },
    });
    return row;
  }

  async createDecision(input: {
    hypothesisId: string;
    decision: "validated" | "invalidated";
    reason?: string | null;
    nextAction?: string | null;
  }, tenantId: string, actorId: string): Promise<ProgressDecision> {
    await this.getHypothesis(input.hypothesisId, tenantId);
    const evidence = await this.db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM progress_evidence e
         LEFT JOIN progress_tasks t
           ON t.tenant_id = e.tenant_id AND t.id = e.task_id
        WHERE e.tenant_id = @tenantId
          AND (e.hypothesis_id = @hypothesisId OR t.hypothesis_id = @hypothesisId)`,
      { tenantId, hypothesisId: input.hypothesisId },
    );
    if (Number(evidence?.n ?? 0) === 0) throw badRequest("a hypothesis needs attached evidence before it can be validated or invalidated");
    const now = Date.now();
    const row: ProgressDecision = {
      id: `dec_${uuidv7()}`,
      tenant_id: tenantId,
      hypothesis_id: input.hypothesisId,
      decision: input.decision,
      reason: input.reason?.trim() || null,
      next_action: input.nextAction?.trim() || null,
      created_by: actorId,
      created_at: now,
    };
    await this.db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO progress_decisions
           (id, tenant_id, hypothesis_id, decision, reason, next_action, created_by, created_at)
         VALUES
           (@id, @tenant_id, @hypothesis_id, @decision, @reason, @next_action, @created_by, @created_at)`,
        row as unknown as Record<string, unknown>,
      );
      await tx.query(
        "UPDATE progress_hypotheses SET status = @status, confidence_score = CASE WHEN @status = 'validated' THEN 100 ELSE confidence_score END, updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
        { status: input.decision, id: input.hypothesisId, tenantId, now },
      );
    });
    await writeAudit(this.db, {
      tenantId, actorId, action: "progress.decision_created", entityType: "progress_decision", entityId: row.id,
      after: { hypothesis_id: row.hypothesis_id, decision: row.decision },
    });
    return row;
  }

  async systemVerifyTask(id: string, tenantId: string, actorId: string): Promise<ProgressTask> {
    const task = await this.getTask(id, tenantId);
    if (!task.verification_source) throw badRequest("task has no verification_source");
    const verified = await this.checkVerificationSource(task.verification_source, tenantId);
    if (!verified) throw badRequest(`system verification failed for ${task.verification_source}`);

    const now = Date.now();
    const evidence = await this.addEvidence({
      taskId: id,
      evidenceType: "system_verification",
      title: `Verified by ${task.verification_source}`,
      source: "system",
      notes: "Ascend verified this from tenant-scoped operating data.",
    }, tenantId, actorId);
    await this.db.query(
      "UPDATE progress_tasks SET status = 'system_verified', completed_at = @now, updated_at = @now WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId, now },
    );
    await writeAudit(this.db, {
      tenantId, actorId, action: "progress.task_system_verified", entityType: "progress_task", entityId: id,
      after: { verification_source: task.verification_source, evidence_id: evidence.id },
    });
    return this.getTask(id, tenantId);
  }

  async summary(tenantId: string): Promise<{
    hypotheses: Record<ProgressStatus, number>;
    tasks: Record<ProgressStatus, number>;
    evidenceCount: number;
    decisionsCount: number;
  }> {
    const empty = (): Record<ProgressStatus, number> => ({
      not_started: 0, planned: 0, in_progress: 0, self_reported_done: 0,
      evidence_attached: 0, system_verified: 0, validated: 0, invalidated: 0,
      blocked: 0, skipped: 0,
    });
    const [hypRows, taskRows, ev, dec] = await Promise.all([
      this.db.query<{ status: ProgressStatus; n: number }>("SELECT status, COUNT(*)::int AS n FROM progress_hypotheses WHERE tenant_id = @tenantId GROUP BY status", { tenantId }),
      this.db.query<{ status: ProgressStatus; n: number }>("SELECT status, COUNT(*)::int AS n FROM progress_tasks WHERE tenant_id = @tenantId GROUP BY status", { tenantId }),
      this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM progress_evidence WHERE tenant_id = @tenantId", { tenantId }),
      this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM progress_decisions WHERE tenant_id = @tenantId", { tenantId }),
    ]);
    const hypotheses = empty();
    const tasks = empty();
    for (const r of hypRows) hypotheses[r.status] = Number(r.n);
    for (const r of taskRows) tasks[r.status] = Number(r.n);
    return { hypotheses, tasks, evidenceCount: Number(ev?.n ?? 0), decisionsCount: Number(dec?.n ?? 0) };
  }

  private async getHypothesis(id: string, tenantId: string): Promise<ProgressHypothesis> {
    const row = await this.db.one<ProgressHypothesis>(
      "SELECT * FROM progress_hypotheses WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!row) throw notFound(`hypothesis '${id}' not found`);
    return row;
  }

  private async getTask(id: string, tenantId: string): Promise<ProgressTask> {
    const row = await this.db.one<ProgressTask>(
      "SELECT * FROM progress_tasks WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!row) throw notFound(`task '${id}' not found`);
    return row;
  }

  private async updateTask(id: string, tenantId: string, status: ProgressStatus, completedAt: number | null): Promise<ProgressTask> {
    const row = await this.db.one<ProgressTask>(
      `UPDATE progress_tasks
          SET status = @status, completed_at = @completedAt, updated_at = @now
        WHERE id = @id AND tenant_id = @tenantId
        RETURNING *`,
      { id, tenantId, status, completedAt, now: Date.now() },
    );
    if (!row) throw notFound(`task '${id}' not found`);
    return row;
  }

  private async checkVerificationSource(source: string, tenantId: string): Promise<boolean> {
    switch (source) {
      case "retail.first_product": {
        const r = await this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM products WHERE tenant_id = @tenantId", { tenantId });
        return Number(r?.n ?? 0) > 0;
      }
      case "retail.first_receiving": {
        const r = await this.db.one<{ stock: number; moves: number }>(
          `SELECT COALESCE((SELECT SUM(stock_qty) FROM inventory WHERE tenant_id = @tenantId),0)::int AS stock,
                  COALESCE((SELECT COUNT(*) FROM inventory_movements WHERE tenant_id = @tenantId AND reason = 'receiving'),0)::int AS moves`,
          { tenantId },
        );
        return Number(r?.stock ?? 0) > 0 || Number(r?.moves ?? 0) > 0;
      }
      case "retail.first_sale": {
        const r = await this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM orders WHERE tenant_id = @tenantId AND status = 'completed'", { tenantId });
        return Number(r?.n ?? 0) > 0;
      }
      case "retail.expenses_categorized": {
        const r = await this.db.one<{ uncat: number }>("SELECT COUNT(*) FILTER (WHERE category IS NULL)::int AS uncat FROM expenses WHERE tenant_id = @tenantId", { tenantId });
        return Number(r?.uncat ?? 0) === 0;
      }
      case "retail.cost_prices_complete": {
        const r = await this.db.one<{ missing: number }>(
          `SELECT COUNT(*)::int AS missing FROM products p
            WHERE p.tenant_id = @tenantId AND p.status = 'active'
              AND NOT EXISTS (
                SELECT 1 FROM product_costs c
                 WHERE c.tenant_id = p.tenant_id AND c.product_id = p.id AND c.cost_cents > 0
              )`,
          { tenantId },
        );
        return Number(r?.missing ?? 0) === 0;
      }
      default:
        throw badRequest(`unknown verification_source '${source}'`);
    }
  }
}
