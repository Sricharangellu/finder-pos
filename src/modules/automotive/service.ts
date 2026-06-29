import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound } from "../../shared/http.js";

export type WorkOrderStatus = "open" | "in_progress" | "ready" | "closed" | "cancelled";

export interface Vehicle {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  vin: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  license_plate: string | null;
  mileage: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface WorkOrder {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  customer_id: string | null;
  technician_id: string | null;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  estimate_cents: number;
  actual_cents: number;
  labour_cents: number;
  mileage_in: number;
  mileage_out: number;
  created_at: number;
  updated_at: number;
}

export type AutomotiveService = ReturnType<typeof automotiveService>;

export function automotiveService(db: DB, events: EventBus) {
  return {
    async listVehicles(tenantId: string, customerId?: string): Promise<Vehicle[]> {
      const where = customerId
        ? "WHERE tenant_id = @t AND customer_id = @customerId ORDER BY created_at DESC"
        : "WHERE tenant_id = @t ORDER BY created_at DESC";
      return db.query<Vehicle>(
        `SELECT * FROM vehicles ${where} LIMIT 200`,
        customerId ? { t: tenantId, customerId } : { t: tenantId },
      );
    },

    async createVehicle(tenantId: string, input: {
      customerId?: string;
      vin?: string;
      make?: string;
      model?: string;
      year?: number;
      color?: string;
      licensePlate?: string;
      mileage?: number;
      notes?: string;
    }): Promise<Vehicle> {
      const now = Date.now();
      const row: Vehicle = {
        id: `veh_${uuidv7()}`,
        tenant_id: tenantId,
        customer_id: input.customerId ?? null,
        vin: input.vin ?? "",
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
        color: input.color ?? null,
        license_plate: input.licensePlate ?? null,
        mileage: input.mileage ?? 0,
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      };
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO vehicles (id, tenant_id, customer_id, vin, make, model, year, color, license_plate, mileage, notes, created_at, updated_at)
           VALUES (@id, @tenant_id, @customer_id, @vin, @make, @model, @year, @color, @license_plate, @mileage, @notes, @created_at, @updated_at)`,
          row as unknown as Record<string, unknown>,
        );
      });
      return row;
    },

    async updateVehicle(tenantId: string, id: string, input: Partial<{
      customerId: string;
      vin: string;
      make: string;
      model: string;
      year: number;
      color: string;
      licensePlate: string;
      mileage: number;
      notes: string;
    }>): Promise<Vehicle> {
      const existing = await db.one<Vehicle>(
        "SELECT * FROM vehicles WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!existing) throw notFound(`vehicle '${id}'`);
      const now = Date.now();
      const updated: Vehicle = {
        ...existing,
        customer_id: input.customerId !== undefined ? input.customerId : existing.customer_id,
        vin: input.vin !== undefined ? input.vin : existing.vin,
        make: input.make !== undefined ? input.make : existing.make,
        model: input.model !== undefined ? input.model : existing.model,
        year: input.year !== undefined ? input.year : existing.year,
        color: input.color !== undefined ? input.color : existing.color,
        license_plate: input.licensePlate !== undefined ? input.licensePlate : existing.license_plate,
        mileage: input.mileage !== undefined ? input.mileage : existing.mileage,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        updated_at: now,
      };
      await db.query(
        `UPDATE vehicles SET customer_id=@customer_id, vin=@vin, make=@make, model=@model, year=@year,
         color=@color, license_plate=@license_plate, mileage=@mileage, notes=@notes, updated_at=@updated_at
         WHERE id=@id AND tenant_id=@tenant_id`,
        { ...updated, id, tenant_id: tenantId } as unknown as Record<string, unknown>,
      );
      return updated;
    },

    async listWorkOrders(tenantId: string, opts: {
      vehicleId?: string;
      status?: WorkOrderStatus;
    } = {}): Promise<WorkOrder[]> {
      const where: string[] = ["tenant_id = @t"];
      const params: Record<string, unknown> = { t: tenantId };
      if (opts.vehicleId) { where.push("vehicle_id = @vehicleId"); params["vehicleId"] = opts.vehicleId; }
      if (opts.status) { where.push("status = @status"); params["status"] = opts.status; }
      return db.query<WorkOrder>(
        `SELECT * FROM work_orders WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 200`,
        params,
      );
    },

    async createWorkOrder(tenantId: string, input: {
      vehicleId?: string;
      customerId?: string;
      technicianId?: string;
      title: string;
      description?: string;
      estimateCents?: number;
      mileageIn?: number;
    }): Promise<WorkOrder> {
      const now = Date.now();
      const row: WorkOrder = {
        id: `wo_${uuidv7()}`,
        tenant_id: tenantId,
        vehicle_id: input.vehicleId ?? null,
        customer_id: input.customerId ?? null,
        technician_id: input.technicianId ?? null,
        title: input.title,
        description: input.description ?? null,
        status: "open",
        estimate_cents: input.estimateCents ?? 0,
        actual_cents: 0,
        labour_cents: 0,
        mileage_in: input.mileageIn ?? 0,
        mileage_out: 0,
        created_at: now,
        updated_at: now,
      };
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO work_orders (id, tenant_id, vehicle_id, customer_id, technician_id, title, description, status, estimate_cents, actual_cents, labour_cents, mileage_in, mileage_out, created_at, updated_at)
           VALUES (@id, @tenant_id, @vehicle_id, @customer_id, @technician_id, @title, @description, @status, @estimate_cents, @actual_cents, @labour_cents, @mileage_in, @mileage_out, @created_at, @updated_at)`,
          row as unknown as Record<string, unknown>,
        );
      });
      void events.publish("automotive.work_order_created", { tenantId, workOrderId: row.id }, row.id);
      return row;
    },

    async updateWorkOrder(tenantId: string, id: string, input: Partial<{
      technicianId: string;
      title: string;
      description: string;
      status: WorkOrderStatus;
      estimateCents: number;
      actualCents: number;
      labourCents: number;
      mileageIn: number;
      mileageOut: number;
    }>): Promise<WorkOrder> {
      const existing = await db.one<WorkOrder>(
        "SELECT * FROM work_orders WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!existing) throw notFound(`work_order '${id}'`);
      const now = Date.now();
      const updated: WorkOrder = {
        ...existing,
        technician_id: input.technicianId !== undefined ? input.technicianId : existing.technician_id,
        title: input.title !== undefined ? input.title : existing.title,
        description: input.description !== undefined ? input.description : existing.description,
        status: input.status !== undefined ? input.status : existing.status,
        estimate_cents: input.estimateCents !== undefined ? input.estimateCents : existing.estimate_cents,
        actual_cents: input.actualCents !== undefined ? input.actualCents : existing.actual_cents,
        labour_cents: input.labourCents !== undefined ? input.labourCents : existing.labour_cents,
        mileage_in: input.mileageIn !== undefined ? input.mileageIn : existing.mileage_in,
        mileage_out: input.mileageOut !== undefined ? input.mileageOut : existing.mileage_out,
        updated_at: now,
      };
      await db.query(
        `UPDATE work_orders SET technician_id=@technician_id, title=@title, description=@description,
         status=@status, estimate_cents=@estimate_cents, actual_cents=@actual_cents, labour_cents=@labour_cents,
         mileage_in=@mileage_in, mileage_out=@mileage_out, updated_at=@updated_at
         WHERE id=@id AND tenant_id=@tenant_id`,
        { ...updated, id, tenant_id: tenantId } as unknown as Record<string, unknown>,
      );
      void events.publish("automotive.work_order_updated", { tenantId, workOrderId: id, status: updated.status }, id);
      return updated;
    },
  };
}
