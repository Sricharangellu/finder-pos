import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { GiftCardsService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const issueSchema = z.object({
  amountCents: z.number().int().positive(),
});

const redeemSchema = z.object({
  amountCents: z.number().int().positive(),
});

export function registerRoutes(router: Router, service: GiftCardsService): void {
  router.post(
    "/",
    handler(async (req, res) => {
      const body = parseBody(issueSchema, req.body);
      const card = await service.issue(body.amountCents, tenantId(res));
      res.status(201).json(card);
    }),
  );

  router.get(
    "/:code",
    handler(async (req, res) => {
      const card = await service.getByCode(String(req.params.code), tenantId(res));
      if (!card) throw notFound(`gift card '${req.params.code}' not found`);
      res.json(card);
    }),
  );

  router.post(
    "/:code/redeem",
    handler(async (req, res) => {
      const body = parseBody(redeemSchema, req.body);
      const result = await service.redeem(String(req.params.code), body.amountCents, tenantId(res));
      res.json(result);
    }),
  );
}
