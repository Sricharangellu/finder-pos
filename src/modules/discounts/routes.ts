import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { DiscountsService, RuleStatus } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function readInt(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

const createSchema = z.object({
  name: z.string().min(1),
  couponCode: z.string().min(1).optional(),
  ruleType: z.enum(["simple", "volume", "bxgy"]),
  discountType: z.enum(["fixed", "percent"]),
  value: z.number().int().nonnegative(),
  applyTo: z.enum(["product", "category", "cart"]),
  targetId: z.string().min(1).optional(),
  minOrderCents: z.number().int().nonnegative().optional(),
  minQty: z.number().int().nonnegative().optional(),
  buyQty: z.number().int().nonnegative().optional(),
  getQty: z.number().int().nonnegative().optional(),
  tierRestriction: z.array(z.number().int().min(1).max(5)).optional(),
  startDate: z.number().int().positive().optional(),
  endDate: z.number().int().positive().optional(),
  autoApplicable: z.boolean().optional(),
  usageLimit: z.number().int().positive().optional(),
  perCustomerLimit: z.number().int().positive().optional(),
});

const evaluateSchema = z.object({
  lines: z.array(z.object({
    productId: z.string().min(1),
    category: z.string().optional(),
    quantity: z.number().int().positive(),
    unitCents: z.number().int().nonnegative(),
  })).min(1),
  customerTier: z.number().int().min(1).max(5).optional(),
  couponCode: z.string().min(1).optional(),
});

const statusSchema = z.object({ status: z.enum(["active", "inactive", "paused", "archived"]) });

export function registerRoutes(router: Router, service: DiscountsService): void {
  const mgr = requireRole("manager");

  router.post("/", mgr, handler(async (req, res) => {
    res.status(201).json(await service.create(parseBody(createSchema, req.body), tenantId(res)));
  }));
  router.get("/", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? (req.query.status as RuleStatus) : undefined;
    const limit = readInt(req.query.limit, 50);
    const offset = readInt(req.query.offset, 0);
    res.json(await service.list(tenantId(res), { status, limit, offset }));
  }));
  router.get("/:id", handler(async (req, res) => {
    res.json(await service.get(String(req.params.id), tenantId(res)));
  }));
  router.patch("/:id/status", mgr, handler(async (req, res) => {
    const b = parseBody(statusSchema, req.body);
    res.json(await service.setStatus(String(req.params.id), b.status, tenantId(res)));
  }));
  const updateSchema = createSchema.partial();
  router.patch("/:id", mgr, handler(async (req, res) => {
    res.json(await service.update(String(req.params.id), parseBody(updateSchema, req.body), tenantId(res)));
  }));

  const redeemSchema = z.object({
    customerId: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
  }).optional();

  router.post("/:id/redeem", handler(async (req, res) => {
    const b = req.body && Object.keys(req.body).length > 0 ? parseBody(redeemSchema as z.ZodTypeAny, req.body) : undefined;
    res.json(await service.redeem(String(req.params.id), tenantId(res), b?.customerId, b?.orderId));
  }));
  router.post("/evaluate", handler(async (req, res) => {
    res.json(await service.evaluate(parseBody(evaluateSchema, req.body), tenantId(res)));
  }));
}
