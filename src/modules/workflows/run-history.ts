import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { clampLimit, decodeCursor, toPage, type CursorPage } from "../../shared/pagination.js";

/**
 * Workflow run history — an append-only log of workflow/approval-chain
 * invocations (Workflows > Run History tab). Checked first per this
 * effort's convention: grepped the whole tree for "run_history" and any
 * equivalent workflow-invocation log before adding a new table — nothing
 * existed. This is a single sink any workflow-adjacent action (a checkout
 * gate firing at POS, an approval chain being invoked, …) can append a row
 * to, for one unified audit trail across both concepts in this module.
 *
 * Nothing in the codebase writes to this table yet — the same
 * triggering-event product decision blocks this and approval_chain_runs
 * (see approval-chains.ts's class doc comment / WORK/LOOP_STATE.md
 * NEEDS-SRI: which real POS/refund/discount/vendor action should log a run,
 * and under what workflow/trigger name). Ships here as a real, queryable,
 * keyset-paginated table (see shared/pagination.ts + inventory/service.ts's
 * movements() for the cursor convention this follows) ready to receive real
 * rows the moment that decision is made — not fabricated with random
 * durations/cashiers the way the old MSW mock did.
 */

export interface RunRecord {
  id: string;
  workflow_name: string;
  trigger: string;
  status: "passed" | "failed" | "skipped";
  cashier: string;
  duration_ms: number;
  ran_at: number;
  outlet: string;
}

export interface RecordRunInput {
  workflowName: string;
  trigger: string;
  status: "passed" | "failed" | "skipped";
  cashier?: string | null;
  outlet?: string | null;
  durationMs?: number;
  ranAt?: number;
}

interface RunHistoryRow {
  id: string;
  tenant_id: string;
  workflow_name: string;
  trigger: string;
  status: string;
  cashier: string | null;
  outlet: string | null;
  duration_ms: number | string;
  ran_at: number | string;
  created_at: number | string;
}

function parseRun(row: RunHistoryRow): RunRecord {
  return {
    id: row.id,
    workflow_name: row.workflow_name,
    trigger: row.trigger,
    status: row.status as RunRecord["status"],
    cashier: row.cashier ?? "",
    duration_ms: Number(row.duration_ms),
    ran_at: Number(row.ran_at),
    outlet: row.outlet ?? "",
  };
}

export class RunHistoryService {
  constructor(private readonly db: DB) {}

  async list(
    tenantId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<CursorPage<RunRecord> & { total: number }> {
    const limit = clampLimit(opts.limit, 50, 200);
    const cur = decodeCursor(opts.cursor);
    const rows = await this.db.query<RunHistoryRow>(
      `SELECT * FROM workflow_run_history
        WHERE tenant_id = @tenantId
        ${cur ? "AND (ran_at, id) < (@curAt, @curId)" : ""}
        ORDER BY ran_at DESC, id DESC
        LIMIT @limit`,
      { tenantId, limit, ...(cur ? { curAt: cur.at, curId: cur.id } : {}) },
    );
    const totalRow = await this.db.one<{ count: string | number }>(
      "SELECT COUNT(*) AS count FROM workflow_run_history WHERE tenant_id = @tenantId",
      { tenantId },
    );
    const page = toPage(
      rows.map(parseRun) as unknown as Array<RunRecord & Record<string, unknown>>,
      limit,
      "ran_at",
    ) as CursorPage<RunRecord>;
    return { ...page, total: Number(totalRow?.count ?? 0) };
  }

  /**
   * Append-only write. Real INSERT against a real table, but not called
   * anywhere in this codebase today — see class-level doc comment for what
   * real trigger points would need to call this once the triggering-event
   * product decision is made (NEEDS-SRI).
   */
  async recordRun(input: RecordRunInput, tenantId: string): Promise<RunRecord> {
    const id = `run_${uuidv7()}`;
    const now = Date.now();
    const ranAt = input.ranAt ?? now;
    const durationMs = Math.max(0, Math.trunc(input.durationMs ?? 0));
    await this.db.query(
      `INSERT INTO workflow_run_history
         (id, tenant_id, workflow_name, trigger, status, cashier, outlet, duration_ms, ran_at, created_at)
       VALUES
         (@id, @tenantId, @workflowName, @trigger, @status, @cashier, @outlet, @durationMs, @ranAt, @now)`,
      {
        id,
        tenantId,
        workflowName: input.workflowName,
        trigger: input.trigger,
        status: input.status,
        cashier: input.cashier ?? null,
        outlet: input.outlet ?? null,
        durationMs,
        ranAt,
        now,
      },
    );
    return {
      id,
      workflow_name: input.workflowName,
      trigger: input.trigger,
      status: input.status,
      cashier: input.cashier ?? "",
      duration_ms: durationMs,
      ran_at: ranAt,
      outlet: input.outlet ?? "",
    };
  }
}
