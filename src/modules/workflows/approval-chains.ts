import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { badRequest, notFound } from "../../shared/http.js";

/**
 * Approval chains — configurable multi-step sign-off rules for sensitive
 * operations (Workflows > Approval Chains tab). This is a NEW concept,
 * distinct from workflow_definitions/workflow_steps in service.ts: those
 * model checkout automation (age-gate prompts, capture steps executed in
 * order at POS); approval chains model *who* must sign off on a triggering
 * business event (e.g. a price override above a threshold, a large refund, a
 * new vendor, a discount above a threshold) and in what order. New tables,
 * built 2026-07-19 Phase 0 gap-closure pass — see
 * WORK/audits/AUDIT_2026-07-18T005030Z-fe-be-gap-audit.md §2.
 *
 * `runs` is a REAL COUNT(*) over approval_chain_runs (an append-only
 * invocation log), not a stored counter — so it can never drift from what
 * actually happened. But nothing in this codebase invokes a chain today:
 * price overrides, refunds, vendor creation, and discount creation all exist
 * as real actions elsewhere, but none of them currently check against an
 * approval chain before proceeding (checked purchasing's PO approval-tier
 * system — requiredTier/logApproval in purchasing/service.ts — that's a
 * separate, already-shipped, PO-specific concept with its own po_approvals
 * table; wiring approval_chains into it would conflate two different
 * features rather than integrate them). Deciding which real action should
 * check against which chain, and what should happen while a transaction
 * blocks awaiting approval, is a product decision, not plumbing — tracked as
 * NEEDS-SRI in WORK/LOOP_STATE.md, same class as catalog's `/credits` gap.
 * Until that decision, every chain honestly reports runs: 0, and recordRun()
 * below exists (real INSERT, real schema) but is never called by anything.
 */

export interface ApprovalStep {
  role: string;
  label: string;
}

export interface ApprovalChain {
  id: string;
  name: string;
  trigger: string;
  threshold: number | null;
  steps: ApprovalStep[];
  enabled: boolean;
  runs: number;
  created_at: number;
}

export interface CreateApprovalChainInput {
  name: string;
  trigger: string;
  threshold?: number | null;
  steps?: ApprovalStep[];
  enabled?: boolean;
}

export interface UpdateApprovalChainInput {
  name?: string;
  trigger?: string;
  threshold?: number | null;
  steps?: ApprovalStep[];
  enabled?: boolean;
}

interface ApprovalChainRow {
  id: string;
  tenant_id: string;
  name: string;
  trigger: string;
  threshold: number | null;
  steps: string;
  enabled: boolean;
  created_at: number | string;
  updated_at: number | string;
  run_count: number | string;
}

function parseSteps(raw: string): ApprovalStep[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ApprovalStep[]) : [];
  } catch {
    return [];
  }
}

function parseChain(row: ApprovalChainRow): ApprovalChain {
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger,
    threshold: row.threshold === null ? null : Number(row.threshold),
    steps: parseSteps(row.steps),
    enabled: Boolean(row.enabled),
    runs: Number(row.run_count ?? 0),
    created_at: Number(row.created_at),
  };
}

export class ApprovalChainsService {
  constructor(private readonly db: DB) {}

  async list(tenantId: string): Promise<ApprovalChain[]> {
    const rows = await this.db.query<ApprovalChainRow>(
      `SELECT c.*, COALESCE(r.run_count, 0) AS run_count
         FROM approval_chains c
         LEFT JOIN (
           SELECT chain_id, COUNT(*) AS run_count
             FROM approval_chain_runs
            WHERE tenant_id = @tenantId
            GROUP BY chain_id
         ) r ON r.chain_id = c.id
        WHERE c.tenant_id = @tenantId
        ORDER BY c.created_at ASC`,
      { tenantId },
    );
    return rows.map(parseChain);
  }

  private async getRow(id: string, tenantId: string): Promise<ApprovalChainRow> {
    const row = await this.db.one<ApprovalChainRow>(
      `SELECT c.*, COALESCE(
           (SELECT COUNT(*) FROM approval_chain_runs r WHERE r.chain_id = c.id AND r.tenant_id = c.tenant_id),
           0
         ) AS run_count
         FROM approval_chains c
        WHERE c.id = @id AND c.tenant_id = @tenantId`,
      { id, tenantId },
    );
    if (!row) throw notFound(`approval chain '${id}' not found`);
    return row;
  }

  async get(id: string, tenantId: string): Promise<ApprovalChain> {
    return parseChain(await this.getRow(id, tenantId));
  }

  async create(input: CreateApprovalChainInput, tenantId: string): Promise<ApprovalChain> {
    if (!input.name.trim()) throw badRequest("name is required");
    if (!input.trigger.trim()) throw badRequest("trigger is required");
    const id = `apc_${uuidv7()}`;
    const now = Date.now();
    await this.db.query(
      `INSERT INTO approval_chains (id, tenant_id, name, trigger, threshold, steps, enabled, created_at, updated_at)
       VALUES (@id, @tenantId, @name, @trigger, @threshold, @steps, @enabled, @now, @now)`,
      {
        id,
        tenantId,
        name: input.name,
        trigger: input.trigger,
        threshold: input.threshold ?? null,
        steps: JSON.stringify(input.steps ?? []),
        enabled: input.enabled ?? true,
        now,
      },
    );
    return this.get(id, tenantId);
  }

  async update(id: string, input: UpdateApprovalChainInput, tenantId: string): Promise<ApprovalChain> {
    const existing = await this.getRow(id, tenantId);
    const now = Date.now();
    await this.db.query(
      `UPDATE approval_chains SET
         name       = @name,
         trigger    = @trigger,
         threshold  = @threshold,
         steps      = @steps,
         enabled    = @enabled,
         updated_at = @now
       WHERE id = @id AND tenant_id = @tenantId`,
      {
        id,
        tenantId,
        name: input.name ?? existing.name,
        trigger: input.trigger ?? existing.trigger,
        threshold: "threshold" in input ? (input.threshold ?? null) : existing.threshold,
        steps: input.steps ? JSON.stringify(input.steps) : existing.steps,
        enabled: input.enabled !== undefined ? input.enabled : Boolean(existing.enabled),
        now,
      },
    );
    return this.get(id, tenantId);
  }

  async delete(id: string, tenantId: string): Promise<void> {
    await this.getRow(id, tenantId); // 404 guard
    await this.db.query(
      "DELETE FROM approval_chain_runs WHERE chain_id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    await this.db.query(
      "DELETE FROM approval_chains WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
  }

  /**
   * Append-only invocation-log write. Real INSERT against a real table, but
   * not called anywhere in this codebase today — see the class-level doc
   * comment for what real trigger points (POS price override, refund,
   * vendor create, discount create) would need to call this once the
   * triggering-event product decision is made (NEEDS-SRI).
   */
  async recordRun(
    chainId: string,
    tenantId: string,
    actorId: string | null,
    actorRole: string | null,
    outcome: string,
  ): Promise<void> {
    await this.getRow(chainId, tenantId); // 404 guard
    await this.db.query(
      `INSERT INTO approval_chain_runs (id, tenant_id, chain_id, actor_id, actor_role, outcome, created_at)
       VALUES (@id, @tenantId, @chainId, @actorId, @actorRole, @outcome, @now)`,
      { id: `acr_${uuidv7()}`, tenantId, chainId, actorId, actorRole, outcome, now: Date.now() },
    );
  }
}
