import type { PosModule, ModuleContext } from "../types.js";
import { v7 as uuidv7 } from "uuid";
import { handler, parseBody, notFound } from "../../shared/http.js";
import { requireRole, requireModule } from "../../gateway/auth.js";
import { z } from "zod";
import type { Response } from "express";
import type { AuthPayload } from "../../gateway/auth.js";

// ── BE-H1: Hospitality — Rooms + Room Charges ──────────────────────────────

const CREATE_ROOMS = `
CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  outlet_id   TEXT,
  room_number TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'standard',
  floor       TEXT,
  rate_cents  BIGINT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'available',
  notes       TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS rooms_tenant_number_idx ON rooms (tenant_id, room_number);
CREATE INDEX IF NOT EXISTS rooms_tenant_status_idx ON rooms (tenant_id, status);
`;

const CREATE_ROOM_CHARGES = `
CREATE TABLE IF NOT EXISTS room_charges (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  order_id    TEXT,
  description TEXT NOT NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  posted_at   BIGINT NOT NULL,
  settled_at  BIGINT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS room_charges_room_idx ON room_charges (tenant_id, room_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS room_charges_unsettled_idx ON room_charges (tenant_id, settled_at) WHERE settled_at IS NULL;
`;

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const roomSchema = z.object({
  roomNumber: z.string().min(1).max(20),
  type:       z.enum(["standard", "deluxe", "suite", "penthouse", "dormitory"]).default("standard"),
  floor:      z.string().max(10).optional(),
  rateCents:  z.number().int().nonnegative().default(0),
  notes:      z.string().max(500).optional(),
  outletId:   z.string().min(1).optional(),
});

const chargeSchema = z.object({
  description: z.string().min(1).max(200),
  amountCents: z.number().int().positive(),
  orderId:     z.string().min(1).optional(),
});

export const hospitalityModule: PosModule = {
  name: "hospitality",
  migrations: [CREATE_ROOMS, CREATE_ROOM_CHARGES],
  register({ db, router }: ModuleContext) {
    router.use(requireModule("room_billing"));

    // ── Rooms ─────────────────────────────────────────────────────────────────

    router.get("/rooms", handler(async (req, res) => {
      const t      = tid(res);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const where  = status ? "WHERE tenant_id = @t AND status = @s" : "WHERE tenant_id = @t";
      const params: Record<string, unknown> = { t };
      if (status) params.s = status;
      res.json({ items: await db.query(
        `SELECT * FROM rooms ${where} ORDER BY room_number ASC`,
        params,
      )});
    }));

    router.post("/rooms", requireRole("manager"), handler(async (req, res) => {
      const body = parseBody(roomSchema, req.body);
      const t    = tid(res);
      const now  = Date.now();
      const id   = `room_${uuidv7()}`;
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO rooms (id, tenant_id, outlet_id, room_number, type, floor, rate_cents, status, notes, created_at, updated_at)
           VALUES (@id,@t,@outletId,@num,@type,@floor,@rate,'available',@notes,@now,@now)`,
          { id, t, outletId: body.outletId ?? null, num: body.roomNumber, type: body.type,
            floor: body.floor ?? null, rate: body.rateCents, notes: body.notes ?? null, now },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM rooms WHERE id = @id", { id }));
    }));

    router.patch("/rooms/:id/status", handler(async (req, res) => {
      const id     = String(req.params["id"]);
      const t      = tid(res);
      const status = z.enum(["available", "occupied", "checkout", "cleaning", "maintenance"]).parse(
        (req.body as Record<string, unknown>).status,
      );
      await db.query(
        "UPDATE rooms SET status = @s, updated_at = @now WHERE id = @id AND tenant_id = @t",
        { s: status, now: Date.now(), id, t },
      );
      res.json(await db.one("SELECT * FROM rooms WHERE id = @id", { id }));
    }));

    // ── Room Charges ─────────────────────────────────────────────────────────

    router.get("/rooms/:id/charges", handler(async (req, res) => {
      const id = String(req.params["id"]);
      const t  = tid(res);
      res.json({ items: await db.query(
        "SELECT * FROM room_charges WHERE room_id = @id AND tenant_id = @t ORDER BY posted_at DESC LIMIT 100",
        { id, t },
      )});
    }));

    router.post("/rooms/:id/charge", handler(async (req, res) => {
      const roomId = String(req.params["id"]);
      const t      = tid(res);
      const room   = await db.one("SELECT id FROM rooms WHERE id = @id AND tenant_id = @t", { id: roomId, t });
      if (!room) throw notFound(`room '${roomId}'`);
      const body = parseBody(chargeSchema, req.body);
      const id   = `rchg_${uuidv7()}`;
      const now  = Date.now();
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO room_charges (id, tenant_id, room_id, order_id, description, amount_cents, posted_at, created_at)
           VALUES (@id,@t,@roomId,@orderId,@desc,@amount,@now,@now)`,
          { id, t, roomId, orderId: body.orderId ?? null, desc: body.description,
            amount: body.amountCents, now },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM room_charges WHERE id = @id", { id }));
    }));

    // Settle all outstanding charges for a room
    router.post("/rooms/:id/settle", requireRole("manager"), handler(async (req, res) => {
      const id  = String(req.params["id"]);
      const t   = tid(res);
      const now = Date.now();
      const result = await db.query(
        "UPDATE room_charges SET settled_at = @now WHERE room_id = @id AND tenant_id = @t AND settled_at IS NULL",
        { now, id, t },
      );
      res.json({ settled: Array.isArray(result) ? result.length : 0 });
    }));
  },
};
