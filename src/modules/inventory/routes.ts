import type { Router, Request, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
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

export function registerRoutes(router: Router, service: InventoryService, purchasing: PurchasingService): void {
  const mgr = requireRole("manager");
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

  router.get(
    "/:productId/movements",
    handler(async (req, res) => {
      res.json(await service.movements(String(req.params.productId), tenantId(res)));
    }),
  );

  router.post(
    "/:productId/receive",
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
    handler(async (req, res) => {
      const body = parseBody(adjustSchema, req.body);
      const reason: MovementReason = body.reason ?? "adjustment";
      const row = await service.adjust(String(req.params.productId), body.delta, reason, tenantId(res));
      res.json(present(row));
    }),
  );

  router.put(
    "/:productId/reorder-point",
    handler(async (req, res) => {
      const body = parseBody(reorderSchema, req.body);
      const row = await service.setReorderPoint(String(req.params.productId), body.reorderPt, tenantId(res));
      res.json(present(row));
    }),
  );

  // BE-10: Cycle count sessions ─────────────────────────────────────────────
  router.get("/counts", handler(async (_req, res) => {
    res.json({ items: await service.listCycleCounts(tenantId(res)) });
  }));

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

  router.get("/locations", handler(async (_req, res) => {
    res.json({ items: await service.listLocations(tenantId(res)) });
  }));

  router.post("/locations", mgr, handler(async (req, res) => {
    const body = parseBody(createLocationSchema, req.body);
    res.status(201).json(await service.createLocation(tenantId(res), body));
  }));

  router.get("/locations/:id/stock", handler(async (req, res) => {
    res.json({ items: await service.getStockByLocation(tenantId(res), String(req.params.id)) });
  }));

  // BE-27: Reorder suggestions ─────────────────────────────────────────────
  // Sub-path must be before any /:productId routes — already satisfied here.
  router.get("/reorder-suggestions", handler(async (_req, res) => {
    res.json({ items: await service.getReorderSuggestions(tenantId(res)) });
  }));

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
