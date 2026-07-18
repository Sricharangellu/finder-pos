import type { PosModule, ModuleContext } from "../types.js";
import { v7 as uuidv7 } from "uuid";
import { handler, parseBody, notFound } from "../../shared/http.js";
import { z } from "zod";
import type { Response } from "express";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireModule } from "../../gateway/auth.js";

// ── BE-A1: Automotive — Vehicles + Work Orders ─────────────────────────────

const CREATE_VEHICLES = `
CREATE TABLE IF NOT EXISTS vehicles (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  customer_id   TEXT,
  vin           TEXT,
  license_plate TEXT,
  make          TEXT NOT NULL,
  model         TEXT NOT NULL,
  year          INTEGER,
  color         TEXT,
  mileage       INTEGER,
  notes         TEXT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS vehicles_tenant_customer_idx ON vehicles (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicles_tenant_plate_idx ON vehicles (tenant_id, license_plate) WHERE license_plate IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicles_tenant_vin_idx ON vehicles (tenant_id, vin) WHERE vin IS NOT NULL;
`;

const CREATE_WORK_ORDERS = `
CREATE TABLE IF NOT EXISTS work_orders (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  vehicle_id      TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  technician_id   TEXT,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  labour_cents    BIGINT NOT NULL DEFAULT 0,
  parts_cents     BIGINT NOT NULL DEFAULT 0,
  total_cents     BIGINT NOT NULL DEFAULT 0,
  mileage_in      INTEGER,
  mileage_out     INTEGER,
  started_at      BIGINT,
  completed_at    BIGINT,
  notes           TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS wo_tenant_vehicle_idx ON work_orders (tenant_id, vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wo_tenant_status_idx ON work_orders (tenant_id, status, created_at DESC);
`;

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const vehicleSchema = z.object({
  make:         z.string().min(1).max(100),
  model:        z.string().min(1).max(100),
  year:         z.number().int().optional(),
  vin:          z.string().max(50).optional(),
  licensePlate: z.string().max(20).optional(),
  color:        z.string().max(30).optional(),
  mileage:      z.number().int().nonnegative().optional(),
  customerId:   z.string().min(1).optional(),
  notes:        z.string().max(500).optional(),
});

const workOrderSchema = z.object({
  vehicleId:    z.string().min(1),
  description:  z.string().min(1).max(500),
  technicianId: z.string().min(1).optional(),
  labourCents:  z.number().int().nonnegative().default(0),
  partsCents:   z.number().int().nonnegative().default(0),
  mileageIn:    z.number().int().nonnegative().optional(),
  notes:        z.string().max(1000).optional(),
});

export const automotiveModule: PosModule = {
  name: "automotive",
  migrations: [CREATE_VEHICLES, CREATE_WORK_ORDERS],
  register({ db, router }: ModuleContext) {
    router.use(requireModule("work_orders"));

    // ── Vehicles ─────────────────────────────────────────────────────────────

    router.get("/vehicles", handler(async (req, res) => {
      const t = tid(res);
      const q = typeof req.query.q === "string" ? req.query.q : undefined;
      const where = q
        ? "WHERE tenant_id = @t AND (license_plate ILIKE @q OR vin ILIKE @q OR make ILIKE @q OR model ILIKE @q)"
        : "WHERE tenant_id = @t";
      const params: Record<string, unknown> = { t };
      if (q) params.q = `%${q}%`;
      res.json({ items: await db.query(`SELECT * FROM vehicles ${where} ORDER BY created_at DESC LIMIT 200`, params) });
    }));

    router.get("/vehicles/:id", handler(async (req, res) => {
      const id = String(req.params["id"]);
      const vehicle = await db.one("SELECT * FROM vehicles WHERE id = @id AND tenant_id = @t", { id, t: tid(res) });
      if (!vehicle) { res.status(404).json({ error: { code: "not_found" } }); return; }
      const orders = await db.query(
        "SELECT * FROM work_orders WHERE vehicle_id = @id ORDER BY created_at DESC LIMIT 20",
        { id },
      );
      res.json({ ...vehicle, workOrders: orders });
    }));

    router.post("/vehicles", handler(async (req, res) => {
      const body = parseBody(vehicleSchema, req.body);
      const t    = tid(res);
      const now  = Date.now();
      const id   = `veh_${uuidv7()}`;
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO vehicles (id, tenant_id, customer_id, vin, license_plate, make, model, year, color, mileage, notes, created_at, updated_at)
           VALUES (@id,@t,@customerId,@vin,@plate,@make,@model,@year,@color,@mileage,@notes,@now,@now)`,
          { id, t, customerId: body.customerId ?? null, vin: body.vin ?? null,
            plate: body.licensePlate ?? null, make: body.make, model: body.model,
            year: body.year ?? null, color: body.color ?? null, mileage: body.mileage ?? null,
            notes: body.notes ?? null, now },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM vehicles WHERE id = @id", { id }));
    }));

    // ── Work Orders ───────────────────────────────────────────────────────────

    router.get("/work-orders", handler(async (req, res) => {
      const t      = tid(res);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const where  = status ? "WHERE tenant_id = @t AND status = @s" : "WHERE tenant_id = @t";
      const params: Record<string, unknown> = { t };
      if (status) params.s = status;
      res.json({ items: await db.query(
        `SELECT wo.*, v.make, v.model, v.license_plate
         FROM work_orders wo
         JOIN vehicles v ON v.id = wo.vehicle_id
         ${where} ORDER BY wo.created_at DESC LIMIT 200`,
        params,
      )});
    }));

    router.post("/work-orders", handler(async (req, res) => {
      const body = parseBody(workOrderSchema, req.body);
      const t    = tid(res);
      const now  = Date.now();
      const id   = `wo_${uuidv7()}`;
      const total = (body.labourCents ?? 0) + (body.partsCents ?? 0);
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO work_orders
             (id, tenant_id, vehicle_id, technician_id, description, status,
              labour_cents, parts_cents, total_cents, mileage_in, notes, created_at, updated_at)
           VALUES (@id,@t,@vehicleId,@techId,@desc,'open',@labour,@parts,@total,@mileIn,@notes,@now,@now)`,
          { id, t, vehicleId: body.vehicleId, techId: body.technicianId ?? null,
            desc: body.description, labour: body.labourCents, parts: body.partsCents,
            total, mileIn: body.mileageIn ?? null, notes: body.notes ?? null, now },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM work_orders WHERE id = @id", { id }));
    }));

    router.patch("/work-orders/:id", handler(async (req, res) => {
      const id = String(req.params["id"]);
      const t  = tid(res);
      const wo = await db.one("SELECT * FROM work_orders WHERE id = @id AND tenant_id = @t", { id, t });
      if (!wo) throw notFound(`work_order '${id}'`);
      const body = req.body as Record<string, unknown>;
      const status = typeof body.status === "string" ? body.status : undefined;
      const now = Date.now();
      const updates: Record<string, unknown> = { updated_at: now };
      if (status) {
        updates.status = status;
        if (status === "in_progress" && !((wo as { started_at?: number }).started_at)) updates.started_at = now;
        if (status === "completed") { updates.completed_at = now; }
      }
      if (typeof body.mileageOut === "number") updates.mileage_out = body.mileageOut;
      if (typeof body.labourCents === "number") {
        updates.labour_cents = body.labourCents;
        updates.total_cents = (body.labourCents as number) + Number((wo as { parts_cents: number }).parts_cents);
      }
      const setClause = Object.keys(updates).map(k => `${k} = @${k}`).join(", ");
      await db.query(
        `UPDATE work_orders SET ${setClause} WHERE id = @id AND tenant_id = @t`,
        { ...updates, id, t },
      );
      res.json(await db.one("SELECT * FROM work_orders WHERE id = @id", { id }));
    }));
  },
};
