import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { SalesService, QuoteStatus, SOStatus } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCents: z.number().int().nonnegative().optional(),
});

const quoteSchema = z.object({
  customerId: z.string().min(1),
  lines: z.array(lineSchema).min(1),
  salesRepId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
  validUntil: z.number().int().positive().optional(),
});

const soSchema = z.object({
  customerId: z.string().min(1),
  lines: z.array(lineSchema).min(1),
  quotationId: z.string().min(1).optional(),
  salesRepId: z.string().min(1).optional(),
  pickerId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
});

const assignSchema = z.object({ pickerId: z.string().min(1) });

export function registerRoutes(router: Router, service: SalesService): void {
  // ── Quotations ─────────────────────────────────────────────────────────
  router.post("/quotations", handler(async (req, res) => {
    res.status(201).json(await service.createQuotation(parseBody(quoteSchema, req.body), tenantId(res)));
  }));
  router.get("/quotations", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? (req.query.status as QuoteStatus) : undefined;
    res.json({ items: await service.listQuotations(tenantId(res), status) });
  }));
  router.get("/quotations/:id", handler(async (req, res) => {
    res.json(await service.getQuotation(String(req.params.id), tenantId(res)));
  }));
  router.post("/quotations/:id/send", handler(async (req, res) => {
    res.json(await service.sendQuotation(String(req.params.id), tenantId(res)));
  }));
  router.post("/quotations/:id/accept", handler(async (req, res) => {
    res.json(await service.acceptQuotation(String(req.params.id), tenantId(res)));
  }));
  router.post("/quotations/:id/cancel", handler(async (req, res) => {
    res.json(await service.cancelQuotation(String(req.params.id), tenantId(res)));
  }));
  router.post("/quotations/:id/convert", handler(async (req, res) => {
    res.status(201).json(await service.convertQuotationToSO(String(req.params.id), tenantId(res)));
  }));

  // ── Sales orders ───────────────────────────────────────────────────────
  router.post("/sales-orders", handler(async (req, res) => {
    res.status(201).json(await service.createSalesOrder(parseBody(soSchema, req.body), tenantId(res)));
  }));
  router.get("/sales-orders", handler(async (req, res) => {
    res.json({
      items: await service.listSalesOrders(tenantId(res), {
        status: typeof req.query.status === "string" ? (req.query.status as SOStatus) : undefined,
        salesRepId: typeof req.query.salesRepId === "string" ? req.query.salesRepId : undefined,
        pickerId: typeof req.query.pickerId === "string" ? req.query.pickerId : undefined,
      }),
    });
  }));
  router.get("/sales-orders/:id", handler(async (req, res) => {
    res.json(await service.getSalesOrder(String(req.params.id), tenantId(res)));
  }));
  router.post("/sales-orders/:id/approve", handler(async (req, res) => {
    res.json(await service.approveSalesOrder(String(req.params.id), tenantId(res)));
  }));
  router.post("/sales-orders/:id/assign-picker", handler(async (req, res) => {
    const b = parseBody(assignSchema, req.body);
    res.json(await service.assignPicker(String(req.params.id), b.pickerId, tenantId(res)));
  }));
  router.post("/sales-orders/:id/invoice", handler(async (req, res) => {
    res.json(await service.convertToInvoice(String(req.params.id), tenantId(res)));
  }));
  router.post("/sales-orders/:id/cancel", handler(async (req, res) => {
    res.json(await service.cancelSalesOrder(String(req.params.id), tenantId(res)));
  }));
}
