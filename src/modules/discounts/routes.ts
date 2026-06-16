import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { DiscountsService, RuleStatus } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
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

const statusSchema = z.object({ status: z.enum(["active", "inactive"]) });

export function registerRoutes(router: Router, service: DiscountsService): void {
  const mgr = requireRole("manager");

  router.post("/", mgr, handler(async (req, res) => {
    res.status(201).json(await service.create(parseBody(createSchema, req.body), tenantId(res)));
  }));
  router.get("/", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? (req.query.status as RuleStatus) : undefined;
    res.json({ items: await service.list(tenantId(res), status) });
  }));
  router.get("/:id", handler(async (req, res) => {
    res.json(await service.get(String(req.params.id), tenantId(res)));
  }));
  router.patch("/:id/status", mgr, handler(async (req, res) => {
    const b = parseBody(statusSchema, req.body);
    res.json(await service.setStatus(String(req.params.id), b.status, tenantId(res)));
  }));
  router.post("/:id/redeem", handler(async (req, res) => {
    res.json(await service.redeem(String(req.params.id), tenantId(res)));
  }));
  router.post("/evaluate", handler(async (req, res) => {
    res.json(await service.evaluate(parseBody(evaluateSchema, req.body), tenantId(res)));
  }));
}
