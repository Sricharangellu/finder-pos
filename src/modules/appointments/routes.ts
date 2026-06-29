import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { AppointmentsService, AppointmentStatus } from "./service.js";

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const mgr = requireRole("manager");

const serviceSchema = z.object({
  name: z.string().min(1).max(100),
  durationMins: z.number().int().positive().optional(),
  priceCents: z.number().int().nonnegative().optional(),
  category: z.string().max(50).optional(),
});

const appointmentSchema = z.object({
  customerId: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  startsAt: z.number().int().positive(),
  endsAt: z.number().int().positive(),
  notes: z.string().max(500).optional(),
});

export function registerRoutes(router: Router, svc: AppointmentsService): void {
  // Services catalog
  router.get("/appointments/services", handler(async (_req, res) => {
    const items = await svc.listServices(tid(res));
    res.json({ items, total: items.length });
  }));

  router.post("/appointments/services", mgr, handler(async (req, res) => {
    const body = parseBody(serviceSchema, req.body);
    res.status(201).json(await svc.createService(tid(res), body));
  }));

  router.patch("/appointments/services/:id", mgr, handler(async (req, res) => {
    const body = parseBody(serviceSchema.partial().extend({
      active: z.number().int().min(0).max(1).optional(),
    }), req.body);
    res.json(await svc.updateService(tid(res), String(req.params["id"]), body));
  }));

  // Appointments
  router.get("/appointments", handler(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : undefined;
    const items = await svc.listAppointments(tid(res), { date, employeeId, customerId });
    res.json({ items, total: items.length });
  }));

  router.post("/appointments", handler(async (req, res) => {
    const body = parseBody(appointmentSchema, req.body);
    res.status(201).json(await svc.createAppointment(tid(res), body));
  }));

  router.get("/appointments/:id", handler(async (req, res) => {
    res.json(await svc.getAppointment(tid(res), String(req.params["id"])));
  }));

  router.patch("/appointments/:id/status", handler(async (req, res) => {
    const { status } = parseBody(z.object({
      status: z.enum(["scheduled", "confirmed", "in_progress", "completed", "cancelled", "no_show"]),
    }), req.body);
    res.json(await svc.updateStatus(tid(res), String(req.params["id"]), status as AppointmentStatus));
  }));
}
