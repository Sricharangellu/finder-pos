import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { PurchasingService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

// All editable vendor profile fields — shared by create and update schemas.
const supplierProfileSchema = {
  email: z.string().email().nullable().optional(),
  company: z.string().nullable().optional(),
  dba: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  taxId: z.string().nullable().optional(),
  feinNumber: z.string().nullable().optional(),
  vendorType: z.enum(["manufacturer", "wholesaler"]).nullable().optional(),
  msaType: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  primarySalesRep: z.string().nullable().optional(),
  termsDays: z.number().int().nonnegative().nullable().optional(),
  address1: z.string().nullable().optional(),
  address2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  county: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
};

const supplierSchema = z.object({ name: z.string().min(1), ...supplierProfileSchema });
const updateSupplierSchema = z.object({ name: z.string().min(1).optional(), ...supplierProfileSchema, status: z.enum(["active", "inactive"]).optional() });

const poSchema = z.object({
  supplierId: z.string().min(1),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
        unitCostCents: z.number().int().nonnegative(),
        expiryDate: z.number().int().positive().optional(),
        lotCode: z.string().min(1).optional(),
        productName: z.string().nullable().optional(),
        upc: z.string().nullable().optional(),
        vendorUpc: z.string().nullable().optional(),
        rawCostPriceCents: z.number().int().nonnegative().nullable().optional(),
        unitPriceCents: z.number().int().nonnegative().nullable().optional(),
      }),
    )
    .min(1),
});

const returnSchema = z.object({
  supplierId: z.string().min(1).optional(),
  reason: z.enum(["damaged", "expired", "other"]),
  createCredit: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
        unitCostCents: z.number().int().nonnegative().optional(),
        lotId: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

const vendorCreditSchema = z.object({
  supplierId: z.string().min(1),
  type: z.enum(["chargeback", "credit_memo"]),
  amountCents: z.number().int().positive(),
  reason: z.string().min(1).optional(),
  poId: z.string().min(1).optional(),
});

export function registerRoutes(router: Router, service: PurchasingService): void {
  const mgr = requireRole("manager");

  router.post("/suppliers", mgr, handler(async (req, res) => {
    const b = parseBody(supplierSchema, req.body);
    res.status(201).json(await service.createSupplier(b.name, b.email ?? undefined, tenantId(res), {
      company: b.company, dba: b.dba, phone: b.phone,
      description: b.description, taxId: b.taxId, feinNumber: b.feinNumber,
      vendorType: b.vendorType, msaType: b.msaType,
      contactName: b.contactName, primarySalesRep: b.primarySalesRep,
      termsDays: b.termsDays,
      address1: b.address1, address2: b.address2, city: b.city,
      state: b.state, county: b.county, zip: b.zip, country: b.country,
    }));
  }));

  router.get("/suppliers", handler(async (_req, res) => {
    res.json({ items: await service.listSuppliers(tenantId(res)) });
  }));

  router.get("/suppliers/:id", handler(async (req, res) => {
    const s = await service.getSupplier(String(req.params.id), tenantId(res));
    if (!s) throw notFound(`supplier '${req.params.id}' not found`);
    res.json(s);
  }));

  router.patch("/suppliers/:id", mgr, handler(async (req, res) => {
    const b = parseBody(updateSupplierSchema, req.body);
    res.json(await service.updateSupplier(String(req.params.id), b, tenantId(res)));
  }));

  // Vendor list with spend + open-credit balances.
  router.get("/vendors", handler(async (_req, res) => {
    res.json({ items: await service.vendors(tenantId(res)) });
  }));

  // Vendor AP credits — chargebacks + credit memos.
  router.post("/vendor-credits", mgr, handler(async (req, res) => {
    const b = parseBody(vendorCreditSchema, req.body);
    res.status(201).json(await service.createVendorCredit(b, tenantId(res)));
  }));

  router.get("/vendor-credits", handler(async (req, res) => {
    const supplierId = typeof req.query.supplierId === "string" ? req.query.supplierId : undefined;
    res.json({ items: await service.listVendorCredits(tenantId(res), supplierId) });
  }));

  router.post("/vendor-credits/:id/void", mgr, handler(async (req, res) => {
    res.json(await service.voidVendorCredit(String(req.params.id), tenantId(res)));
  }));

  // Vendor returns / write-offs (damaged + expired) — optionally raise a credit memo.
  router.post("/returns", mgr, handler(async (req, res) => {
    const b = parseBody(returnSchema, req.body);
    res.status(201).json(await service.createReturn(b, tenantId(res)));
  }));

  router.get("/returns", handler(async (_req, res) => {
    res.json({ items: await service.listReturns(tenantId(res)) });
  }));

  router.post("/orders", mgr, handler(async (req, res) => {
    const b = parseBody(poSchema, req.body);
    res.status(201).json(await service.createOrder(b.supplierId, b.lines, tenantId(res)));
  }));

  router.get("/orders", handler(async (_req, res) => {
    res.json({ items: await service.listOrders(tenantId(res)) });
  }));

  router.get("/orders/:id", handler(async (req, res) => {
    res.json(await service.getOrder(String(req.params.id), tenantId(res)));
  }));

  const receiveSchema = z.object({
    lines: z.array(z.object({
      lineId: z.string().min(1),
      qty: z.number().int().positive().optional(),
      quantity: z.number().int().positive().optional(),
    })).min(1),
  });

  router.post("/orders/:id/receive", mgr, handler(async (req, res) => {
    const b = parseBody(receiveSchema, req.body);
    // Support both `qty` (legacy) and `quantity` (BE-11) field names.
    const lines = b.lines.map((l) => ({ lineId: l.lineId, qty: l.qty ?? l.quantity ?? 1 }));
    res.json(await service.receive(String(req.params.id), tenantId(res), lines));
  }));
}
