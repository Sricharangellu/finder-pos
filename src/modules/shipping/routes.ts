import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { ShippingService, ShipStatus } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const createSchema = z.object({
  invoiceId: z.string().min(1),
  method: z.enum(["delivery", "pickup"]).optional(),
  expectedDate: z.number().int().positive().optional(),
  notes: z.string().optional(),
  lines: z.array(z.object({ productId: z.string().min(1), name: z.string().optional(), quantity: z.number().int().positive() })).optional(),
});
const fromSalesOrderSchema = z.object({
  salesOrderId: z.string().min(1),
  method: z.enum(["delivery", "pickup"]).optional(),
  expectedDate: z.number().int().positive().optional(),
  notes: z.string().optional(),
});
const shipSchema = z.object({
  carrier: z.string().min(1).optional(),
  trackingNumber: z.string().min(1).optional(),
  shippedDate: z.number().int().positive().optional(),
});

export function registerRoutes(router: Router, service: ShippingService): void {
  router.post("/", handler(async (req, res) => {
    res.status(201).json(await service.createFromInvoice(parseBody(createSchema, req.body), tenantId(res)));
  }));
  router.post("/from-sales-order", handler(async (req, res) => {
    const b = parseBody(fromSalesOrderSchema, req.body);
    res.status(201).json(await service.createFromSalesOrder(b.salesOrderId, { method: b.method, expectedDate: b.expectedDate, notes: b.notes }, tenantId(res)));
  }));
  router.get("/", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? (req.query.status as ShipStatus) : undefined;
    const salesOrderId = typeof req.query.salesOrderId === "string" ? req.query.salesOrderId : undefined;
    res.json({ items: await service.list(tenantId(res), { status, salesOrderId }) });
  }));
  router.get("/:id", handler(async (req, res) => {
    res.json(await service.get(String(req.params.id), tenantId(res)));
  }));
  router.post("/:id/lines/:lineId/pack", handler(async (req, res) => {
    res.json(await service.packLine(String(req.params.id), String(req.params.lineId), tenantId(res)));
  }));
  router.post("/:id/ship", handler(async (req, res) => {
    res.json(await service.markShipped(String(req.params.id), parseBody(shipSchema, req.body ?? {}), tenantId(res)));
  }));
  router.post("/:id/deliver", handler(async (req, res) => {
    res.json(await service.markDelivered(String(req.params.id), tenantId(res)));
  }));
  router.post("/:id/cancel", handler(async (req, res) => {
    res.json(await service.cancel(String(req.params.id), tenantId(res)));
  }));
}
