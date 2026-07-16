import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { BillingService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const billSchema = z.object({
  supplierId: z.string().min(1).optional(),
  poId: z.string().min(1).optional(),
  totalCents: z.number().int().positive().optional(),
  dueDate: z.number().int().positive().optional(),
  // BE-30: early payment discount terms.
  discountPct: z.number().min(0).max(100).optional(),
  discountDate: z.number().int().positive().optional(),
});
const invoiceSchema = z.object({
  customerId: z.string().min(1),
  orderId: z.string().min(1).optional(),
  totalCents: z.number().int().positive().optional(),
  dueDate: z.number().int().positive().optional(),
});
// Accept both `method` (API convention) and `mode` (frontend convention) as the same field.
const paySchema = z.object({
  amountCents: z.number().int().positive(),
  method: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
});

export function registerRoutes(router: Router, service: BillingService): void {
  const mgr = requireRole("manager");
  // Bills (AP)
  router.post("/bills", handler(async (req, res) => {
    res.status(201).json(await service.createBill(parseBody(billSchema, req.body), tenantId(res)));
  }));
  router.get("/bills", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const supplierId = typeof req.query.supplierId === "string" ? req.query.supplierId : undefined;
    res.json({ items: await service.listBills(tenantId(res), { status, supplierId }) });
  }));
  router.post("/bills/:id/pay", mgr, handler(async (req, res) => {
    const b = parseBody(paySchema, req.body);
    res.json(await service.payBill(String(req.params.id), b.amountCents, b.method ?? b.mode ?? "transfer", tenantId(res)));
  }));

  // Invoices (AR)
  router.post("/invoices", handler(async (req, res) => {
    res.status(201).json(await service.createInvoice(parseBody(invoiceSchema, req.body), tenantId(res)));
  }));
  router.get("/invoices", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || undefined : undefined;
    res.json(await service.listInvoices(tenantId(res), { status, cursor, limit }));
  }));
  router.post("/invoices/:id/pay", mgr, handler(async (req, res) => {
    const b = parseBody(paySchema, req.body);
    res.json(await service.payInvoice(String(req.params.id), b.amountCents, b.method ?? b.mode ?? "transfer", tenantId(res)));
  }));

  // BE-14: AR dunning — updates dunning_level on overdue open/partial invoices.
  router.post("/dunning/run", mgr, handler(async (_req, res) => {
    res.json(await service.runDunning(tenantId(res)));
  }));

  // BE-12: Compute and store bill variance against received PO lines.
  router.post("/bills/:id/variance", mgr, handler(async (req, res) => {
    res.json(await service.computeBillVariance(String(req.params.id), tenantId(res)));
  }));
}
