import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { ManufacturingService, ProductionStatus } from "./service.js";

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const mgr = requireRole("manager");

const bomLineSchema = z.object({
  rawMaterialId: z.string().min(1).optional(),
  rawMaterialName: z.string().max(200).optional(),
  qtyRequired: z.number().positive(),
  unit: z.string().max(20).optional(),
});

const createOrderSchema = z.object({
  productId: z.string().min(1).optional(),
  quantity: z.number().int().positive(),
  notes: z.string().max(500).optional(),
  bomLines: z.array(bomLineSchema).optional(),
});

export function registerRoutes(router: Router, svc: ManufacturingService): void {
  router.get("/manufacturing/orders", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status as ProductionStatus : undefined;
    const items = await svc.listOrders(tid(res), status);
    res.json({ items, total: items.length });
  }));

  router.post("/manufacturing/orders", mgr, handler(async (req, res) => {
    const body = parseBody(createOrderSchema, req.body);
    res.status(201).json(await svc.createOrder(tid(res), body));
  }));

  router.get("/manufacturing/orders/:id", handler(async (req, res) => {
    res.json(await svc.getOrder(tid(res), String(req.params["id"])));
  }));

  router.patch("/manufacturing/orders/:id", mgr, handler(async (req, res) => {
    const body = parseBody(z.object({
      notes: z.string().max(500).optional(),
      quantity: z.number().int().positive().optional(),
    }), req.body);
    res.json(await svc.updateOrder(tid(res), String(req.params["id"]), body));
  }));

  router.post("/manufacturing/orders/:id/start", mgr, handler(async (req, res) => {
    res.json(await svc.startOrder(tid(res), String(req.params["id"])));
  }));

  router.post("/manufacturing/orders/:id/complete", mgr, handler(async (req, res) => {
    const body = parseBody(z.object({
      actualQtyConsumed: z.array(z.object({
        bomLineId: z.string().min(1),
        qtyConsumed: z.number().nonnegative(),
      })).optional(),
    }), req.body);
    res.json(await svc.completeOrder(tid(res), String(req.params["id"]), body));
  }));

  router.post("/manufacturing/orders/:id/cancel", mgr, handler(async (req, res) => {
    res.json(await svc.cancelOrder(tid(res), String(req.params["id"])));
  }));
}
