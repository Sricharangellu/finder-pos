import type { PosModule } from "../types.js";
import { PermissionRequestsService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_PERMISSION_REQUESTS_TABLE = `
CREATE TABLE IF NOT EXISTS permission_requests (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL,
  requested_for_user_id  TEXT NOT NULL,
  requested_for_name     TEXT,
  requested_by_user_id   TEXT NOT NULL,
  requested_by_name      TEXT,
  permission_code        TEXT NOT NULL,
  reason                 TEXT NOT NULL,
  business_justification TEXT,
  access_type            TEXT NOT NULL DEFAULT 'temporary',
  start_at               BIGINT,
  end_at                 BIGINT,
  urgency                TEXT NOT NULL DEFAULT 'normal',
  status                 TEXT NOT NULL DEFAULT 'submitted',
  reviewed_by_user_id    TEXT,
  reviewed_by_name       TEXT,
  review_notes           TEXT,
  reviewed_at            BIGINT,
  created_at             BIGINT NOT NULL
);
`;

const CREATE_PERMISSION_OVERRIDES_TABLE = `
CREATE TABLE IF NOT EXISTS permission_overrides (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  user_id             TEXT NOT NULL,
  permission_code     TEXT NOT NULL,
  granted_by_user_id  TEXT NOT NULL,
  granted_by_name     TEXT,
  source_request_id   TEXT NOT NULL,
  starts_at           BIGINT NOT NULL,
  expires_at          BIGINT,
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          BIGINT NOT NULL
);
`;

const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS permission_requests_tenant_status_idx
  ON permission_requests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS permission_requests_tenant_foruser_idx
  ON permission_requests (tenant_id, requested_for_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS permission_overrides_source_idx
  ON permission_overrides (tenant_id, source_request_id);
`;

/**
 * Permission requests — RBAC self-service access-request + approval workflow.
 * A user requests a permission (temporary or permanent); a manager/owner
 * reviews and approves (creating a permission_override), rejects, or revokes.
 * Mounted at /api/v1/permission-requests (hyphen) — the resource name the
 * frontend already calls — via mountPath, not the underscored module name.
 */
export const permissionRequestsModule: PosModule = {
  name: "permission_requests",
  mountPath: "/api/v1/permission-requests",
  migrations: [CREATE_PERMISSION_REQUESTS_TABLE, CREATE_PERMISSION_OVERRIDES_TABLE, CREATE_INDEXES],
  async register({ db, events, router }) {
    const service = new PermissionRequestsService(db, events);
    registerRoutes(router, service);
  },
};

export { PermissionRequestsService } from "./service.js";
export type { PermissionRequest, PermissionOverride, RequestStatus } from "./service.js";
