import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
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

  router.get(
    "/:id/summary",
    handler(async (req, res) => {
      res.json(await service.summary(String(req.params.id), tenantId(res)));
    }),
  );

  router.post(
    "/:id/redeem",
    handler(async (req, res) => {
      const body = parseBody(redeemSchema, req.body);
      const result = await service.redeem(String(req.params.id), body.points, tenantId(res));
      res.json(result);
    }),
  );
}
