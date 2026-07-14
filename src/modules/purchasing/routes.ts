import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { PurchasingService, ReceiveLineInput } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

/** Actor identity for the approval audit trail. */
function actor(res: Response): { id: string | null; role: string } {
  const a = res.locals["auth"] as AuthPayload;
  return { id: a.userId ?? null, role: a.role };
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

  // ── Vendor-360 detail views ────────────────────────────────────────────────
  router.get("/vendors/:id", handler(async (req, res) => {
    res.json(await service.vendorDetail(String(req.params.id), tenantId(res)));
  }));

  router.get("/vendors/:id/products", handler(async (req, res) => {
    res.json({ items: await service.vendorProducts(String(req.params.id), tenantId(res)) });
  }));

  router.get("/vendors/:id/purchase-orders", handler(async (req, res) => {
    res.json({ items: await service.vendorPurchaseOrders(String(req.params.id), tenantId(res)) });
  }));

  router.get("/vendors/:id/invoices", handler(async (req, res) => {
    res.json({ items: await service.vendorInvoices(String(req.params.id), tenantId(res)) });
  }));

  router.get("/vendors/:id/credits", handler(async (req, res) => {
    res.json({ items: await service.vendorCreditsFor(String(req.params.id), tenantId(res)) });
  }));

  router.get("/vendors/:id/receiving", handler(async (req, res) => {
    res.json({ items: await service.vendorReceiving(String(req.params.id), tenantId(res)) });
  }));

  // Vendor AP credits — chargebacks + credit memos.
  router.post("/vendor-credits", mgr, handler(async (req, res) => {
    const b = parseBody(vendorCreditSchema, req.body);
    res.status(201).json(await service.createVendorCredit(b, tenantId(res)));
  }));

  router.get("/vendor-credits", handler(async (req, res) => {
    const supplierId = typeof req.query.supplierId === "string" ? req.query.supplierId : undefined;
    const poId = typeof req.query.poId === "string" ? req.query.poId : undefined;
    if (poId) {
      // Per-PO credits are naturally bounded — no pagination needed.
      res.json({ items: await service.listVendorCreditsFiltered(tenantId(res), { supplierId, poId }) });
      return;
    }
    const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(await service.listVendorCredits(tenantId(res), supplierId, { cursor, limit }));
  }));

  router.post("/vendor-credits/:id/void", mgr, handler(async (req, res) => {
    res.json(await service.voidVendorCredit(String(req.params.id), tenantId(res)));
  }));

  // Vendor returns / write-offs (damaged + expired) — optionally raise a credit memo.
  router.post("/returns", mgr, handler(async (req, res) => {
    const b = parseBody(returnSchema, req.body);
    res.status(201).json(await service.createReturn(b, tenantId(res)));
  }));

  router.get("/returns", handler(async (req, res) => {
    const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(await service.listReturns(tenantId(res), { cursor, limit }));
  }));

  router.post("/orders", mgr, handler(async (req, res) => {
    const b = parseBody(poSchema, req.body);
    res.status(201).json(await service.createOrder(b.supplierId, b.lines, tenantId(res), actor(res)));
  }));

  // ── PO approval workflow ─────────────────────────────────────────────────────
  // Config: absent = approvals disabled (all POs auto-approve). Owner-only to change.
  router.get("/approval-config", handler(async (_req, res) => {
    res.json({ config: await service.getApprovalConfig(tenantId(res)) });
  }));

  router.put("/approval-config", requireRole("owner"), handler(async (req, res) => {
    const b = parseBody(
      z.object({
        autoLimitCents: z.number().int().nonnegative(),
        managerLimitCents: z.number().int().nonnegative(),
        enabled: z.boolean().optional(),
      }),
      req.body,
    );
    res.json({ config: await service.setApprovalConfig(b, tenantId(res)) });
  }));

  // Approve/reject a pending PO. Manager may approve mid-tier amounts; the service
  // enforces the owner tier for large POs. History is append-only (no delete route).
  router.post("/orders/:id/approve", mgr, handler(async (req, res) => {
    res.json(await service.approveOrder(String(req.params.id), actor(res), tenantId(res)));
  }));

  router.post("/orders/:id/reject", mgr, handler(async (req, res) => {
    const b = parseBody(z.object({ note: z.string().max(500).optional() }), req.body ?? {});
    res.json(await service.rejectOrder(String(req.params.id), actor(res), tenantId(res), b.note));
  }));

  router.get("/orders/:id/approvals", handler(async (req, res) => {
    res.json({ items: await service.listApprovals(String(req.params.id), tenantId(res)) });
  }));

  router.get("/orders", handler(async (req, res) => {
    const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(await service.listOrders(tenantId(res), { cursor, limit }));
  }));

  router.get("/orders/:id", handler(async (req, res) => {
    res.json(await service.getOrder(String(req.params.id), tenantId(res)));
  }));

  const receiveSchema = z.object({
    // lines is optional — omitting it (or sending {}) means "receive all open lines".
    lines: z.array(z.object({
      lineId: z.string().min(1),
      qty: z.number().int().positive().optional(),
      quantity: z.number().int().positive().optional(),
      // Actuals captured at the receiving desk when the goods physically arrive —
      // expiry and lot are only known now, not at PO time. When present these
      // drive the inventory lot that receiving creates (FEFO / shelf-life).
      expiryDate: z.number().int().positive().optional(),
      lotCode: z.string().min(1).max(120).optional(),
      unitCostCents: z.number().int().nonnegative().optional(),
    })).optional(),
  });

  router.post("/orders/:id/receive", mgr, handler(async (req, res) => {
    const id = String(req.params.id);
    const tid = tenantId(res);
    const b = parseBody(receiveSchema, req.body ?? {});
    let lines: ReceiveLineInput[];
    if (b.lines && b.lines.length > 0) {
      // Explicit lines provided — support both `qty` and `quantity` field names,
      // and carry the receive-time actuals through to the service.
      lines = b.lines.map((l) => ({
        lineId: l.lineId,
        qty: l.qty ?? l.quantity ?? 1,
        ...(l.expiryDate !== undefined ? { expiryDate: l.expiryDate } : {}),
        ...(l.lotCode !== undefined ? { lotCode: l.lotCode } : {}),
        ...(l.unitCostCents !== undefined ? { unitCostCents: l.unitCostCents } : {}),
      }));
    } else {
      // No lines specified: receive all open lines at full remaining quantity ("receive all" button).
      const po = await service.getOrder(id, tid);
      lines = po.lines
        .filter((l) => (l.received_qty ?? 0) < l.quantity)
        .map((l) => ({ lineId: l.id, qty: l.quantity - (l.received_qty ?? 0) }));
      if (lines.length === 0) {
        res.json(po); // already fully received — nothing to do
        return;
      }
    }
    res.json(await service.receive(id, tid, lines));
  }));

  // Landed costs: freight and other charges distributed proportionally across PO lines.
  // POST before receiving — applies value-method allocation to landed_cost_cents per line.
  // Receiving then uses (line_cost + landed_cost) / qty as the true unit cost in product_costs.
  router.post("/orders/:id/landed-costs", mgr, handler(async (req, res) => {
    const b = parseBody(
      z.object({
        freightCents: z.number().int().nonnegative(),
        otherChargesCents: z.number().int().nonnegative().optional(),
      }),
      req.body,
    );
    res.json(await service.applyLandedCosts(
      String(req.params.id),
      tenantId(res),
      b.freightCents,
      b.otherChargesCents ?? 0,
    ));
  }));

  // PO price history
  router.get("/orders/:id/price-history", handler(async (req, res) => {
    res.json({ items: await service.priceHistory(String(req.params.id), tenantId(res)) });
  }));

  // PO documents
  router.get("/orders/:id/documents", handler(async (req, res) => {
    res.json({ items: await service.listPODocuments(String(req.params.id), tenantId(res)) });
  }));

  router.post("/orders/:id/documents", mgr, handler(async (req, res) => {
    const b = parseBody(z.object({
      name: z.string().min(1),
      type: z.string().optional(),
      size_bytes: z.number().int().nonnegative().optional(),
    }), req.body);
    res.status(201).json(await service.addPODocument(String(req.params.id), tenantId(res), {
      name: b.name, type: b.type ?? "other", sizeBytes: b.size_bytes ?? 0,
    }));
  }));

  router.delete("/orders/:id/documents/:docId", mgr, handler(async (req, res) => {
    await service.deletePODocument(String(req.params.id), String(req.params.docId), tenantId(res));
    res.status(204).end();
  }));

  // PO billing adjustments
  router.get("/orders/:id/billing-adj", handler(async (req, res) => {
    res.json({ items: await service.listBillingAdj(String(req.params.id), tenantId(res)) });
  }));

  router.post("/orders/:id/billing-adj", mgr, handler(async (req, res) => {
    const b = parseBody(z.object({
      lineId: z.string().min(1).optional(),
      reason: z.string().min(1),
      amountCents: z.number().int(),
    }), req.body);
    res.status(201).json(await service.createBillingAdj(String(req.params.id), tenantId(res), b));
  }));

  // Vendor quotes
  router.get("/vendor-quotes", handler(async (_req, res) => {
    res.json({ items: await service.listVendorQuotes(tenantId(res)) });
  }));

  router.post("/vendor-quotes", mgr, handler(async (req, res) => {
    const b = parseBody(z.object({
      supplierId: z.string().min(1),
      expiresAt: z.number().int().positive().optional(),
      lines: z.array(z.object({
        productId: z.string().min(1),
        productName: z.string().optional(),
        qty: z.number().int().positive(),
        unitPriceCents: z.number().int().nonnegative(),
      })).min(1),
    }), req.body);
    res.status(201).json(await service.createVendorQuote(tenantId(res), b));
  }));

  router.patch("/vendor-quotes/:id/accept", mgr, handler(async (req, res) => {
    res.json(await service.updateVendorQuoteStatus(String(req.params.id), tenantId(res), "accepted"));
  }));

  router.patch("/vendor-quotes/:id/reject", mgr, handler(async (req, res) => {
    res.json(await service.updateVendorQuoteStatus(String(req.params.id), tenantId(res), "rejected"));
  }));

  // Supplier addresses
  router.get("/suppliers/:supplierId/addresses", handler(async (req, res) => {
    res.json({ items: await service.listSupplierAddresses(String(req.params.supplierId), tenantId(res)) });
  }));
  router.post("/suppliers/:supplierId/addresses", mgr, handler(async (req, res) => {
    const body = parseBody(z.object({ addressType: z.string().optional(), addressLine1: z.string().nullable().optional(), addressLine2: z.string().nullable().optional(), city: z.string().nullable().optional(), state: z.string().nullable().optional(), zip: z.string().nullable().optional(), country: z.string().optional(), county: z.string().nullable().optional(), isDefault: z.boolean().optional() }), req.body);
    res.status(201).json(await service.addSupplierAddress(String(req.params.supplierId), tenantId(res), body));
  }));

  // Supplier contacts
  router.get("/suppliers/:supplierId/contacts", handler(async (req, res) => {
    res.json({ items: await service.listSupplierContacts(String(req.params.supplierId), tenantId(res)) });
  }));
  router.post("/suppliers/:supplierId/contacts", mgr, handler(async (req, res) => {
    const body = parseBody(z.object({ contactName: z.string().min(1), title: z.string().nullable().optional(), email: z.string().email().nullable().optional(), phone: z.string().nullable().optional(), isPrimary: z.boolean().optional() }), req.body);
    res.status(201).json(await service.addSupplierContact(String(req.params.supplierId), tenantId(res), body));
  }));
}
