import type { PosModule, ModuleContext } from "../types.js";
import { v7 as uuidv7 } from "uuid";
import { handler, parseBody, notFound } from "../../shared/http.js";
import { requireRole, requireModule } from "../../gateway/auth.js";
import { z } from "zod";
import type { Response } from "express";
import type { AuthPayload } from "../../gateway/auth.js";

// ── BE-E1: Entertainment — Events + Tickets ────────────────────────────────

const CREATE_EVENTS = `
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  venue       TEXT,
  starts_at   BIGINT NOT NULL,
  ends_at     BIGINT NOT NULL,
  capacity    INTEGER NOT NULL DEFAULT 100,
  sold        INTEGER NOT NULL DEFAULT 0,
  price_cents BIGINT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'on_sale',
  description TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_tenant_date_idx ON events (tenant_id, starts_at ASC);
CREATE INDEX IF NOT EXISTS events_tenant_status_idx ON events (tenant_id, status);
`;

const CREATE_EVENT_TICKETS = `
CREATE TABLE IF NOT EXISTS event_tickets (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  customer_id TEXT,
  qr_code     TEXT NOT NULL UNIQUE,
  redeemed_at BIGINT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS tickets_event_idx ON event_tickets (tenant_id, event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_qr_idx ON event_tickets (qr_code);
`;

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const eventSchema = z.object({
  name:        z.string().min(1).max(150),
  venue:       z.string().max(150).optional(),
  startsAt:    z.number().int().positive(),
  endsAt:      z.number().int().positive(),
  capacity:    z.number().int().positive().default(100),
  priceCents:  z.number().int().nonnegative().default(0),
  description: z.string().max(1000).optional(),
});

const sellSchema = z.object({
  customerId: z.string().min(1).optional(),
  quantity:   z.number().int().positive().default(1),
});

export const entertainmentModule: PosModule = {
  name: "entertainment",
  migrations: [CREATE_EVENTS, CREATE_EVENT_TICKETS],
  register({ db, router }: ModuleContext) {
    router.use(requireModule("tickets"));

    // ── Events ────────────────────────────────────────────────────────────────

    router.get("/events", handler(async (req, res) => {
      const t      = tid(res);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const where  = status ? "WHERE tenant_id = @t AND status = @s" : "WHERE tenant_id = @t";
      const params: Record<string, unknown> = { t };
      if (status) params.s = status;
      res.json({ items: await db.query(
        `SELECT *, (capacity - sold) AS available FROM events ${where} ORDER BY starts_at ASC LIMIT 200`,
        params,
      )});
    }));

    router.post("/events", requireRole("manager"), handler(async (req, res) => {
      const body = parseBody(eventSchema, req.body);
      const t    = tid(res);
      const now  = Date.now();
      const id   = `evt_${uuidv7()}`;
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO events
             (id, tenant_id, name, venue, starts_at, ends_at, capacity, sold, price_cents, status, description, created_at, updated_at)
           VALUES (@id,@t,@name,@venue,@start,@end,@cap,0,@price,'on_sale',@desc,@now,@now)`,
          { id, t, name: body.name, venue: body.venue ?? null,
            start: body.startsAt, end: body.endsAt, cap: body.capacity,
            price: body.priceCents, desc: body.description ?? null, now },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM events WHERE id = @id", { id }));
    }));

    // ── Tickets ───────────────────────────────────────────────────────────────

    router.get("/events/:id/tickets", handler(async (req, res) => {
      const id = String(req.params["id"]);
      const t  = tid(res);
      res.json({ items: await db.query(
        "SELECT * FROM event_tickets WHERE event_id = @id AND tenant_id = @t ORDER BY created_at DESC LIMIT 500",
        { id, t },
      )});
    }));

    // Sell tickets — atomic: check capacity, increment sold, insert tickets
    router.post("/events/:id/sell", handler(async (req, res) => {
      const eventId = String(req.params["id"]);
      const t       = tid(res);
      const body    = parseBody(sellSchema, req.body);
      const quantity = body.quantity ?? 1;
      const now     = Date.now();
      const tickets: Record<string, unknown>[] = [];

      const event = await db.one<{ capacity: number; sold: number; status: string }>(
        "SELECT * FROM events WHERE id = @id AND tenant_id = @t",
        { id: eventId, t },
      );
      if (!event) throw notFound(`event '${eventId}'`);
      if (event.status !== "on_sale") {
        res.status(409).json({ error: { code: "event_not_on_sale" } });
        return;
      }
      if (event.sold + quantity > event.capacity) {
        res.status(409).json({ error: { code: "insufficient_capacity" } });
        return;
      }

      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          "UPDATE events SET sold = sold + @qty, updated_at = @now WHERE id = @id AND tenant_id = @t",
          { qty: quantity, now, id: eventId, t },
        );
        for (let i = 0; i < quantity; i++) {
          const ticketId = `tkt_${uuidv7()}`;
          const qrCode   = `${eventId}_${ticketId}`;
          await tdb.query(
            `INSERT INTO event_tickets (id, tenant_id, event_id, customer_id, qr_code, created_at)
             VALUES (@id,@t,@eventId,@custId,@qr,@now)`,
            { id: ticketId, t, eventId, custId: body.customerId ?? null, qr: qrCode, now },
          );
          tickets.push({ id: ticketId, qr_code: qrCode });
        }
      });
      res.status(201).json({ tickets });
    }));

    // Redeem a ticket by QR code
    router.post("/tickets/redeem", handler(async (req, res) => {
      const qrCode = z.string().min(1).parse((req.body as Record<string, unknown>).qrCode);
      const t      = tid(res);
      const ticket = await db.one<{ id: string; redeemed_at: number | null }>(
        "SELECT * FROM event_tickets WHERE qr_code = @qr AND tenant_id = @t",
        { qr: qrCode, t },
      );
      if (!ticket) throw notFound(`ticket '${qrCode}'`);
      if (ticket.redeemed_at) {
        res.status(409).json({ error: { code: "already_redeemed" } });
        return;
      }
      await db.query(
        "UPDATE event_tickets SET redeemed_at = @now WHERE id = @id AND tenant_id = @t",
        { now: Date.now(), id: ticket.id, t },
      );
      res.json(await db.one("SELECT * FROM event_tickets WHERE id = @id", { id: ticket.id }));
    }));
  },
};
