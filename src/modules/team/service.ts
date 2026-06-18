import type { DB } from "../../shared/db.js";

/** Team directory — read-only over the shared users table, tenant-scoped.
 *  Powers the Settings → Users surface. Never returns password hashes. */

export interface TeamMember {
  id: string;
  email: string;
  role: string;
  custom_role_id: string | null;
  created_at: number;
}

export class TeamService {
  constructor(private readonly db: DB) {}

  async list(tenantId: string): Promise<TeamMember[]> {
    return this.db.query<TeamMember>(
      "SELECT id, email, role, custom_role_id, created_at FROM users WHERE tenant_id = @tenantId ORDER BY created_at ASC",
      { tenantId },
    );
  }
}
