import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { EcommerceService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const onlineSchema = z.object({ online: z.boolean() });
const checkoutSchema = z.object({
  customerId: z.string().min(1),
  lines: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().positive(),
    unitCents: z.number().int().nonnegative().optional(),
  })).min(1),
});

export function registerRoutes(router: Router, service: EcommerceService): void {
  router.get("/catalog", handler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    res.json({ items: await service.catalog(tenantId(res), query, category) });
  }));
  router.put("/products/:productId/online", handler(async (req, res) => {
    const b = parseBody(onlineSchema, req.body);
    res.json(await service.setOnline(String(req.params.productId), b.online, tenantId(res)));
  }));
  router.post("/checkout", handler(async (req, res) => {
    res.status(201).json(await service.checkout(parseBody(checkoutSchema, req.body), tenantId(res)));
  }));
  router.get("/portal/:customerId/orders", handler(async (req, res) => {
    res.json(await service.portal(String(req.params.customerId), tenantId(res)));
  }));
}
