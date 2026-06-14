import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { PurchasingService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const supplierSchema = z.object({ name: z.string().min(1), email: z.string().email().optional() });
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
  router.post("/suppliers", handler(async (req, res) => {
    const b = parseBody(supplierSchema, req.body);
    res.status(201).json(await service.createSupplier(b.name, b.email, tenantId(res)));
  }));

  router.get("/suppliers", handler(async (_req, res) => {
    res.json({ items: await service.listSuppliers(tenantId(res)) });
  }));

  // Vendor list with spend + open-credit balances.
  router.get("/vendors", handler(async (_req, res) => {
    res.json({ items: await service.vendors(tenantId(res)) });
  }));

  // Vendor AP credits — chargebacks + credit memos.
  router.post("/vendor-credits", handler(async (req, res) => {
    const b = parseBody(vendorCreditSchema, req.body);
    res.status(201).json(await service.createVendorCredit(b, tenantId(res)));
  }));

  router.get("/vendor-credits", handler(async (req, res) => {
    const supplierId = typeof req.query.supplierId === "string" ? req.query.supplierId : undefined;
    res.json({ items: await service.listVendorCredits(tenantId(res), supplierId) });
  }));

  router.post("/vendor-credits/:id/void", handler(async (req, res) => {
    res.json(await service.voidVendorCredit(String(req.params.id), tenantId(res)));
  }));

  // Vendor returns / write-offs (damaged + expired) — optionally raise a credit memo.
  router.post("/returns", handler(async (req, res) => {
    const b = parseBody(returnSchema, req.body);
    res.status(201).json(await service.createReturn(b, tenantId(res)));
  }));

  router.get("/returns", handler(async (_req, res) => {
    res.json({ items: await service.listReturns(tenantId(res)) });
  }));

  router.post("/orders", handler(async (req, res) => {
    const b = parseBody(poSchema, req.body);
    res.status(201).json(await service.createOrder(b.supplierId, b.lines, tenantId(res)));
  }));

  router.get("/orders", handler(async (_req, res) => {
    res.json({ items: await service.listOrders(tenantId(res)) });
  }));

  router.get("/orders/:id", handler(async (req, res) => {
    res.json(await service.getOrder(String(req.params.id), tenantId(res)));
  }));

  router.post("/orders/:id/receive", handler(async (req, res) => {
    res.json(await service.receive(String(req.params.id), tenantId(res)));
  }));
}
