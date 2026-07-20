import { v7 as uuidv7 } from "uuid";
import { randomBytes } from "node:crypto";
import type { DB } from "../../shared/db.js";
import { HttpError } from "../../shared/http.js";

/** Team directory — tenant-scoped view over the shared users table.
 *  Powers the Settings → Users surface. Never returns password hashes. */

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  custom_role_id: string | null;
  created_at: number;
}

export interface CreateTeamMemberInput {
  name: string;
  email: string;
  role?: string;
}

const MEMBER_COLUMNS = "id, COALESCE(name, '') AS name, email, role, custom_role_id, created_at";

/** One clock-in/clock-out pair. Epoch-ms numbers, matching the web client's
 *  TimeEntry interface (web/app/(protected)/team/[id]/page.tsx). */
export interface TimeEntry {
  id: string;
  user_id: string;
  clock_in: number;
  clock_out: number | null;
  duration_mins: number | null;
  notes: string | null;
}

const TIME_ENTRY_COLUMNS = "id, user_id, clock_in, clock_out, duration_mins, notes";

export class TeamService {
  constructor(private readonly db: DB) {}

  async list(tenantId: string): Promise<TeamMember[]> {
    return this.db.query<TeamMember>(
      `SELECT ${MEMBER_COLUMNS} FROM users WHERE tenant_id = @tenantId ORDER BY created_at ASC`,
      { tenantId },
    );
  }

  async get(id: string, tenantId: string): Promise<TeamMember> {
    const row = await this.db.one<TeamMember>(
      `SELECT ${MEMBER_COLUMNS} FROM users WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId },
    );
    if (!row) throw new HttpError(404, "not_found", `team member '${id}' not found`);
    return row;
  }

  /** Invite a new member: creates a users row with an unguessable placeholder
   *  password — the member must complete a password reset before first login. */
  async create(input: CreateTeamMemberInput, tenantId: string): Promise<TeamMember> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.db.one<{ id: string }>(
      "SELECT id FROM users WHERE tenant_id = @tenantId AND email = @email",
      { tenantId, email },
    );
    if (existing) throw new HttpError(409, "conflict", "Email already exists.");

    const { default: bcrypt } = await import("bcryptjs");
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    const now = Date.now();
    const id = `usr_${uuidv7()}`;
    await this.db.query(
      `INSERT INTO users (id, tenant_id, email, name, password_hash, role, created_at, updated_at)
       VALUES (@id, @tenantId, @email, @name, @hash, @role, @now, @now)`,
      { id, tenantId, email, name: input.name.trim(), hash: passwordHash, role: input.role ?? "cashier", now },
    );
    return this.get(id, tenantId);
  }

  // ── Time clock ─────────────────────────────────────────────────────────────

  /** Clock a member in. Atomic guard (INSERT … WHERE NOT EXISTS) so two
   *  concurrent clock-ins can't create two open entries — same single-statement
   *  race posture used elsewhere in the codebase (no COUNT(*)+1 patterns). */
  async clockIn(tenantId: string, userId: string): Promise<TimeEntry> {
    await this.get(userId, tenantId); // verify-then-mutate: 404 unknown member
    const now = Date.now();
    const id = `tme_${uuidv7()}`;
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO team_time_entries (id, tenant_id, user_id, clock_in, clock_out, duration_mins, notes, created_at)
       SELECT @id, @tenantId, @userId, @now, NULL, NULL, NULL, @now
       WHERE NOT EXISTS (
         SELECT 1 FROM team_time_entries
         WHERE tenant_id = @tenantId AND user_id = @userId AND clock_out IS NULL
       )
       RETURNING id`,
      { id, tenantId, userId, now },
    );
    if (inserted.length === 0) {
      throw new HttpError(409, "already_clocked_in", "This member already has an open time entry.");
    }
    return (await this.db.one<TimeEntry>(
      `SELECT ${TIME_ENTRY_COLUMNS} FROM team_time_entries WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId },
    ))!;
  }

  /** Clock a member out. Atomic UPDATE of the single open entry; 409 when
   *  there is nothing to close. duration_mins uses BIGINT integer division. */
  async clockOut(tenantId: string, userId: string): Promise<TimeEntry> {
    await this.get(userId, tenantId);
    const now = Date.now();
    const closed = await this.db.query<TimeEntry>(
      `UPDATE team_time_entries
       SET clock_out = @now, duration_mins = (@now - clock_in) / 60000
       WHERE tenant_id = @tenantId AND user_id = @userId AND clock_out IS NULL
       RETURNING ${TIME_ENTRY_COLUMNS}`,
      { tenantId, userId, now },
    );
    if (closed.length === 0) {
      throw new HttpError(409, "not_clocked_in", "This member has no open time entry.");
    }
    return closed[0]!;
  }

  /** Recent time entries for one member, newest first. Bounded (small per-user
   *  list; the UI shows a day/week view — no cursor needed at this size). */
  async listTimeEntries(tenantId: string, userId: string, limit = 100): Promise<TimeEntry[]> {
    const capped = Math.min(Math.max(1, limit), 200);
    return this.db.query<TimeEntry>(
      `SELECT ${TIME_ENTRY_COLUMNS} FROM team_time_entries
       WHERE tenant_id = @tenantId AND user_id = @userId
       ORDER BY clock_in DESC
       LIMIT ${capped}`,
      { tenantId, userId },
    );
  }
}
