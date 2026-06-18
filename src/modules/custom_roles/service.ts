import { v7 as uuidv7 } from "uuid";
import { HttpError } from "../../shared/http.js";
import type { DB } from "../../shared/db.js";
import type { CustomRole, CustomRoleRow } from "../../identity/types.js";

export interface CreateCustomRoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export interface UpdateCustomRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

function parse(row: CustomRoleRow): CustomRole {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    permissions: JSON.parse(row.permissions) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CustomRolesService {
  constructor(private readonly db: DB) {}

  async list(tenantId: string): Promise<CustomRole[]> {
    const rows = await this.db.query<CustomRoleRow>(
      "SELECT * FROM custom_roles WHERE tenant_id = @tenantId ORDER BY name ASC",
      { tenantId },
    );
    return rows.map(parse);
  }

  async get(tenantId: string, id: string): Promise<CustomRole> {
    const row = await this.db.one<CustomRoleRow>(
      "SELECT * FROM custom_roles WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!row) throw new HttpError(404, "not_found", "Custom role not found.");
    return parse(row);
  }

  async create(tenantId: string, input: CreateCustomRoleInput): Promise<CustomRole> {
    const id = `crl_${uuidv7()}`;
    const now = Date.now();
    await this.db.query(
      `INSERT INTO custom_roles (id, tenant_id, name, description, permissions, created_at, updated_at)
       VALUES (@id, @tenantId, @name, @description, @permissions, @now, @now)`,
      {
        id,
        tenantId,
        name: input.name,
        description: input.description ?? null,
        permissions: JSON.stringify(input.permissions),
        now,
      },
    );
    return this.get(tenantId, id);
  }

  async update(tenantId: string, id: string, input: UpdateCustomRoleInput): Promise<CustomRole> {
    const existing = await this.get(tenantId, id);
    const now = Date.now();
    await this.db.query(
      `UPDATE custom_roles SET
         name        = @name,
         description = @description,
         permissions = @permissions,
         updated_at  = @now
       WHERE id = @id AND tenant_id = @tenantId`,
      {
        id,
        tenantId,
        name: input.name ?? existing.name,
        description: input.description !== undefined ? input.description : existing.description,
        permissions: JSON.stringify(input.permissions ?? existing.permissions),
        now,
      },
    );
    return this.get(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.get(tenantId, id); // 404 if missing
    // Clear FK on users before deleting (belt-and-suspenders; FK is ON DELETE SET NULL).
    await this.db.query(
      "UPDATE users SET custom_role_id = NULL WHERE tenant_id = @tenantId AND custom_role_id = @id",
      { tenantId, id },
    );
    await this.db.query(
      "DELETE FROM custom_roles WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
  }

  async assignToUser(tenantId: string, userId: string, customRoleId: string | null): Promise<void> {
    if (customRoleId !== null) {
      await this.get(tenantId, customRoleId); // 404 if missing
    }
    const updated = await this.db.query<{ id: string }>(
      "UPDATE users SET custom_role_id = @customRoleId, updated_at = @now WHERE id = @userId AND tenant_id = @tenantId RETURNING id",
      { customRoleId, now: Date.now(), userId, tenantId },
    );
    if (!updated.length) throw new HttpError(404, "not_found", "User not found.");
  }
}
