import type { Router, Request, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { EcommerceService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

/** Map a `range` query param (today | 7d | 30d | all) to an epoch-ms lower bound. */
function sinceFromRange(req: Request): number | undefined {
  const range = typeof req.query.range === "string" ? req.query.range : "all";
  const now = Date.now();
  const DAY = 86_400_000;
  switch (range) {
    case "today": {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    }
    case "7d": return now - 7 * DAY;
    case "30d": return now - 30 * DAY;
    default: return undefined; // all-time
  }
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
  // Publishing/unpublishing a product to the storefront is a merchandising
  // decision — manager+ only (was unguarded; /checkout below stays open for the
  // customer-facing storefront).
  router.put("/products/:productId/online", requireRole("manager"), handler(async (req, res) => {
    const b = parseBody(onlineSchema, req.body);
    res.json(await service.setOnline(String(req.params.productId), b.online, tenantId(res)));
  }));
  router.post("/checkout", handler(async (req, res) => {
    res.status(201).json(await service.checkout(parseBody(checkoutSchema, req.body), tenantId(res)));
  }));
  router.get("/portal/:customerId/orders", handler(async (req, res) => {
    res.json(await service.portal(String(req.params.customerId), tenantId(res)));
  }));
  // GET /api/v1/ecommerce/orders?range=today|7d|30d — all online orders (admin view)
  router.get("/orders", handler(async (req, res) => {
    const since = sinceFromRange(req);
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
    res.json({ items: await service.orders(tenantId(res), since, limit) });
  }));
}
