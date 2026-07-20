import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound, conflict } from "../../shared/http.js";

export type SerialStatus = "in_stock" | "sold" | "returned" | "service";

export interface SerialNumber {
  id: string;
  tenant_id: string;
  product_id: string;
  serial: string;
  status: SerialStatus;
  sold_at: number | null;
  service_order_id: string | null;
  received_at: number;
  notes: string | null;
  created_at: number;
}

export interface SerialRow extends SerialNumber {
  product_name: string | null;
  product_sku: string | null;
}

export type SerialNumbersService = ReturnType<typeof serialNumbersService>;

export function serialNumbersService(db: DB, _events: EventBus) {
  return {
    async list(tenantId: string, opts: {
      limit?: number; offset?: number; product_id?: string; status?: SerialStatus; q?: string;
    } = {}) {
      const { limit = 50, offset = 0, product_id, status, q } = opts;
      const where: string[] = ["sn.tenant_id = @tenantId"];
      const params: Record<string, unknown> = { tenantId, limit, offset };
      if (product_id) { where.push("sn.product_id = @product_id"); params["product_id"] = product_id; }
      if (status) { where.push("sn.status = @status"); params["status"] = status; }
      if (q) { where.push("(sn.serial ILIKE @q OR p.name ILIKE @q OR p.sku ILIKE @q)"); params["q"] = `%${q}%`; }
      const cond = where.join(" AND ");
      const [items, countRows] = await Promise.all([
        db.query<SerialRow>(
          `SELECT sn.*, p.name AS product_name, p.sku AS product_sku
           FROM serial_numbers sn
           LEFT JOIN products p
             ON p.id = sn.product_id AND p.tenant_id = sn.tenant_id
           WHERE ${cond}
           ORDER BY sn.created_at DESC
           LIMIT @limit OFFSET @offset`,
          params
        ),
        db.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
           FROM serial_numbers sn
           LEFT JOIN products p
             ON p.id = sn.product_id AND p.tenant_id = sn.tenant_id
           WHERE ${cond}`,
          params
        ),
      ]);
      return { items, total: countRows[0]?.n ?? 0, limit, offset };
    },

    async get(tenantId: string, id: string): Promise<SerialRow> {
      const row = await db.one<SerialRow>(
        `SELECT sn.*, p.name AS product_name, p.sku AS product_sku
         FROM serial_numbers sn
         LEFT JOIN products p
           ON p.id = sn.product_id AND p.tenant_id = sn.tenant_id
         WHERE sn.id = @id AND sn.tenant_id = @tenantId`,
        { id, tenantId }
      );
      if (!row) throw notFound("serial_number");
      return row;
    },

    async receive(tenantId: string, input: {
      product_id: string;
      serial: string;
      notes?: string | null;
    }): Promise<SerialNumber> {
      const existing = await db.one(
        "SELECT id FROM serial_numbers WHERE tenant_id = @tenantId AND serial = @serial",
        { tenantId, serial: input.serial }
      );
      if (existing) throw conflict(`Serial '${input.serial}' already exists`);

      const now = Date.now();
      const row: SerialNumber = {
        id: `sn_${uuidv7()}`,
        tenant_id: tenantId,
        product_id: input.product_id,
        serial: input.serial,
        status: "in_stock",
        sold_at: null,
        service_order_id: null,
        received_at: now,
        notes: input.notes ?? null,
        created_at: now,
      };
      await db.query(
        `INSERT INTO serial_numbers
           (id, tenant_id, product_id, serial, status, sold_at, service_order_id, received_at, notes, created_at)
         VALUES
           (@id, @tenant_id, @product_id, @serial, @status, @sold_at, @service_order_id, @received_at, @notes, @created_at)`,
        { ...row }
      );
      return row;
    },

    async updateStatus(tenantId: string, id: string, input: {
      status: SerialStatus;
      service_order_id?: string | null;
      notes?: string | null;
    }): Promise<SerialRow> {
      const row = await this.get(tenantId, id);
      const sold_at = input.status === "sold" && !row.sold_at ? Date.now() : row.sold_at;
      await db.query(
        `UPDATE serial_numbers
         SET status=@status, sold_at=@sold_at, service_order_id=@service_order_id, notes=@notes
         WHERE id=@id AND tenant_id=@tenantId`,
        {
          status: input.status,
          sold_at,
          service_order_id: input.service_order_id ?? row.service_order_id,
          notes: input.notes ?? row.notes,
          id,
          tenantId,
        }
      );
      return { ...row, status: input.status, sold_at };
    },
  };
}
