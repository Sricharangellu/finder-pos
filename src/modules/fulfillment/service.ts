import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { HttpError } from "../../shared/http.js";

/** Fulfillment / WMS — bin locations, product→location assignment, and
 *  pick/pack of orders. Tenant-scoped. Pick lists are sorted into a pick path
 *  (by location code) so a picker walks the floor efficiently. */

export type LocationKind = "zone" | "aisle" | "shelf" | "bin";
export type PickStatus = "picking" | "picked" | "packed";

export interface Location {
  id: string;
  tenant_id: string;
  code: string;
  name: string | null;
  kind: LocationKind;
  created_at: number;
}

export interface PickListLine {
  id: string;
  tenant_id: string;
  pick_list_id: string;
  product_id: string;
  name: string;
  quantity: number;
  picked_qty: number;
  location_code: string | null;
  status: "pending" | "picked";
}

export interface PickList {
  id: string;
  tenant_id: string;
  order_id: string;
  status: PickStatus;
  created_at: number;
  updated_at: number;
}

export class FulfillmentService {
  constructor(private readonly db: DB) {}

  // ── Locations ────────────────────────────────────────────────────────────
  async createLocation(code: string, name: string | undefined, kind: LocationKind, tenantId: string): Promise<Location> {
    const loc: Location = { id: `loc_${uuidv7()}`, tenant_id: tenantId, code, name: name ?? null, kind, created_at: Date.now() };
    try {
      await this.db.query(
        "INSERT INTO locations (id, tenant_id, code, name, kind, created_at) VALUES (@id,@tenant_id,@code,@name,@kind,@created_at)",
        loc as unknown as Record<string, unknown>,
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new HttpError(409, "duplicate", `location code '${code}' already exists`);
      throw err;
    }
    return loc;
  }

  async listLocations(tenantId: string): Promise<Location[]> {
    return this.db.query<Location>("SELECT * FROM locations WHERE tenant_id = @t ORDER BY code ASC", { t: tenantId });
  }

  /** Assign a product's primary pick location. */
  async assign(productId: string, locationId: string, tenantId: string): Promise<void> {
    const loc = await this.db.one("SELECT id FROM locations WHERE id = @l AND tenant_id = @t", { l: locationId, t: tenantId });
    if (!loc) throw new HttpError(404, "not_found", `location '${locationId}' not found`);
    await this.db.query(
      `INSERT INTO product_locations (tenant_id, product_id, location_id, updated_at) VALUES (@t,@p,@l,@now)
       ON CONFLICT (tenant_id, product_id) DO UPDATE SET location_id = EXCLUDED.location_id, updated_at = EXCLUDED.updated_at`,
      { t: tenantId, p: productId, l: locationId, now: Date.now() },
    );
  }

  // ── Pick / pack ──────────────────────────────────────────────────────────
  /** Build a pick list from an order: a line per order line, resolved to its
   *  product's location and sorted into a pick path (by location code). */
  async createPickList(orderId: string, tenantId: string): Promise<PickList & { lines: PickListLine[] }> {
    const order = await this.db.one("SELECT id FROM orders WHERE id = @o AND tenant_id = @t", { o: orderId, t: tenantId });
    if (!order) throw new HttpError(404, "not_found", `order '${orderId}' not found`);
    const existing = await this.db.one<PickList>("SELECT * FROM pick_lists WHERE order_id = @o AND tenant_id = @t", { o: orderId, t: tenantId });
    if (existing) return { ...existing, lines: await this.lines(existing.id, tenantId) };

    const orderLines = await this.db.query<{ product_id: string; name: string; quantity: number; code: string | null }>(
      `SELECT ol.product_id, ol.name, ol.quantity, l.code
         FROM order_lines ol
         LEFT JOIN product_locations pl ON pl.product_id = ol.product_id AND pl.tenant_id = ol.tenant_id
         LEFT JOIN locations l ON l.id = pl.location_id AND l.tenant_id = ol.tenant_id
        WHERE ol.order_id = @o AND ol.tenant_id = @t
        ORDER BY l.code ASC NULLS LAST`,
      { o: orderId, t: tenantId },
    );
    const now = Date.now();
    const id = `pik_${uuidv7()}`;
    const lines: PickListLine[] = orderLines.map((ol) => ({
      id: `pkl_${uuidv7()}`, tenant_id: tenantId, pick_list_id: id, product_id: ol.product_id,
      name: ol.name, quantity: Number(ol.quantity), picked_qty: 0, location_code: ol.code ?? null, status: "pending",
    }));
    await this.db.tx(async (tdb) => {
      await tdb.query("INSERT INTO pick_lists (id, tenant_id, order_id, status, created_at, updated_at) VALUES (@id,@t,@o,'picking',@now,@now)", { id, t: tenantId, o: orderId, now });
      for (const l of lines) {
        await tdb.query(
          "INSERT INTO pick_list_lines (id, tenant_id, pick_list_id, product_id, name, quantity, picked_qty, location_code, status) VALUES (@id,@tenant_id,@pick_list_id,@product_id,@name,@quantity,0,@location_code,'pending')",
          l as unknown as Record<string, unknown>,
        );
      }
    });
    return { id, tenant_id: tenantId, order_id: orderId, status: "picking", created_at: now, updated_at: now, lines };
  }

  async lines(pickListId: string, tenantId: string): Promise<PickListLine[]> {
    return this.db.query<PickListLine>(
      "SELECT * FROM pick_list_lines WHERE pick_list_id = @id AND tenant_id = @t ORDER BY location_code ASC NULLS LAST",
      { id: pickListId, t: tenantId },
    );
  }

  async getPickList(id: string, tenantId: string): Promise<PickList & { lines: PickListLine[] }> {
    const pl = await this.db.one<PickList>("SELECT * FROM pick_lists WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!pl) throw new HttpError(404, "not_found", `pick list '${id}' not found`);
    return { ...pl, lines: await this.lines(id, tenantId) };
  }

  async listPickLists(tenantId: string): Promise<PickList[]> {
    return this.db.query<PickList>("SELECT * FROM pick_lists WHERE tenant_id = @t ORDER BY created_at DESC LIMIT 200", { t: tenantId });
  }

  /** Mark a line picked (full quantity by default). Flips the list to 'picked' when all lines are done. */
  async pickLine(pickListId: string, lineId: string, qty: number | undefined, tenantId: string): Promise<PickList & { lines: PickListLine[] }> {
    const line = await this.db.one<PickListLine>("SELECT * FROM pick_list_lines WHERE id = @l AND pick_list_id = @p AND tenant_id = @t", { l: lineId, p: pickListId, t: tenantId });
    if (!line) throw new HttpError(404, "not_found", `pick line '${lineId}' not found`);
    const picked = Math.min(Number(line.quantity), qty ?? Number(line.quantity));
    await this.db.query(
      "UPDATE pick_list_lines SET picked_qty = @q, status = @s WHERE id = @l AND tenant_id = @t",
      { q: picked, s: picked >= Number(line.quantity) ? "picked" : "pending", l: lineId, t: tenantId },
    );
    const remaining = await this.db.one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM pick_list_lines WHERE pick_list_id = @p AND tenant_id = @t AND status <> 'picked'",
      { p: pickListId, t: tenantId },
    );
    if (Number(remaining?.n ?? 0) === 0) {
      await this.db.query("UPDATE pick_lists SET status = 'picked', updated_at = @now WHERE id = @p AND tenant_id = @t", { now: Date.now(), p: pickListId, t: tenantId });
    }
    return this.getPickList(pickListId, tenantId);
  }

  /** Pack a fully-picked list → ready to hand off / ship. */
  async pack(pickListId: string, tenantId: string): Promise<PickList & { lines: PickListLine[] }> {
    const pl = await this.getPickList(pickListId, tenantId);
    if (pl.lines.some((l) => l.status !== "picked")) throw new HttpError(409, "not_picked", "all lines must be picked before packing");
    await this.db.query("UPDATE pick_lists SET status = 'packed', updated_at = @now WHERE id = @id AND tenant_id = @t", { now: Date.now(), id: pickListId, t: tenantId });
    return { ...pl, status: "packed" };
  }
}
