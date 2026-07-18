import type { PosModule } from "../types.js";
import { TeamService } from "./service.js";
import { PermissionRequestsService } from "../permission_requests/service.js";
import { registerRoutes } from "./routes.js";

// Time clock entries — one row per clock-in/clock-out pair. Epoch-ms BIGINTs
// like every other timestamp in the schema. The partial unique index is the
// database-level backstop for the "one open entry per member" invariant that
// the service also enforces atomically (defense in depth).
const CREATE_TIME_ENTRIES = `
CREATE TABLE IF NOT EXISTS time_entries (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  clock_in      BIGINT NOT NULL,
  clock_out     BIGINT,
  duration_mins BIGINT,
  notes         TEXT,
  created_at    BIGINT NOT NULL
);
`;

const CREATE_TIME_ENTRIES_INDEXES = `
CREATE INDEX IF NOT EXISTS time_entries_tenant_user_idx
  ON time_entries (tenant_id, user_id, clock_in DESC);
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open_idx
  ON time_entries (tenant_id, user_id) WHERE clock_out IS NULL;
`;

/** Team directory (Settings → Users) + time clock. Directory reads the shared
 *  users table; the time clock owns time_entries. Per-member permission views
 *  delegate to the permission_requests module, which owns those tables. */
export const teamModule: PosModule = {
  name: "team",
  migrations: [CREATE_TIME_ENTRIES, CREATE_TIME_ENTRIES_INDEXES],
  async register({ db, events, router }) {
    const service = new TeamService(db);
    registerRoutes(router, service, new PermissionRequestsService(db, events));
  },
};

export { TeamService } from "./service.js";
export type { TeamMember } from "./service.js";
