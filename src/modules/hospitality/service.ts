import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound } from "../../shared/http.js";

export type RoomStatus = "available" | "occupied" | "maintenance" | "checkout";

export interface Room {
  id: string;
  tenant_id: string;
  outlet_id: string | null;
  room_number: string;
  type: string | null;
  floor: string | null;
  rate_cents: number;
  status: RoomStatus;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface RoomCharge {
  id: string;
  tenant_id: string;
  room_id: string;
  description: string;
  amount_cents: number;
  order_id: string | null;
  posted_at: number;
  created_at: number;
}

export interface RoomFolio {
  room: Room;
  charges: RoomCharge[];
  total_cents: number;
}

export type HospitalityService = ReturnType<typeof hospitalityService>;

export function hospitalityService(db: DB, events: EventBus) {
  return {
    async listRooms(tenantId: string, outletId?: string): Promise<Room[]> {
      const where = outletId
        ? "WHERE tenant_id = @t AND outlet_id = @outletId ORDER BY room_number"
        : "WHERE tenant_id = @t ORDER BY room_number";
      return db.query<Room>(
        `SELECT * FROM rooms ${where}`,
        outletId ? { t: tenantId, outletId } : { t: tenantId },
      );
    },

    async createRoom(tenantId: string, input: {
      roomNumber: string;
      outletId?: string;
      type?: string;
      floor?: string;
      rateCents?: number;
      notes?: string;
    }): Promise<Room> {
      const now = Date.now();
      const row: Room = {
        id: `rm_${uuidv7()}`,
        tenant_id: tenantId,
        outlet_id: input.outletId ?? null,
        room_number: input.roomNumber,
        type: input.type ?? null,
        floor: input.floor ?? null,
        rate_cents: input.rateCents ?? 0,
        status: "available",
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      };
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO rooms (id, tenant_id, outlet_id, room_number, type, floor, rate_cents, status, notes, created_at, updated_at)
           VALUES (@id, @tenant_id, @outlet_id, @room_number, @type, @floor, @rate_cents, @status, @notes, @created_at, @updated_at)`,
          row as unknown as Record<string, unknown>,
        );
      });
      void events.publish("hospitality.room_created", { tenantId, roomId: row.id }, row.id);
      return row;
    },

    async setRoomStatus(tenantId: string, roomId: string, status: RoomStatus): Promise<Room> {
      const room = await db.one<Room>(
        "SELECT * FROM rooms WHERE id = @id AND tenant_id = @t",
        { id: roomId, t: tenantId },
      );
      if (!room) throw notFound(`room '${roomId}'`);
      const now = Date.now();
      await db.query(
        "UPDATE rooms SET status = @status, updated_at = @now WHERE id = @id AND tenant_id = @t",
        { status, now, id: roomId, t: tenantId },
      );
      void events.publish("hospitality.room_status_changed", { tenantId, roomId, status }, roomId);
      return { ...room, status, updated_at: now };
    },

    async postCharge(tenantId: string, roomId: string, input: {
      description: string;
      amountCents: number;
      orderId?: string;
    }): Promise<RoomCharge> {
      const room = await db.one<{ id: string }>(
        "SELECT id FROM rooms WHERE id = @id AND tenant_id = @t",
        { id: roomId, t: tenantId },
      );
      if (!room) throw notFound(`room '${roomId}'`);
      const now = Date.now();
      const row: RoomCharge = {
        id: `rc_${uuidv7()}`,
        tenant_id: tenantId,
        room_id: roomId,
        description: input.description,
        amount_cents: input.amountCents,
        order_id: input.orderId ?? null,
        posted_at: now,
        created_at: now,
      };
      await db.query(
        `INSERT INTO room_charges (id, tenant_id, room_id, description, amount_cents, order_id, posted_at, created_at)
         VALUES (@id, @tenant_id, @room_id, @description, @amount_cents, @order_id, @posted_at, @created_at)`,
        row as unknown as Record<string, unknown>,
      );
      void events.publish("hospitality.charge_posted", { tenantId, roomId, amountCents: input.amountCents }, row.id);
      return row;
    },

    async getRoomFolio(tenantId: string, roomId: string): Promise<RoomFolio> {
      const room = await db.one<Room>(
        "SELECT * FROM rooms WHERE id = @id AND tenant_id = @t",
        { id: roomId, t: tenantId },
      );
      if (!room) throw notFound(`room '${roomId}'`);
      const charges = await db.query<RoomCharge>(
        "SELECT * FROM room_charges WHERE tenant_id = @t AND room_id = @roomId ORDER BY posted_at DESC",
        { t: tenantId, roomId },
      );
      const total_cents = charges.reduce((s, c) => s + c.amount_cents, 0);
      return { room, charges, total_cents };
    },
  };
}
