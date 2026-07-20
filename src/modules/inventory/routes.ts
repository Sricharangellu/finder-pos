import type { Router, Request, Response } from "express";
import { z } from "zod";
import { handler, parseBody, badRequest } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { InventoryService, MovementReason } from "./service.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { PurchasingService } from "../purchasing/index.js";

const lotEntrySchema = z.object({
  quantity: z.number().int().positive(),
  expiryDate: z.number().int().positive().optional(),
  lotCode: z.string().min(1).optional(),
  unitCostCents: z.number().int().nonnegative().optional(),
});
// Receive either a single quantity (optionally one expiry) OR split the receipt
// into multiple lots — one product, several expiry dates in one delivery.
const receiveSchema = z
  .object({
    quantity: z.number().int().positive().optional(),
    expiryDate: z.number().int().positive().optional(),
    lotCode: z.string().min(1).optional(),
    unitCostCents: z.number().int().nonnegative().optional(),
    lots: z.array(lotEntrySchema).min(1).optional(),
  })
  .refine((b) => b.quantity != null || (b.lots != null && b.lots.length > 0), {
    message: "provide quantity, or a lots[] breakdown",
  });

const adjustSchema = z.object({
  // Manual corrections only: a zero delta is a no-op that would pollute the
  // movement ledger and emit a spurious inventory.adjusted event.
  delta: z
    .number()
    .int()
    .refine((d) => d !== 0, { message: "delta must be non-zero" }),
  // 'receiving' has its own endpoint; 'sale'/'return' are system-generated from
  // order events (and drive refund-restock reconciliation). The manual adjust
  // endpoint records corrections as 'adjustment' only.
  reason: z.literal("adjustment").optional(),
});

const reorderSchema = z.object({
  reorderPt: z.number().int().nonnegative(),
});

function parseInt0(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readQuery(req: Request) {
  return {
    lowStock: req.query.lowStock === "true",
    limit: parseInt0(req.query.limit),
    cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
  };
}

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function present(row: { product_id: string; stock_qty: number; reorder_pt: number; updated_at: number }) {
  return {
    productId: row.product_id,
    stockQty: row.stock_qty,
    reorderPt: row.reorder_pt,
    updatedAt: row.updated_at,
  };
}

const cycleCountLineSchema = z.object({
  productId: z.string().min(1),
  countedQty: z.number().int().nonnegative(),
});

const openCycleCountSchema = z.object({
  note: z.string().optional(),
});

function userId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).userId ?? "unknown";
}

const deductSchema = z.object({
  location_id: z.string().min(1).optional(),
  order_id: z.string().min(1).nullable().optional(),
  lines: z.array(
    z.object({
      product_id: z.string().min(1),
      qty: z.number().int().positive(),
    }),
  ).min(1),
});

export function registerRoutes(router: Router, service: InventoryService, purchasing: PurchasingService): void {
  const mgr = requireRole("manager");

  // POST /deduct — decrement stock for multiple products after a completed sale.
  // Registered before /:productId routes so "deduct" isn't treated as a product id.
  // Deliberately NOT manager-gated: web/app/(protected)/terminal/_components/
  // TerminalInner.tsx calls this automatically after every cashier-completed
  // sale (handleTenderSuccess), with the response silently swallowed
  // (.catch(() => {})). Gating it would not fail loudly — it would silently
  // stop inventory from decrementing after routine cashier sales.
  router.post(
    "/deduct",
    handler(async (req, res) => {
      const body = parseBody(deductSchema, req.body);
      const t = tenantId(res);
      const ref = body.order_id ?? undefined;
      const results: Array<{ product_id: string; deducted: number }> = [];

      if (body.location_id) {
        // Location-aware deduction: adjusts inventory_stock by location.
        for (const line of body.lines) {
          await service.adjustStock(t, body.location_id, line.product_id, -line.qty, "sale", ref);
          results.push({ product_id: line.product_id, deducted: line.qty });
        }
      } else {
        // Global deduction: adjusts the main inventory table.
        for (const line of body.lines) {
          await service.adjust(line.product_id, -line.qty, "sale", t, ref);
          results.push({ product_id: line.product_id, deducted: line.qty });
        }
      }

      res.json({ ok: true, deducted: results });
    }),
  );

  router.get(
    "/",
    handler(async (req, res) => {
      res.json(await service.list(readQuery(req), tenantId(res)));
    }),
  );

  // Inventory management grid: products joined with stock. Registered before
  // /:productId so "overview" isn't captured as a product id.
  router.get(
    "/overview",
    handler(async (_req, res) => {
      res.json({ items: await service.overview(tenantId(res)) });
    }),
  );

  // Inventory levels in the frontend's requested shape (search + filters).
  router.get(
    "/levels",
    handler(async (req, res) => {
      const q = {
        query: typeof req.query.query === "string" ? req.query.query : undefined,
        category: typeof req.query.category === "string" ? req.query.category : undefined,
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        pageSize: typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : undefined,
        lowStock: req.query.lowStock === "true",
        cursor: typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined,
      };
      res.json(await service.levels(q, tenantId(res)));
    }),
  );

  // Movement history by query param — the shape the web client actually calls
  // (GET /inventory/movements?product_id=…&limit=…). Previously mock-only: the
  // real backend bound productId="movements" and returned [], leaving the
  // movements panels silently empty in production. Registered before
  // /:productId routes so "movements" isn't captured as a product id.
  router.get(
    "/movements",
    handler(async (req, res) => {
      const productId = typeof req.query.product_id === "string" ? req.query.product_id : "";
      if (!productId) throw badRequest("product_id is required");
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
      res.json(await service.movements(productId, tenantId(res), { limit, cursor }));
    }),
  );

  // Near-expiry report — registered before /:productId so "expiring" isn't an id.
  router.get(
    "/expiring",
    handler(async (req, res) => {
      const days = typeof req.query.days === "string" ? Number(req.query.days) : 30;
      res.json({ items: await service.expiring(Number.isFinite(days) ? days : 30, tenantId(res)) });
    }),
  );

  // Already-expired but still on hand.
  router.get(
    "/expired",
    handler(async (_req, res) => {
      res.json({ items: await service.expired(tenantId(res)) });
    }),
  );

  // Expiry value-at-risk summary (counts + cost value).
  router.get(
    "/expiry-summary",
    handler(async (req, res) => {
      const days = typeof req.query.days === "string" ? Number(req.query.days) : 30;
      res.json(await service.expirySummary(tenantId(res), Number.isFinite(days) ? days : 30));
    }),
  );

  // ── Expiry pool ─────────────────────────────────────────────────────────────
  // The expiry sheet: stock swept out of active inventory, pending disposition.
  router.get("/expiry", handler(async (_req, res) => {
    res.json({ items: await service.listExpiryPool(tenantId(res)) });
  }));

  // Sweep all past-expiry stock out of active inventory into the pool (manager+).
  router.post("/expiry/sweep", mgr, handler(async (_req, res) => {
    res.json(await service.sweepExpired(tenantId(res)));
  }));

  // Discard an expiry item — the loss (booked on sweep) stands (manager+).
  router.post("/expiry/:id/discard", mgr, handler(async (req, res) => {
    res.json(await service.disposeExpiry(String(req.params.id), tenantId(res), "discarded"));
  }));

  // Return an expiry item to the vendor — creates a purchasing vendor return
  // (optionally a vendor credit) and resolves the pool item (manager+).
  const returnSchema = z.object({ supplierId: z.string().min(1).optional(), createCredit: z.boolean().optional() });
  router.post("/expiry/:id/return-to-vendor", mgr, handler(async (req, res) => {
    const t = tenantId(res);
    const body = parseBody(returnSchema, req.body ?? {});
    const item = await service.getExpiry(String(req.params.id), t);
    if (item.status !== "pending") throw badRequest("this expiry item has already been disposed");
    const vendorReturn = await purchasing.createReturn(
      {
        supplierId: body.supplierId,
        reason: "expired",
        lines: [{ productId: item.product_id, quantity: item.qty, unitCostCents: item.unit_cost_cents, ...(item.lot_id ? { lotId: item.lot_id } : {}) }],
        createCredit: body.createCredit ?? Boolean(body.supplierId),
      },
      t,
    );
    const writeoff = await service.disposeExpiry(String(req.params.id), t, "returned", vendorReturn.id);
    res.json({ writeoff, vendorReturn });
  }));

  // Location-to-location transfers — before /:productId so "transfers" isn't an id.
  router.get(
    "/transfers",
    handler(async (_req, res) => {
      res.json({ items: await service.listTransfers(tenantId(res)) });
    }),
  );

  const transferSchema = z.object({
    from_location_id: z.string().min(1),
    to_location_id: z.string().min(1),
    product_id: z.string().min(1),
    quantity: z.number().int().positive(),
    note: z.string().nullable().optional(),
  });

  router.post(
    "/transfers",
    mgr,
    handler(async (req, res) => {
      const body = parseBody(transferSchema, req.body);
      const row = await service.createTransfer(tenantId(res), {
        fromLocationId: body.from_location_id,
        toLocationId: body.to_location_id,
        productId: body.product_id,
        quantity: body.quantity,
        note: body.note ?? null,
      });
      res.status(201).json({
        id: row.id,
        from_location_id: row.from_location_id,
        to_location_id: row.to_location_id,
        product_id: row.product_id,
        quantity: row.quantity,
        note: row.note,
        status: row.status,
        created_at: row.created_at,
      });
    }),
  );

  // Manual location-level stock correction (add | remove | set) — mock parity.
  const locationAdjustSchema = z.object({
    product_id: z.string().min(1),
    location_id: z.string().min(1),
    delta: z.number().int(),
    mode: z.enum(["add", "remove", "set"]).optional(),
    reason: z.string().min(1),
    note: z.string().nullable().optional(),
    actor: z.string().optional(),
  });

  router.post(
    "/adjustments",
    mgr,
    handler(async (req, res) => {
      const body = parseBody(locationAdjustSchema, req.body);
      const { actualDelta } = await service.adjustAtLocation(tenantId(res), {
        productId: body.product_id,
        locationId: body.location_id,
        delta: body.delta,
        mode: body.mode,
        ref: body.note ?? body.reason,
      });
      res.status(201).json({
        id: `adj_${Date.now().toString(36)}`,
        product_id: body.product_id,
        location_id: body.location_id,
        delta: actualDelta,
        reason: body.reason,
        applied_at: Date.now(),
      });
    }),
  );

  // Availability read-model: on-hand / reserved (approved unshipped SOs) /
  // incoming (open approved PO remainder) / available.
  router.get(
    "/:productId/availability",
    handler(async (req, res) => {
      res.json(await service.availability(String(req.params.productId), tenantId(res)));
    }),
  );

  // Single-segment GET routes below MUST be registered before the /:productId
  // catch-all — Express matches GET routes in registration order, and
  // "/:productId" matches any single path segment literally, so a route like
  // GET /counts registered after it is unreachable (silently shadowed; the
  // request hits the :productId handler with productId="counts" instead).
  // Found 2026-07-18: GET /counts, GET /locations, and GET /reorder-suggestions
  // were all previously registered after this handler and were 100% dead code
  // — every request to any of the three real, shipped pages that call them
  // (cycle counts, inventory locations, purchasing/inventory reorder alerts)
  // silently got back a per-product stock row instead of the intended list.
  router.get("/counts", handler(async (_req, res) => {
    res.json({ items: await service.listCycleCounts(tenantId(res)) });
  }));

  router.get("/locations", handler(async (_req, res) => {
    res.json({ items: await service.listLocations(tenantId(res)) });
  }));

  // BE-27: Reorder suggestions.
  router.get("/reorder-suggestions", handler(async (_req, res) => {
    res.json({ items: await service.getReorderSuggestions(tenantId(res)) });
  }));

  router.get(
    "/:productId",
    handler(async (req, res) => {
      const row = await service.getStock(String(req.params.productId), tenantId(res));
      res.json(present(row));
    }),
  );

  router.get(
    "/:productId/lots",
    handler(async (req, res) => {
      res.json({ items: await service.lots(String(req.params.productId), tenantId(res)) });
    }),
  );

  // Legacy path-param shape — kept for compatibility; returns the bare array
  // (now bounded to the max page) rather than the cursor envelope.
  router.get(
    "/:productId/movements",
    handler(async (req, res) => {
      const page = await service.movements(String(req.params.productId), tenantId(res), { limit: 200 });
      res.json(page.items);
    }),
  );

  router.post(
    "/:productId/receive",
    mgr,
    handler(async (req, res) => {
      const body = parseBody(receiveSchema, req.body);
      const productId = String(req.params.productId);
      const t = tenantId(res);
      let row;
      if (body.lots && body.lots.length > 0) {
        // One product, multiple expiry dates: total stock + one lot per entry.
        const total = body.lots.reduce((s, l) => s + l.quantity, 0);
        row = await service.adjust(productId, total, "receiving", t);
        for (const l of body.lots) {
          if (l.expiryDate) {
            await service.createLot(
              { productId, expiryDate: l.expiryDate, quantity: l.quantity, lotCode: l.lotCode ?? null, unitCostCents: l.unitCostCents ?? null },
              t,
            );
          }
        }
      } else {
        row = await service.adjust(productId, body.quantity!, "receiving", t);
        if (body.expiryDate) {
          await service.createLot(
            { productId, expiryDate: body.expiryDate, quantity: body.quantity!, lotCode: body.lotCode ?? null, unitCostCents: body.unitCostCents ?? null },
            t,
          );
        }
      }
      res.status(201).json(present(row));
    }),
  );

  router.post(
    "/:productId/adjust",
    mgr,
    handler(async (req, res) => {
      const body = parseBody(adjustSchema, req.body);
      const reason: MovementReason = body.reason ?? "adjustment";
      const row = await service.adjust(String(req.params.productId), body.delta, reason, tenantId(res));
      res.json(present(row));
    }),
  );

  router.put(
    "/:productId/reorder-point",
    mgr,
    handler(async (req, res) => {
      const body = parseBody(reorderSchema, req.body);
      const row = await service.setReorderPoint(String(req.params.productId), body.reorderPt, tenantId(res));
      res.json(present(row));
    }),
  );

  // BE-10: Cycle count sessions ─────────────────────────────────────────────
  // (GET /counts is registered earlier, ahead of the /:productId catch-all.)
  router.post("/counts", mgr, handler(async (req, res) => {
    const body = parseBody(openCycleCountSchema, req.body);
    res.status(201).json(await service.openCycleCount(userId(res), tenantId(res), body.note));
  }));

  router.get("/counts/:id/lines", handler(async (req, res) => {
    res.json({ items: await service.getCycleCountLines(String(req.params.id), tenantId(res)) });
  }));

  router.post("/counts/:id/lines", handler(async (req, res) => {
    const body = parseBody(cycleCountLineSchema, req.body);
    res.status(201).json(await service.recordCycleCountLine(String(req.params.id), body.productId, body.countedQty, tenantId(res)));
  }));

  router.post("/counts/:id/close", mgr, handler(async (req, res) => {
    res.json(await service.closeCycleCount(String(req.params.id), tenantId(res)));
  }));

  // ── Inventory Locations ────────────────────────────────────────────────────
  const createLocationSchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    outletId: z.string().min(1).nullable().optional(),
    locationType: z.string().min(1).optional(),
  });

  // (GET /locations is registered earlier, ahead of the /:productId catch-all.)
  router.post("/locations", mgr, handler(async (req, res) => {
    const body = parseBody(createLocationSchema, req.body);
    res.status(201).json(await service.createLocation(tenantId(res), body));
  }));

  router.get("/locations/:id/stock", handler(async (req, res) => {
    res.json({ items: await service.getStockByLocation(tenantId(res), String(req.params.id)) });
  }));

  // (GET /reorder-suggestions is registered earlier, ahead of /:productId.)
  const createPOSchema = z.object({
    lines: z.array(z.object({
      productId: z.string().min(1),
      productName: z.string().optional(),
      vendorId: z.string().min(1),
      quantity: z.number().int().positive(),
      unitCostCents: z.number().int().nonnegative(),
    })).min(1),
  });

  router.post("/reorder-suggestions/create-po", mgr, handler(async (req, res) => {
    const body = parseBody(createPOSchema, req.body);
    const tid = tenantId(res);
    // Group lines by vendorId and create one PO per vendor.
    const byVendor = new Map<string, typeof body.lines>();
    for (const l of body.lines) {
      const existing = byVendor.get(l.vendorId) ?? [];
      existing.push(l);
      byVendor.set(l.vendorId, existing);
    }
    const orders: unknown[] = [];
    for (const [vendorId, lines] of byVendor) {
      const po = await purchasing.createOrder(
        vendorId,
        lines.map((l) => ({ productId: l.productId, productName: l.productName, quantity: l.quantity, unitCostCents: l.unitCostCents })),
        tid,
      );
      orders.push(po);
    }
    res.status(201).json({ orders });
  }));
}
