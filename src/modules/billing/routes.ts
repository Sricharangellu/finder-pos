import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { BillingService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const billSchema = z.object({
  supplierId: z.string().min(1).optional(),
  poId: z.string().min(1).optional(),
  totalCents: z.number().int().positive().optional(),
  dueDate: z.number().int().positive().optional(),
});
const invoiceSchema = z.object({
  customerId: z.string().min(1),
  orderId: z.string().min(1).optional(),
  totalCents: z.number().int().positive().optional(),
  dueDate: z.number().int().positive().optional(),
});
const paySchema = z.object({ amountCents: z.number().int().positive(), method: z.string().min(1).optional() });

export function registerRoutes(router: Router, service: BillingService): void {
  // Bills (AP)
  router.post("/bills", handler(async (req, res) => {
    res.status(201).json(await service.createBill(parseBody(billSchema, req.body), tenantId(res)));
  }));
  router.get("/bills", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ items: await service.listBills(tenantId(res), status) });
  }));
  router.post("/bills/:id/pay", handler(async (req, res) => {
    const b = parseBody(paySchema, req.body);
    res.json(await service.payBill(String(req.params.id), b.amountCents, b.method ?? "transfer", tenantId(res)));
  }));

  // Invoices (AR)
  router.post("/invoices", handler(async (req, res) => {
    res.status(201).json(await service.createInvoice(parseBody(invoiceSchema, req.body), tenantId(res)));
  }));
  router.get("/invoices", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ items: await service.listInvoices(tenantId(res), status) });
  }));
  router.post("/invoices/:id/pay", handler(async (req, res) => {
    const b = parseBody(paySchema, req.body);
    res.json(await service.payInvoice(String(req.params.id), b.amountCents, b.method ?? "transfer", tenantId(res)));
  }));
}
