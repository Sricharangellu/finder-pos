import type { Router, Response, NextFunction, Request } from "express";
import { z } from "zod";
import { handler, parseBody, forbidden } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { hasRole } from "../../identity/types.js";
import type { Role } from "../../identity/types.js";
import type { SettingsService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

/** Role guard: require at least `min` (cashier < manager < owner). */
function requireRole(min: Role) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const role = (res.locals["auth"] as AuthPayload)?.role ?? "cashier";
    if (!hasRole(role, min)) return next(forbidden(`requires ${min} role`));
    next();
  };
}

const shippingSchema = z.object({
  name: z.string().min(1), amountCents: z.number().int().nonnegative(),
  freeLimitCents: z.number().int().nonnegative().optional(), ecommerce: z.boolean().optional(),
  sequence: z.number().int().optional(), creditAccountId: z.string().optional(), debitAccountId: z.string().optional(),
});
const termSchema = z.object({ name: z.string().min(1), daysDue: z.number().int().nonnegative(), description: z.string().optional() });
const modeSchema = z.object({ name: z.string().min(1) });
const taxSchema = z.object({ name: z.string().min(1), rateBps: z.number().int().nonnegative(), applyToCategory: z.string().optional(), state: z.string().optional() });
const flagsSchema = z.object({}).catchall(z.boolean());
const businessSchema = z.object({}).catchall(z.unknown());

export function registerRoutes(router: Router, service: SettingsService): void {
  const mgr = requireRole("manager");

  router.post("/seed", mgr, handler(async (_req, res) => res.json(await service.seedDefaults(tenantId(res)))));

  // Business profile + feature flags
  router.get("/business", handler(async (_req, res) => res.json(await service.getBusiness(tenantId(res)))));
  router.put("/business", mgr, handler(async (req, res) => res.json(await service.setBusiness(parseBody(businessSchema, req.body), tenantId(res)))));
  router.get("/feature-flags", handler(async (_req, res) => res.json(await service.getFlags(tenantId(res)))));
  router.put("/feature-flags", mgr, handler(async (req, res) => res.json(await service.setFlags(parseBody(flagsSchema, req.body), tenantId(res)))));

  // Shipping methods
  router.get("/shipping-methods", handler(async (_req, res) => res.json({ items: await service.listShipping(tenantId(res)) })));
  router.post("/shipping-methods", mgr, handler(async (req, res) => res.status(201).json(await service.createShipping(parseBody(shippingSchema, req.body), tenantId(res)))));
  router.delete("/shipping-methods/:id", mgr, handler(async (req, res) => res.json(await service.deleteShipping(String(req.params.id), tenantId(res)))));

  // Payment terms
  router.get("/payment-terms", handler(async (_req, res) => res.json({ items: await service.listTerms(tenantId(res)) })));
  router.post("/payment-terms", mgr, handler(async (req, res) => res.status(201).json(await service.createTerm(parseBody(termSchema, req.body), tenantId(res)))));

  // Payment modes
  router.get("/payment-modes", handler(async (_req, res) => res.json({ items: await service.listModes(tenantId(res)) })));
  router.post("/payment-modes", mgr, handler(async (req, res) => res.status(201).json(await service.createMode(parseBody(modeSchema, req.body), tenantId(res)))));

  // Tax rates
  router.get("/tax-rates", handler(async (_req, res) => res.json({ items: await service.listTaxRates(tenantId(res)) })));
  router.post("/tax-rates", mgr, handler(async (req, res) => res.status(201).json(await service.createTaxRate(parseBody(taxSchema, req.body), tenantId(res)))));
}
