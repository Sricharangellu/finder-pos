import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound, conflict } from "../../shared/http.js";
import { writeAudit } from "../../shared/audit.js";

export type RequestStatus = "submitted" | "pending_review" | "approved" | "rejected" | "revoked";
export type OverrideStatus = "active" | "revoked" | "expired";

export interface PermissionRequest {
  id: string;
  tenant_id: string;
  requested_for_user_id: string;
  requested_for_name: string | null;
  requested_by_user_id: string;
  requested_by_name: string | null;
  permission_code: string;
  reason: string;
  business_justification: string | null;
  access_type: string;
  start_at: number | null;
  end_at: number | null;
  urgency: string;
  status: RequestStatus;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  review_notes: string | null;
  reviewed_at: number | null;
  created_at: number;
}

export interface PermissionOverride {
  id: string;
  tenant_id: string;
  user_id: string;
  permission_code: string;
  granted_by_user_id: string;
  granted_by_name: string | null;
  source_request_id: string;
  starts_at: number;
  expires_at: number | null;
  status: OverrideStatus;
  created_at: number;
}

export interface CreateRequestInput {
  requestedForUserId: string;
  requestedForName?: string;
  requestedByUserId?: string;
  requestedByName?: string;
  permissionCode: string;
  reason: string;
  businessJustification?: string;
  accessType?: string;
  startAt?: number;
  endAt?: number;
  urgency?: string;
}

export interface Reviewer {
  userId: string;
  name: string | null;
}

/** Derive a coarse risk level from a permission code (mirrors the frontend). */
export function riskLevel(code: string): "low" | "medium" | "high" {
  const c = code.toLowerCase();
  if (/(delete|remove|void|refund|price|discount|export|payout|admin|owner|role|permission|credit)/.test(c)) return "high";
  if (/(edit|update|write|approve|create|manage|adjust|transfer)/.test(c)) return "medium";
  return "low";
}

type Row = PermissionRequest & { risk_level?: string };

export class PermissionRequestsService {
  constructor(private readonly db: DB, private readonly events: EventBus) {}

  private withRisk(r: PermissionRequest): Row {
    return { ...r, risk_level: riskLevel(r.permission_code) };
  }

  async list(tenantId: string, status?: string): Promise<{ items: Row[]; pending_count: number }> {
    const where = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (status) { where.push("status = @status"); params["status"] = status; }
    const rows = await this.db.query<PermissionRequest>(
      `SELECT * FROM permission_requests WHERE ${where.join(" AND ")} ORDER BY created_at DESC`,
      params,
    );
    const pending = await this.db.one<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM permission_requests WHERE tenant_id = @tenantId AND status IN ('submitted','pending_review')",
      { tenantId },
    );
    return { items: rows.map((r) => this.withRisk(r)), pending_count: Number(pending?.c ?? 0) };
  }

  async listForUser(tenantId: string, userId: string): Promise<{ items: Row[] }> {
    const rows = await this.db.query<PermissionRequest>(
      "SELECT * FROM permission_requests WHERE tenant_id = @tenantId AND requested_for_user_id = @userId ORDER BY created_at DESC",
      { tenantId, userId },
    );
    return { items: rows.map((r) => this.withRisk(r)) };
  }

  /** Overrides granted to one member, newest first. `status` is computed
   *  live: an 'active' row past its expires_at reads as 'expired' without
   *  waiting for a sweep — the UI must never show a stale grant as active. */
  async listOverridesForUser(tenantId: string, userId: string): Promise<{ items: PermissionOverride[] }> {
    const items = await this.db.query<PermissionOverride>(
      `SELECT id, tenant_id, user_id, permission_code, granted_by_user_id,
              granted_by_name, source_request_id, starts_at, expires_at, created_at,
              CASE WHEN status = 'active' AND expires_at IS NOT NULL AND expires_at < @now
                   THEN 'expired' ELSE status END AS status
       FROM permission_overrides
       WHERE tenant_id = @tenantId AND user_id = @userId
       ORDER BY created_at DESC
       LIMIT 200`,
      { tenantId, userId, now: Date.now() },
    );
    return { items };
  }

  async get(id: string, tenantId: string): Promise<Row> {
    const row = await this.db.one<PermissionRequest>(
      "SELECT * FROM permission_requests WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!row) throw notFound(`permission request '${id}'`);
    return this.withRisk(row);
  }

  async create(input: CreateRequestInput, tenantId: string, actor: Reviewer): Promise<Row> {
    const now = Date.now();
    const row: PermissionRequest = {
      id: `pr_${uuidv7()}`,
      tenant_id: tenantId,
      requested_for_user_id: input.requestedForUserId,
      requested_for_name: input.requestedForName ?? null,
      requested_by_user_id: input.requestedByUserId ?? actor.userId,
      requested_by_name: input.requestedByName ?? actor.name,
      permission_code: input.permissionCode,
      reason: input.reason,
      business_justification: input.businessJustification ?? null,
      access_type: input.accessType ?? "temporary",
      start_at: input.startAt ?? null,
      end_at: input.endAt ?? null,
      urgency: input.urgency ?? "normal",
      status: "submitted",
      reviewed_by_user_id: null,
      reviewed_by_name: null,
      review_notes: null,
      reviewed_at: null,
      created_at: now,
    };
    await this.db.query(
      `INSERT INTO permission_requests
         (id, tenant_id, requested_for_user_id, requested_for_name, requested_by_user_id, requested_by_name,
          permission_code, reason, business_justification, access_type, start_at, end_at, urgency, status,
          reviewed_by_user_id, reviewed_by_name, review_notes, reviewed_at, created_at)
       VALUES
         (@id, @tenant_id, @requested_for_user_id, @requested_for_name, @requested_by_user_id, @requested_by_name,
          @permission_code, @reason, @business_justification, @access_type, @start_at, @end_at, @urgency, @status,
          @reviewed_by_user_id, @reviewed_by_name, @review_notes, @reviewed_at, @created_at)`,
      row as unknown as Record<string, unknown>,
    );
    await this.events.publish("permission_request.submitted", { tenantId, id: row.id, permissionCode: row.permission_code }, row.id);
    return this.withRisk(row);
  }

  /** A request can only be reviewed once, while it is still open. */
  private assertReviewable(r: PermissionRequest): void {
    if (r.status !== "submitted" && r.status !== "pending_review") {
      throw conflict(`permission request '${r.id}' is ${r.status} and cannot be reviewed`);
    }
  }

  async approve(id: string, tenantId: string, reviewer: Reviewer, reviewNotes?: string, expiresAt?: number): Promise<Row & { override: PermissionOverride }> {
    const pr = await this.get(id, tenantId);
    this.assertReviewable(pr);
    const now = Date.now();
    await this.db.query(
      `UPDATE permission_requests SET status='approved', reviewed_by_user_id=@rid, reviewed_by_name=@rname,
         review_notes=@notes, reviewed_at=@now WHERE id=@id AND tenant_id=@tenantId`,
      { rid: reviewer.userId, rname: reviewer.name, notes: reviewNotes ?? null, now, id, tenantId },
    );
    const override: PermissionOverride = {
      id: `ov_${uuidv7()}`,
      tenant_id: tenantId,
      user_id: pr.requested_for_user_id,
      permission_code: pr.permission_code,
      granted_by_user_id: reviewer.userId,
      granted_by_name: reviewer.name,
      source_request_id: pr.id,
      starts_at: pr.start_at ?? now,
      expires_at: expiresAt ?? pr.end_at ?? null,
      status: "active",
      created_at: now,
    };
    await this.db.query(
      `INSERT INTO permission_overrides
         (id, tenant_id, user_id, permission_code, granted_by_user_id, granted_by_name, source_request_id, starts_at, expires_at, status, created_at)
       VALUES
         (@id, @tenant_id, @user_id, @permission_code, @granted_by_user_id, @granted_by_name, @source_request_id, @starts_at, @expires_at, @status, @created_at)`,
      override as unknown as Record<string, unknown>,
    );
    await writeAudit(this.db, {
      tenantId, actorId: reviewer.userId, action: "permission_request.approved",
      entityType: "permission_request", entityId: id,
      after: { permissionCode: pr.permission_code, forUser: pr.requested_for_user_id, expiresAt: override.expires_at },
    });
    await this.events.publish("permission_request.approved", { tenantId, id, overrideId: override.id }, id);
    return { ...this.withRisk({ ...pr, status: "approved", reviewed_by_user_id: reviewer.userId, reviewed_by_name: reviewer.name, review_notes: reviewNotes ?? null, reviewed_at: now }), override };
  }

  async reject(id: string, tenantId: string, reviewer: Reviewer, reviewNotes?: string): Promise<Row> {
    const pr = await this.get(id, tenantId);
    this.assertReviewable(pr);
    const now = Date.now();
    await this.db.query(
      `UPDATE permission_requests SET status='rejected', reviewed_by_user_id=@rid, reviewed_by_name=@rname,
         review_notes=@notes, reviewed_at=@now WHERE id=@id AND tenant_id=@tenantId`,
      { rid: reviewer.userId, rname: reviewer.name, notes: reviewNotes ?? null, now, id, tenantId },
    );
    await writeAudit(this.db, {
      tenantId, actorId: reviewer.userId, action: "permission_request.rejected",
      entityType: "permission_request", entityId: id, before: { status: pr.status }, after: { status: "rejected" },
    });
    return this.withRisk({ ...pr, status: "rejected", reviewed_by_user_id: reviewer.userId, reviewed_by_name: reviewer.name, review_notes: reviewNotes ?? null, reviewed_at: now });
  }

  async revoke(id: string, tenantId: string, reviewer: Reviewer, reviewNotes?: string): Promise<{ ok: true }> {
    const pr = await this.get(id, tenantId);
    if (pr.status !== "approved") throw conflict(`permission request '${id}' is ${pr.status}; only approved grants can be revoked`);
    const now = Date.now();
    await this.db.query(
      "UPDATE permission_requests SET status='revoked', review_notes=@notes, reviewed_at=@now WHERE id=@id AND tenant_id=@tenantId",
      { notes: reviewNotes ?? null, now, id, tenantId },
    );
    await this.db.query(
      "UPDATE permission_overrides SET status='revoked' WHERE source_request_id=@id AND tenant_id=@tenantId",
      { id, tenantId },
    );
    await writeAudit(this.db, {
      tenantId, actorId: reviewer.userId, action: "permission_request.revoked",
      entityType: "permission_request", entityId: id, before: { status: "approved" }, after: { status: "revoked" },
    });
    return { ok: true };
  }
}
