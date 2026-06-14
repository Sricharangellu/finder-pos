import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { FulfillmentService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const locationSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1).optional(),
  kind: z.enum(["zone", "aisle", "shelf", "bin"]).optional(),
});
const assignSchema = z.object({ productId: z.string().min(1), locationId: z.string().min(1) });
const pickListSchema = z.object({ orderId: z.string().min(1) });
const pickSchema = z.object({ quantity: z.number().int().positive().optional() });

export function registerRoutes(router: Router, service: FulfillmentService): void {
  router.post("/locations", handler(async (req, res) => {
    const b = parseBody(locationSchema, req.body);
    res.status(201).json(await service.createLocation(b.code, b.name, b.kind ?? "bin", tenantId(res)));
  }));
  router.get("/locations", handler(async (_req, res) => {
    res.json({ items: await service.listLocations(tenantId(res)) });
  }));
  router.post("/assign", handler(async (req, res) => {
    const b = parseBody(assignSchema, req.body);
    await service.assign(b.productId, b.locationId, tenantId(res));
    res.status(200).json({ ok: true });
  }));

  router.post("/pick-lists", handler(async (req, res) => {
    const b = parseBody(pickListSchema, req.body);
    res.status(201).json(await service.createPickList(b.orderId, tenantId(res)));
  }));
  router.get("/pick-lists", handler(async (_req, res) => {
    res.json({ items: await service.listPickLists(tenantId(res)) });
  }));
  router.get("/pick-lists/:id", handler(async (req, res) => {
    res.json(await service.getPickList(String(req.params.id), tenantId(res)));
  }));
  router.post("/pick-lists/:id/lines/:lineId/pick", handler(async (req, res) => {
    const b = parseBody(pickSchema, req.body ?? {});
    res.json(await service.pickLine(String(req.params.id), String(req.params.lineId), b.quantity, tenantId(res)));
  }));
  router.post("/pick-lists/:id/pack", handler(async (req, res) => {
    res.json(await service.pack(String(req.params.id), tenantId(res)));
  }));
}
