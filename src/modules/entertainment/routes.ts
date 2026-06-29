import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { EntertainmentService, EventStatus } from "./service.js";

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const mgr = requireRole("manager");

const createEventSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  venue: z.string().max(200).optional(),
  startsAt: z.number().int().positive(),
  endsAt: z.number().int().positive().optional(),
  capacity: z.number().int().nonnegative().optional(),
  priceCents: z.number().int().nonnegative().optional(),
});

const sellTicketSchema = z.object({
  eventId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  customerName: z.string().max(100).optional(),
});

export function registerRoutes(router: Router, svc: EntertainmentService): void {
  router.get("/entertainment/events", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status as EventStatus : undefined;
    const items = await svc.listEvents(tid(res), status);
    res.json({ items, total: items.length });
  }));

  router.post("/entertainment/events", mgr, handler(async (req, res) => {
    const body = parseBody(createEventSchema, req.body);
    res.status(201).json(await svc.createEvent(tid(res), body));
  }));

  router.patch("/entertainment/events/:id", mgr, handler(async (req, res) => {
    const body = parseBody(createEventSchema.partial().extend({
      status: z.enum(["draft", "active", "cancelled", "past"]).optional(),
    }), req.body);
    res.json(await svc.updateEvent(tid(res), String(req.params["id"]), body));
  }));

  router.get("/entertainment/events/:id/tickets", handler(async (req, res) => {
    const items = await svc.listTickets(tid(res), String(req.params["id"]));
    res.json({ items, total: items.length });
  }));

  router.post("/entertainment/tickets", handler(async (req, res) => {
    const body = parseBody(sellTicketSchema, req.body);
    res.status(201).json(await svc.sellTicket(tid(res), body));
  }));

  router.post("/entertainment/tickets/:id/redeem", handler(async (req, res) => {
    const { qrCode } = parseBody(z.object({ qrCode: z.string().min(1) }), req.body);
    res.json(await svc.redeemTicket(tid(res), qrCode));
  }));
}
