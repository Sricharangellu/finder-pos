import type { Router, Request, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { InventoryService, MovementReason } from "./service.js";
import type { AuthPayload } from "../../gateway/auth.js";

const receiveSchema = z.object({
  quantity: z.number().int().positive(),
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
    offset: parseInt0(req.query.offset),
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

export function registerRoutes(router: Router, service: InventoryService): void {
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
      };
      res.json(await service.levels(q, tenantId(res)));
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
    "/:productId/movements",
    handler(async (req, res) => {
      res.json(await service.movements(String(req.params.productId), tenantId(res)));
    }),
  );

  router.post(
    "/:productId/receive",
    handler(async (req, res) => {
      const body = parseBody(receiveSchema, req.body);
      const row = await service.adjust(String(req.params.productId), body.quantity, "receiving", tenantId(res));
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
}
