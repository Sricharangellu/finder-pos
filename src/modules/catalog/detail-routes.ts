import { z } from "zod";
import type { Router, Response } from "express";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { CatalogDetailViewsService } from "./detail-views.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const periodSchema = z.enum(["7d", "30d", "90d", "12m"]);

const supplierInputSchema = z.object({
  vendor_name: z.string().min(1).optional(),
  vendor_sku: z.string().nullable().optional(),
  cost_cents: z.number().int().nonnegative().nullable().optional(),
  lead_time_days: z.number().int().nonnegative().nullable().optional(),
  moq: z.number().int().nonnegative().nullable().optional(),
  case_pack: z.number().int().nonnegative().nullable().optional(),
  is_preferred: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

const pricingPatchSchema = z.object({
  wholesale_price_cents: z.number().int().nonnegative().nullable().optional(),
  map_price_cents: z.number().int().nonnegative().nullable().optional(),
});

const priceTierSchema = z.object({
  min_qty: z.number().int().positive(),
  price_cents: z.number().int().nonnegative(),
  label: z.string().nullable().optional(),
});

const expiryInputSchema = z.object({
  batch_number: z.string().nullable().optional(),
  lot_code: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
  unit_cost_cents: z.number().int().nonnegative().nullable().optional(),
  expiry_date: z.number().int().positive().nullable().optional(),
  location_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const expiryPatchSchema = expiryInputSchema.partial();

/**
 * Product-detail-page routes: read views + small CRUD surfaces backed by
 * CatalogDetailViewsService. Registered alongside the main catalog routes
 * (routes.ts) from index.ts — split into its own file since these routes
 * reach into cross-module tables (orders/purchasing/inventory) rather than
 * catalog's own schema. See detail-views.ts for the full rationale.
 */
export function registerDetailRoutes(router: Router, service: CatalogDetailViewsService): void {
  // ── Read views ───────────────────────────────────────────────────────────────

  router.get("/:id/stock", handler(async (req, res) => {
    res.json(await service.stock(String(req.params.id), tenantId(res)));
  }));

  router.get("/:id/sales", handler(async (req, res) => {
    const limit = Number(req.query["limit"] ?? 500);
    res.json(await service.sales(String(req.params.id), tenantId(res), Number.isFinite(limit) ? limit : 500));
  }));

  router.get("/:id/sales-by-customer", handler(async (req, res) => {
    res.json(await service.salesByCustomer(String(req.params.id), tenantId(res)));
  }));

  router.get("/:id/purchases", handler(async (req, res) => {
    res.json(await service.purchases(String(req.params.id), tenantId(res)));
  }));

  router.get("/:id/invoices", handler(async (req, res) => {
    res.json(await service.invoices(String(req.params.id), tenantId(res)));
  }));

  router.get("/:id/returns", handler(async (req, res) => {
    const limit = Number(req.query["limit"] ?? 100);
    res.json(await service.returns(String(req.params.id), tenantId(res), Number.isFinite(limit) ? limit : 100));
  }));

  router.get("/:id/reorder-suggestions", handler(async (req, res) => {
    res.json(await service.reorderSuggestions(String(req.params.id), tenantId(res)));
  }));

  router.get("/:id/supplier-price-comparison", handler(async (req, res) => {
    res.json(await service.supplierPriceComparison(String(req.params.id), tenantId(res)));
  }));

  router.get("/:id/analytics", handler(async (req, res) => {
    const period = periodSchema.safeParse(req.query["period"]);
    res.json(await service.analytics(String(req.params.id), tenantId(res), period.success ? period.data : "30d"));
  }));

  router.get("/:id/audit-log", handler(async (req, res) => {
    const limit = Number(req.query["limit"] ?? 200);
    res.json(await service.auditLog(String(req.params.id), tenantId(res), Number.isFinite(limit) ? limit : 200));
  }));

  // ── Suppliers CRUD ───────────────────────────────────────────────────────────

  router.get("/:id/suppliers", handler(async (req, res) => {
    res.json(await service.listSuppliers(String(req.params.id), tenantId(res)));
  }));

  router.post("/:id/suppliers", requireRole("manager"), handler(async (req, res) => {
    const body = parseBody(supplierInputSchema, req.body);
    res.status(201).json(await service.addSupplier(String(req.params.id), tenantId(res), body));
  }));

  router.patch("/:id/suppliers/:supplierId", requireRole("manager"), handler(async (req, res) => {
    const body = parseBody(supplierInputSchema, req.body);
    res.json(await service.updateSupplier(String(req.params.supplierId), String(req.params.id), tenantId(res), body));
  }));

  router.delete("/:id/suppliers/:supplierId", requireRole("manager"), handler(async (req, res) => {
    await service.deleteSupplier(String(req.params.supplierId), String(req.params.id), tenantId(res));
    res.status(204).end();
  }));

  // ── Pricing ──────────────────────────────────────────────────────────────────

  router.get("/:id/pricing", handler(async (req, res) => {
    res.json(await service.pricing(String(req.params.id), tenantId(res)));
  }));

  router.patch("/:id/pricing", requireRole("manager"), handler(async (req, res) => {
    const body = parseBody(pricingPatchSchema, req.body);
    await service.updatePricing(String(req.params.id), tenantId(res), body);
    res.json(await service.pricing(String(req.params.id), tenantId(res)));
  }));

  router.post("/:id/pricing/tiers", requireRole("manager"), handler(async (req, res) => {
    const body = parseBody(priceTierSchema, req.body);
    res.status(201).json(await service.addPriceTier(String(req.params.id), tenantId(res), body));
  }));

  router.delete("/:id/pricing/tiers/:tierId", requireRole("manager"), handler(async (req, res) => {
    await service.deletePriceTier(String(req.params.tierId), String(req.params.id), tenantId(res));
    res.status(204).end();
  }));

  // ── Expiry (manual per-lot entries) ─────────────────────────────────────────

  router.get("/:id/expiry", handler(async (req, res) => {
    res.json(await service.listExpiry(String(req.params.id), tenantId(res)));
  }));

  router.post("/:id/expiry", requireRole("manager"), handler(async (req, res) => {
    const body = parseBody(expiryInputSchema, req.body);
    res.status(201).json(await service.addExpiry(String(req.params.id), tenantId(res), body));
  }));

  router.patch("/:id/expiry/:expiryId", requireRole("manager"), handler(async (req, res) => {
    const body = parseBody(expiryPatchSchema, req.body);
    res.json(await service.updateExpiry(String(req.params.expiryId), String(req.params.id), tenantId(res), body));
  }));

  router.delete("/:id/expiry/:expiryId", requireRole("manager"), handler(async (req, res) => {
    await service.deleteExpiry(String(req.params.expiryId), String(req.params.id), tenantId(res));
    res.status(204).end();
  }));

  // ── Images (patch is_primary; nested delete matching the FE's URL shape —
  //    routes.ts keeps its top-level /images/:imageId DELETE too, unchanged) ──

  router.patch("/:id/images/:imageId", requireRole("manager"), handler(async (req, res) => {
    const body = parseBody(z.object({ is_primary: z.boolean() }), req.body);
    if (body.is_primary) await service.setPrimaryImage(String(req.params.imageId), String(req.params.id), tenantId(res));
    res.json({ ok: true });
  }));

  router.delete("/:id/images/:imageId", requireRole("manager"), handler(async (req, res) => {
    await service.deleteImageScoped(String(req.params.imageId), String(req.params.id), tenantId(res));
    res.status(204).end();
  }));

  // ── Duplicate ────────────────────────────────────────────────────────────────

  router.post("/:id/duplicate", requireRole("manager"), handler(async (req, res) => {
    res.status(201).json(await service.duplicate(String(req.params.id), tenantId(res)));
  }));
}
