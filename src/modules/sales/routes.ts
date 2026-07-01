import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { SalesService, QuoteStatus, SOStatus } from "./service.js";
import type { DB } from "../../shared/db.js";

const repSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  commission_pct: z.number().min(0).max(100).optional(),
});

const repPatchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  commission_pct: z.number().min(0).max(100).optional(),
  active: z.boolean().optional(),
});

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
const tierPricesSchema = z.object({
  prices: z.record(z.string(), z.number().int().nonnegative()),
});

export function registerRoutes(router: Router, service: SalesService, db?: DB): void {
  const mgr = requireRole("manager");

  // ── POS sales history (retail receipt list) ────────────────────────────
  // GET /history?status=&q= — maps POS orders → SaleRecord shape for the
  // Sales History page (filter bar + expandable receipt rows).
  if (db) {
    router.get("/history", handler(async (req, res) => {
      const tid    = tenantId(res);
      const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
      const q      = typeof req.query.q === "string" ? req.query.q.toLowerCase() : "";

      const rows = await db.query<{
        id: string; order_number: string; status: string;
        subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number;
        customer_id: string | null; created_at: number;
      }>(
        `SELECT id, order_number, status, subtotal_cents, discount_cents, tax_cents, total_cents,
                customer_id, created_at
           FROM orders
          WHERE tenant_id = @tid ${status ? "AND status = @status" : ""}
          ORDER BY created_at DESC
          LIMIT 200`,
        { tid, status },
      );

      const items = rows
        .filter(r => !q || r.order_number.toLowerCase().includes(q) || (r.customer_id ?? "").toLowerCase().includes(q))
        .map(r => ({
          id:             r.id,
          receipt_number: r.order_number,
          created_at:     r.created_at,
          customer_name:  r.customer_id ?? null,
          sold_by:        "Staff",
          outlet:         "Main Outlet",
          note:           null as string | null,
          total_cents:    r.total_cents,
          status:         r.status as "completed" | "open" | "voided" | "returned",
        }));

      res.json({ items });
    }));
  }

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
  router.post("/quotations/:id/send", mgr, handler(async (req, res) => {
    res.json(await service.sendQuotation(String(req.params.id), tenantId(res)));
  }));
  router.post("/quotations/:id/accept", mgr, handler(async (req, res) => {
    res.json(await service.acceptQuotation(String(req.params.id), tenantId(res)));
  }));
  router.post("/quotations/:id/cancel", mgr, handler(async (req, res) => {
    res.json(await service.cancelQuotation(String(req.params.id), tenantId(res)));
  }));
  router.post("/quotations/:id/convert", mgr, handler(async (req, res) => {
    res.status(201).json(await service.convertQuotationToSO(String(req.params.id), tenantId(res)));
  }));

  // ── Sales orders ───────────────────────────────────────────────────────
  router.post("/sales-orders", handler(async (req, res) => {
    res.status(201).json(await service.createSalesOrder(parseBody(soSchema, req.body), tenantId(res)));
  }));
  router.get("/sales-orders", handler(async (req, res) => {
    res.json(await service.listSalesOrders(tenantId(res), {
      status: typeof req.query.status === "string" ? (req.query.status as SOStatus) : undefined,
      salesRepId: typeof req.query.salesRepId === "string" ? req.query.salesRepId : undefined,
      pickerId: typeof req.query.pickerId === "string" ? req.query.pickerId : undefined,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      limit: typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) || undefined : undefined,
    }));
  }));
  router.get("/sales-orders/:id", handler(async (req, res) => {
    res.json(await service.getSalesOrder(String(req.params.id), tenantId(res)));
  }));
  router.post("/sales-orders/:id/approve", mgr, handler(async (req, res) => {
    res.json(await service.approveSalesOrder(String(req.params.id), tenantId(res)));
  }));
  router.post("/sales-orders/:id/assign-picker", mgr, handler(async (req, res) => {
    const b = parseBody(assignSchema, req.body);
    res.json(await service.assignPicker(String(req.params.id), b.pickerId, tenantId(res)));
  }));
  router.post("/sales-orders/:id/invoice", mgr, handler(async (req, res) => {
    res.json(await service.convertToInvoice(String(req.params.id), tenantId(res)));
  }));
  router.post("/sales-orders/:id/cancel", mgr, handler(async (req, res) => {
    res.json(await service.cancelSalesOrder(String(req.params.id), tenantId(res)));
  }));

  // ── Per-product tier prices ──────────────────────────────────────────────
  router.get("/products/:productId/tier-prices", handler(async (req, res) => {
    res.json(await service.getTierPrices(String(req.params.productId), tenantId(res)));
  }));
  router.put("/products/:productId/tier-prices", mgr, handler(async (req, res) => {
    const b = parseBody(tierPricesSchema, req.body);
    const prices: Record<number, number> = {};
    for (const [k, v] of Object.entries(b.prices)) prices[Number(k)] = v;
    res.json(await service.setTierPrices(String(req.params.productId), prices, tenantId(res)));
  }));

  // ── Sales reps (BE-29) ───────────────────────────────────────────────────────
  router.get("/reps", handler(async (req, res) => {
    const activeOnly = req.query.active === "true";
    res.json({ items: await service.listReps(tenantId(res), activeOnly) });
  }));
  router.post("/reps", mgr, handler(async (req, res) => {
    const b = parseBody(repSchema, req.body);
    res.status(201).json(await service.createRep(b, tenantId(res)));
  }));
  // sub-path BEFORE /:id so "performance" is not treated as an id
  router.get("/reps/:id/performance", handler(async (req, res) => {
    const now = Date.now();
    const from = typeof req.query.from === "string" ? Number(req.query.from) : now - 30 * 86400_000;
    const to   = typeof req.query.to   === "string" ? Number(req.query.to)   : now;
    res.json(await service.getRepPerformance(String(req.params.id), tenantId(res), from, to));
  }));
  router.patch("/reps/:id", mgr, handler(async (req, res) => {
    const b = parseBody(repPatchSchema, req.body);
    res.json(await service.updateRep(String(req.params.id), b, tenantId(res)));
  }));

  // GET /orders — alias for sales-orders with optional ?type filter (used by ecommerce page).
  router.get("/orders", handler(async (req, res) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const page = await service.listSalesOrders(tenantId(res));
    const items = type === "ecommerce"
      ? page.items.filter((o) => o.store_id === "ecommerce")
      : page.items;
    res.json({ items, nextCursor: page.nextCursor, limit: page.limit });
  }));
}
