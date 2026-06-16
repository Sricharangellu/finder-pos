import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { CustomersService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
});

const redeemSchema = z.object({
  points: z.number().int().positive(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
  tier: z.number().int().min(1).max(5).optional(),
  company: z.string().nullable().optional(),
  dba: z.string().nullable().optional(),
  taxId: z.string().nullable().optional(),
  licenseNo: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  billingAddress: z.string().nullable().optional(),
  shippingAddress: z.string().nullable().optional(),
  salesRepId: z.string().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  verified: z.boolean().optional(),
});

export function registerRoutes(router: Router, service: CustomersService): void {
  router.post(
    "/",
    handler(async (req, res) => {
      const body = parseBody(createSchema, req.body);
      const customer = await service.create(body, tenantId(res));
      res.status(201).json(customer);
    }),
  );

  router.get(
    "/",
    handler(async (_req, res) => {
      res.json({ items: await service.list(tenantId(res)) });
    }),
  );

  router.get(
    "/:id",
    handler(async (req, res) => {
      const customer = await service.get(String(req.params.id), tenantId(res));
      if (!customer) throw notFound(`customer '${req.params.id}' not found`);
      res.json(customer);
    }),
  );

  router.patch(
    "/:id",
    handler(async (req, res) => {
      const body = parseBody(updateSchema, req.body);
      res.json(await service.update(String(req.params.id), body, tenantId(res)));
    }),
  );

  router.get(
    "/:id/summary",
    handler(async (req, res) => {
      res.json(await service.summary(String(req.params.id), tenantId(res)));
    }),
  );

  router.get(
    "/:id/financials",
    handler(async (req, res) => {
      res.json(await service.financials(String(req.params.id), tenantId(res)));
    }),
  );

  router.post(
    "/:id/redeem",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(redeemSchema, req.body);
      const result = await service.redeem(String(req.params.id), body.points, tenantId(res));
      res.json(result);
    }),
  );
}
