import type { Router, Response } from "express";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { QuotesService } from "./service.js";
import { createQuoteSchema, updateStatusSchema } from "./quotes.dto.js";

function tenantId(res: Response) { return (res.locals["auth"] as AuthPayload).tenantId; }
function userId(res: Response) { return (res.locals["auth"] as AuthPayload).userId; }

export function registerRoutes(router: Router, service: QuotesService) {
  router.get("/", handler(async (req, res) => {
    const limit = typeof req.query.limit === "string" ? Math.min(100, parseInt(req.query.limit) || 50) : 50;
    const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset) || 0 : 0;
    res.json(await service.list(tenantId(res), limit, offset));
  }));

  router.post("/", handler(async (req, res) => {
    const body = parseBody(createQuoteSchema, req.body);
    const quote = await service.create({ ...body, createdBy: userId(res) }, tenantId(res));
    res.status(201).json(quote);
  }));

  router.get("/:id", handler(async (req, res) => {
    res.json(await service.get(String(req.params.id), tenantId(res)));
  }));

  router.patch("/:id/status", handler(async (req, res) => {
    const body = parseBody(updateStatusSchema, req.body);
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
