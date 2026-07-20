import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound } from "../../shared/http.js";

export interface StoreLocation {
  id: string;
  tenant_id: string;
  outlet_id: string | null;
  aisle: string;
  shelf: string;
  bin: string;
  label: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProductLocation {
  id: string;
  tenant_id: string;
  product_id: string;
  location_id: string;
  qty_at_location: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
  // Joined fields
  aisle?: string;
  shelf?: string;
  bin?: string;
  label?: string;
  product_name?: string;
  product_sku?: string;
  product_upc?: string | null;
}

export interface CreateLocationInput {
  outlet_id?: string | null;
  aisle: string;
  shelf?: string;
  bin?: string;
  description?: string | null;
}

export interface AssignProductInput {
  product_id: string;
  location_id: string;
  qty_at_location?: number;
  notes?: string | null;
}

export interface BulkAssignInput {
  assignments: Array<{ product_id: string; location_id: string; notes?: string | null }>;
}

function buildLabel(aisle: string, shelf: string, bin: string): string {
  let label = aisle.toUpperCase();
  if (shelf) label += `-${shelf}`;
  if (bin) label += `-${bin}`;
  return label;
}

export function storeLocationsService(db: DB, events: EventBus) {
  return {
    async listLocations(tenantId: string, outletId?: string): Promise<StoreLocation[]> {
      const rows = await db.query<StoreLocation>(
        `SELECT * FROM store_locations WHERE tenant_id = @tenantId
         ${outletId ? "AND outlet_id = @outletId" : ""}
         ORDER BY aisle, shelf, bin`,
        { tenantId, outletId: outletId ?? null }
      );
      return rows;
    },

    async getLocation(id: string, tenantId: string): Promise<StoreLocation> {
      const row = await db.one<StoreLocation>(
        `SELECT * FROM store_locations WHERE id = @id AND tenant_id = @tenantId`,
        { id, tenantId }
      );
      if (!row) throw notFound("store_location");
      return row;
    },

    async createLocation(input: CreateLocationInput, tenantId: string): Promise<StoreLocation> {
      const id = uuidv7();
      const now = Date.now();
      const shelf = input.shelf ?? "";
      const bin = input.bin ?? "";
      const label = buildLabel(input.aisle, shelf, bin);

      const [row] = await db.query<StoreLocation>(
        `INSERT INTO store_locations (id, tenant_id, outlet_id, aisle, shelf, bin, label, description, created_at, updated_at)
         VALUES (@id, @tenantId, @outletId, @aisle, @shelf, @bin, @label, @description, @now, @now)
         RETURNING *`,
        { id, tenantId, outletId: input.outlet_id ?? null, aisle: input.aisle, shelf, bin, label, description: input.description ?? null, now }
      );
      events.publish("store_location.created", { tenantId, locationId: id });
      return row;
    },

    async updateLocation(id: string, input: Partial<CreateLocationInput>, tenantId: string): Promise<StoreLocation> {
      const existing = await this.getLocation(id, tenantId);
      const aisle = input.aisle ?? existing.aisle;
      const shelf = input.shelf ?? existing.shelf;
      const bin = input.bin ?? existing.bin;
      const label = buildLabel(aisle, shelf, bin);
      const now = Date.now();

      const [row] = await db.query<StoreLocation>(
        `UPDATE store_locations SET aisle=@aisle, shelf=@shelf, bin=@bin, label=@label,
         outlet_id=COALESCE(@outletId, outlet_id),
         description=COALESCE(@description, description), updated_at=@now
         WHERE id=@id AND tenant_id=@tenantId RETURNING *`,
        { id, tenantId, aisle, shelf, bin, label, outletId: input.outlet_id ?? null, description: input.description ?? null, now }
      );
      return row;
    },

    async deleteLocation(id: string, tenantId: string): Promise<void> {
      await this.getLocation(id, tenantId);
      await db.query(
        `DELETE FROM store_location_products WHERE location_id = @id AND tenant_id = @tenantId`,
        { id, tenantId }
      );
      await db.query(
        `DELETE FROM store_locations WHERE id = @id AND tenant_id = @tenantId`,
        { id, tenantId }
      );
    },

    async listProductLocations(tenantId: string, filters: { location_id?: string; product_id?: string }): Promise<ProductLocation[]> {
      return db.query<ProductLocation>(
        `SELECT pl.*, sl.aisle, sl.shelf, sl.bin, sl.label,
                p.name AS product_name, p.sku AS product_sku
         FROM store_location_products pl
         JOIN store_locations sl ON sl.id = pl.location_id AND sl.tenant_id = pl.tenant_id
         JOIN products p ON p.id = pl.product_id AND p.tenant_id = pl.tenant_id
         WHERE pl.tenant_id = @tenantId
         ${filters.location_id ? "AND pl.location_id = @locationId" : ""}
         ${filters.product_id ? "AND pl.product_id = @productId" : ""}
         ORDER BY sl.aisle, sl.shelf, sl.bin, p.name`,
        { tenantId, locationId: filters.location_id ?? null, productId: filters.product_id ?? null }
      );
    },

    async assignProduct(input: AssignProductInput, tenantId: string): Promise<ProductLocation> {
      const id = uuidv7();
      const now = Date.now();
      const [row] = await db.query<ProductLocation>(
        `INSERT INTO store_location_products (id, tenant_id, product_id, location_id, qty_at_location, notes, created_at, updated_at)
         VALUES (@id, @tenantId, @productId, @locationId, @qty, @notes, @now, @now)
         ON CONFLICT (tenant_id, product_id, location_id)
         DO UPDATE SET qty_at_location = @qty, notes = COALESCE(@notes, store_location_products.notes), updated_at = @now
         RETURNING *`,
        { id, tenantId, productId: input.product_id, locationId: input.location_id, qty: input.qty_at_location ?? 0, notes: input.notes ?? null, now }
      );
      events.publish("product_location.assigned", { tenantId, productId: input.product_id, locationId: input.location_id });
      return row;
    },

    async bulkAssign(input: BulkAssignInput, tenantId: string): Promise<{ assigned: number }> {
      let assigned = 0;
      for (const a of input.assignments) {
        await this.assignProduct(a, tenantId);
        assigned++;
      }
      return { assigned };
    },

    async removeProductLocation(productId: string, locationId: string, tenantId: string): Promise<void> {
      await db.query(
        `DELETE FROM store_location_products WHERE product_id=@productId AND location_id=@locationId AND tenant_id=@tenantId`,
        { productId, locationId, tenantId }
      );
    },

    async getStoreMap(tenantId: string, outletId?: string): Promise<{
      aisles: Array<{ name: string; shelves: Array<{ name: string; bins: Array<{ location: StoreLocation; products: ProductLocation[] }> }> }>;
    }> {
      const locations = await this.listLocations(tenantId, outletId);
      const assignments = await this.listProductLocations(tenantId, {});

      const assignmentsByLocation = new Map<string, ProductLocation[]>();
      for (const a of assignments) {
        const arr = assignmentsByLocation.get(a.location_id) ?? [];
        arr.push(a);
        assignmentsByLocation.set(a.location_id, arr);
      }

      const aisleMap = new Map<string, Map<string, StoreLocation[]>>();
      for (const loc of locations) {
        if (!aisleMap.has(loc.aisle)) aisleMap.set(loc.aisle, new Map());
        const shelfMap = aisleMap.get(loc.aisle)!;
        const shelfKey = loc.shelf || "(none)";
        const bins = shelfMap.get(shelfKey) ?? [];
        bins.push(loc);
        shelfMap.set(shelfKey, bins);
      }

      const aisles = [];
      for (const [aisle, shelfMap] of aisleMap) {
        const shelves = [];
        for (const [shelf, locs] of shelfMap) {
          const bins = locs.map((loc) => ({
            location: loc,
            products: assignmentsByLocation.get(loc.id) ?? [],
          }));
          shelves.push({ name: shelf, bins });
        }
        aisles.push({ name: aisle, shelves });
      }
      return { aisles };
    },
  };
}

export type StoreLocationsService = ReturnType<typeof storeLocationsService>;
