import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { QuotesService } from "./service.js";

function tenantId(res: Response) { return (res.locals["auth"] as AuthPayload).tenantId; }
function userId(res: Response) { return (res.locals["auth"] as AuthPayload).userId; }

const lineSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().optional(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative().optional(),
  taxCents: z.number().int().nonnegative().optional(),
});

const createSchema = z.object({
  customerId: z.string().nullable().optional(),
  outletId: z.string().nullable().optional(),
  lines: z.array(lineSchema).min(1),
  validUntil: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  currency: z.string().length(3).optional(),
});

export function registerRoutes(router: Router, service: QuotesService) {
  router.get("/", handler(async (req, res) => {
    const limit = typeof req.query.limit === "string" ? Math.min(100, parseInt(req.query.limit) || 50) : 50;
    const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset) || 0 : 0;
    res.json(await service.list(tenantId(res), limit, offset));
  }));

  router.post("/", handler(async (req, res) => {
    const body = parseBody(createSchema, req.body);
    const quote = await service.create({ ...body, createdBy: userId(res) }, tenantId(res));
    res.status(201).json(quote);
  }));

  router.get("/:id", handler(async (req, res) => {
    res.json(await service.get(String(req.params.id), tenantId(res)));
  }));

  router.patch("/:id/status", handler(async (req, res) => {
    const body = parseBody(z.object({ status: z.enum(["draft", "sent", "accepted", "rejected", "expired"]) }), req.body);
    res.json(await service.updateStatus(String(req.params.id), body.status, tenantId(res)));
  }));

  router.post("/:id/convert", handler(async (req, res) => {
    res.json(await service.convertToOrder(String(req.params.id), tenantId(res)));
  }));

  router.delete("/:id", handler(async (req, res) => {
    await service.delete(String(req.params.id), tenantId(res));
    res.status(204).end();
  }));
}
