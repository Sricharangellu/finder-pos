import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound, HttpError } from "../../shared/http.js";

export type EventStatus = "draft" | "active" | "cancelled" | "past";
export type TicketStatus = "valid" | "redeemed" | "cancelled";

export interface EntertainmentEvent {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  venue: string | null;
  starts_at: number;
  ends_at: number | null;
  capacity: number;
  price_cents: number;
  status: EventStatus;
  created_at: number;
  updated_at: number;
}

export interface EventTicket {
  id: string;
  tenant_id: string;
  event_id: string;
  customer_id: string | null;
  customer_name: string | null;
  qr_code: string;
  status: TicketStatus;
  price_cents: number;
  redeemed_at: number | null;
  created_at: number;
}

export type EntertainmentService = ReturnType<typeof entertainmentService>;

export function entertainmentService(db: DB, events: EventBus) {
  return {
    async listEvents(tenantId: string, status?: EventStatus): Promise<EntertainmentEvent[]> {
      const where = status
        ? "WHERE tenant_id = @t AND status = @status ORDER BY starts_at"
        : "WHERE tenant_id = @t ORDER BY starts_at";
      return db.query<EntertainmentEvent>(
        `SELECT * FROM events ${where} LIMIT 200`,
        status ? { t: tenantId, status } : { t: tenantId },
      );
    },

    async createEvent(tenantId: string, input: {
      name: string;
      description?: string;
      venue?: string;
      startsAt: number;
      endsAt?: number;
      capacity?: number;
      priceCents?: number;
    }): Promise<EntertainmentEvent> {
      const now = Date.now();
      const row: EntertainmentEvent = {
        id: `evt_${uuidv7()}`,
        tenant_id: tenantId,
        name: input.name,
        description: input.description ?? null,
        venue: input.venue ?? null,
        starts_at: input.startsAt,
        ends_at: input.endsAt ?? null,
        capacity: input.capacity ?? 0,
        price_cents: input.priceCents ?? 0,
        status: "active",
        created_at: now,
        updated_at: now,
      };
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO events (id, tenant_id, name, description, venue, starts_at, ends_at, capacity, price_cents, status, created_at, updated_at)
           VALUES (@id, @tenant_id, @name, @description, @venue, @starts_at, @ends_at, @capacity, @price_cents, @status, @created_at, @updated_at)`,
          row as unknown as Record<string, unknown>,
        );
      });
      return row;
    },

    async updateEvent(tenantId: string, id: string, input: Partial<{
      name: string;
      description: string;
      venue: string;
      startsAt: number;
      endsAt: number;
      capacity: number;
      priceCents: number;
      status: EventStatus;
    }>): Promise<EntertainmentEvent> {
      const existing = await db.one<EntertainmentEvent>(
        "SELECT * FROM events WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!existing) throw notFound(`event '${id}'`);
      const now = Date.now();
      const updated: EntertainmentEvent = {
        ...existing,
        name: input.name !== undefined ? input.name : existing.name,
        description: input.description !== undefined ? input.description : existing.description,
        venue: input.venue !== undefined ? input.venue : existing.venue,
        starts_at: input.startsAt !== undefined ? input.startsAt : existing.starts_at,
        ends_at: input.endsAt !== undefined ? input.endsAt : existing.ends_at,
        capacity: input.capacity !== undefined ? input.capacity : existing.capacity,
        price_cents: input.priceCents !== undefined ? input.priceCents : existing.price_cents,
        status: input.status !== undefined ? input.status : existing.status,
        updated_at: now,
      };
      await db.query(
        `UPDATE events SET name=@name, description=@description, venue=@venue, starts_at=@starts_at,
         ends_at=@ends_at, capacity=@capacity, price_cents=@price_cents, status=@status, updated_at=@updated_at
         WHERE id=@id AND tenant_id=@tenant_id`,
        { ...updated, id, tenant_id: tenantId } as unknown as Record<string, unknown>,
      );
      return updated;
    },

    async listTickets(tenantId: string, eventId?: string): Promise<EventTicket[]> {
      const where = eventId
        ? "WHERE tenant_id = @t AND event_id = @eventId ORDER BY created_at DESC"
        : "WHERE tenant_id = @t ORDER BY created_at DESC";
      return db.query<EventTicket>(
        `SELECT * FROM event_tickets ${where} LIMIT 500`,
        eventId ? { t: tenantId, eventId } : { t: tenantId },
      );
    },

    async sellTicket(tenantId: string, input: {
      eventId: string;
      customerId?: string;
      customerName?: string;
    }): Promise<EventTicket> {
      const event = await db.one<EntertainmentEvent>(
        "SELECT * FROM events WHERE id = @id AND tenant_id = @t",
        { id: input.eventId, t: tenantId },
      );
      if (!event) throw notFound(`event '${input.eventId}'`);
      if (event.status !== "active") {
        throw new HttpError(409, "event_not_active", `Event is not active (status: ${event.status}).`);
      }
      // Check capacity if set
      if (event.capacity > 0) {
        const countRows = await db.query<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM event_tickets WHERE tenant_id = @t AND event_id = @eventId AND status != 'cancelled'",
          { t: tenantId, eventId: input.eventId },
        );
        const sold = countRows[0]?.cnt ?? 0;
        if (sold >= event.capacity) {
          throw new HttpError(409, "event_sold_out", "Event is sold out.");
        }
      }
      const now = Date.now();
      const qrCode = `TKT-${uuidv7().slice(0, 8).toUpperCase()}`;
      const row: EventTicket = {
        id: `tkt_${uuidv7()}`,
        tenant_id: tenantId,
        event_id: input.eventId,
        customer_id: input.customerId ?? null,
        customer_name: input.customerName ?? null,
        qr_code: qrCode,
        status: "valid",
        price_cents: event.price_cents,
        redeemed_at: null,
        created_at: now,
      };
      await db.query(
        `INSERT INTO event_tickets (id, tenant_id, event_id, customer_id, customer_name, qr_code, status, price_cents, redeemed_at, created_at)
         VALUES (@id, @tenant_id, @event_id, @customer_id, @customer_name, @qr_code, @status, @price_cents, @redeemed_at, @created_at)`,
        row as unknown as Record<string, unknown>,
      );
      void events.publish("entertainment.ticket_sold", { tenantId, ticketId: row.id, eventId: input.eventId }, row.id);
      return row;
    },

    async redeemTicket(tenantId: string, qrCode: string): Promise<EventTicket> {
      const ticket = await db.one<EventTicket>(
        "SELECT * FROM event_tickets WHERE tenant_id = @t AND qr_code = @qrCode",
        { t: tenantId, qrCode },
      );
      if (!ticket) throw notFound(`ticket with QR code '${qrCode}'`);
      if (ticket.status !== "valid") {
        throw new HttpError(409, "ticket_not_valid", `Ticket is not valid (status: ${ticket.status}).`);
      }
      const now = Date.now();
      await db.query(
        "UPDATE event_tickets SET status = 'redeemed', redeemed_at = @now WHERE id = @id AND tenant_id = @t",
        { now, id: ticket.id, t: tenantId },
      );
      void events.publish("entertainment.ticket_redeemed", { tenantId, ticketId: ticket.id }, ticket.id);
      return { ...ticket, status: "redeemed", redeemed_at: now };
    },
  };
}
