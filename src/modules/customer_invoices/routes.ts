import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { CustomerInvoicesService, InvoiceStatus } from "./service.js";

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const lineSchema = z.object({
  product_id: z.string().min(1).nullable().optional(),
  upc: z.string().max(100).nullable().optional(),
  sku: z.string().max(100).nullable().optional(),
  name: z.string().min(1).max(500),
  quantity: z.number().int().positive(),
  unit_price_cents: z.number().int().nonnegative(),
  discount_cents: z.number().int().nonnegative().optional(),
  tax_rate_pct: z.number().min(0).max(100).optional(),
});

const createSchema = z.object({
  customer_id: z.string().min(1).nullable().optional(),
  customer_name: z.string().max(200).optional(),
  customer_email: z.string().email().nullable().optional(),
  customer_phone: z.string().max(30).nullable().optional(),
  billing_address: z.string().max(1000).nullable().optional(),
  due_date: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(lineSchema).min(1).max(500),
  tax_rate_pct: z.number().min(0).max(100).optional(),
});

const VALID_STATUSES: InvoiceStatus[] = ["draft", "sent", "partial", "paid", "overdue", "void"];

const statusUpdateSchema = z.object({
  status: z.enum(["draft", "sent", "partial", "paid", "overdue", "void"]),
  paid_cents: z.number().int().nonnegative().optional(),
});

export function registerRoutes(router: Router, svc: CustomerInvoicesService): void {
  const mgr = requireRole("manager");

  router.get("/customer-invoices", handler(async (req, res) => {
    const status = typeof req.query.status === "string" && VALID_STATUSES.includes(req.query.status as InvoiceStatus)
      ? (req.query.status as InvoiceStatus) : undefined;
    const customerId = typeof req.query.customer_id === "string" ? req.query.customer_id : undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || 50 : 50;
    const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) || 0 : 0;
    res.json(await svc.list(tid(res), { status, customer_id: customerId, limit, offset }));
  }));

  router.get("/customer-invoices/lookup-upc", handler(async (req, res) => {
    const upc = typeof req.query.upc === "string" ? req.query.upc : "";
    if (!upc) { res.status(400).json({ error: { code: "missing_upc" } }); return; }
    const result = await svc.lookupByUpc(upc, tid(res));
    if (!result) { res.status(404).json({ error: { code: "not_found" } }); return; }
    res.json(result);
  }));

  router.get("/customer-invoices/:id", handler(async (req, res) => {
    res.json(await svc.get(String(req.params.id), tid(res)));
  }));

  router.post("/customer-invoices", mgr, handler(async (req, res) => {
    const body = parseBody(createSchema, req.body);
    res.status(201).json(await svc.create(body, tid(res)));
  }));

  router.patch("/customer-invoices/:id/status", mgr, handler(async (req, res) => {
    // Uses parseBody (not raw zod .parse()) so a malformed status value is a
    // clean 400 through errorMiddleware's HttpError branch, not an unhandled
    // ZodError that falls through to a generic 500 (see CODING_STANDARDS.md).
    const b = parseBody(statusUpdateSchema, req.body);
    res.json(await svc.updateStatus(String(req.params.id), b.status, b.paid_cents, tid(res)));
  }));
}
