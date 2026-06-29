import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { AutomotiveService, WorkOrderStatus } from "./service.js";

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const mgr = requireRole("manager");

const vehicleSchema = z.object({
  customerId: z.string().min(1).optional(),
  vin: z.string().max(50).optional(),
  make: z.string().max(50).optional(),
  model: z.string().max(50).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  color: z.string().max(30).optional(),
  licensePlate: z.string().max(20).optional(),
  mileage: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).optional(),
});

const createWorkOrderSchema = z.object({
  vehicleId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  technicianId: z.string().min(1).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  estimateCents: z.number().int().nonnegative().optional(),
  mileageIn: z.number().int().nonnegative().optional(),
});

const updateWorkOrderSchema = z.object({
  technicianId: z.string().min(1).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(["open", "in_progress", "ready", "closed", "cancelled"]).optional(),
  estimateCents: z.number().int().nonnegative().optional(),
  actualCents: z.number().int().nonnegative().optional(),
  labourCents: z.number().int().nonnegative().optional(),
  mileageIn: z.number().int().nonnegative().optional(),
  mileageOut: z.number().int().nonnegative().optional(),
});

export function registerRoutes(router: Router, svc: AutomotiveService): void {
  router.get("/automotive/vehicles", handler(async (req, res) => {
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : undefined;
    const items = await svc.listVehicles(tid(res), customerId);
    res.json({ items, total: items.length });
  }));

  router.post("/automotive/vehicles", mgr, handler(async (req, res) => {
    const body = parseBody(vehicleSchema, req.body);
    res.status(201).json(await svc.createVehicle(tid(res), body));
  }));

  router.get("/automotive/vehicles/:id", handler(async (req, res) => {
    const items = await svc.listVehicles(tid(res));
    const vehicle = items.find((v) => v.id === req.params["id"]);
    if (!vehicle) {
      const { notFound } = await import("../../shared/http.js");
      throw notFound(`vehicle '${req.params["id"]}'`);
    }
    res.json(vehicle);
  }));

  router.patch("/automotive/vehicles/:id", mgr, handler(async (req, res) => {
    const body = parseBody(vehicleSchema.partial(), req.body);
    res.json(await svc.updateVehicle(tid(res), String(req.params["id"]), body));
  }));

  router.get("/automotive/work-orders", handler(async (req, res) => {
    const vehicleId = typeof req.query.vehicleId === "string" ? req.query.vehicleId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status as WorkOrderStatus : undefined;
    const items = await svc.listWorkOrders(tid(res), { vehicleId, status });
    res.json({ items, total: items.length });
  }));

  router.post("/automotive/work-orders", mgr, handler(async (req, res) => {
    const body = parseBody(createWorkOrderSchema, req.body);
    res.status(201).json(await svc.createWorkOrder(tid(res), body));
  }));

  router.get("/automotive/work-orders/:id", handler(async (req, res) => {
    const items = await svc.listWorkOrders(tid(res));
    const wo = items.find((w) => w.id === req.params["id"]);
    if (!wo) {
      const { notFound } = await import("../../shared/http.js");
      throw notFound(`work_order '${req.params["id"]}'`);
    }
    res.json(wo);
  }));

  router.patch("/automotive/work-orders/:id", mgr, handler(async (req, res) => {
    const body = parseBody(updateWorkOrderSchema, req.body);
    res.json(await svc.updateWorkOrder(tid(res), String(req.params["id"]), body));
  }));
}
