import type { Router, Request, Response } from "express";
import { handler } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { ReportsService } from "./service.js";

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

export function registerRoutes(router: Router, service: ReportsService): void {
  // GET /api/v1/reports/summary?range=today|7d|30d|all
  router.get(
    "/summary",
    handler(async (req, res) => {
      res.json(await service.salesSummary(tenantId(res), sinceFromRange(req)));
    }),
  );

  // GET /api/v1/reports/top-products?range=…&limit=…
  router.get(
    "/top-products",
    handler(async (req, res) => {
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 10;
      res.json({ items: await service.topProducts(tenantId(res), sinceFromRange(req), limit) });
    }),
  );

  // GET /api/v1/reports/hourly?range=… — sales bucketed by hour of day.
  router.get(
    "/hourly",
    handler(async (req, res) => {
      res.json({ items: await service.hourly(tenantId(res), sinceFromRange(req)) });
    }),
  );

  // GET /api/v1/reports/ar-aging — Accounts Receivable aging buckets.
  router.get("/ar-aging", handler(async (_req, res) => {
    res.json(await service.arAging(tenantId(res)));
  }));

  // GET /api/v1/reports/ap-aging — Accounts Payable aging buckets.
  router.get("/ap-aging", handler(async (_req, res) => {
    res.json(await service.apAging(tenantId(res)));
  }));

  // GET /api/v1/reports/sales-by-category?range=…
  router.get("/sales-by-category", handler(async (req, res) => {
    res.json({ items: await service.salesByCategory(tenantId(res), sinceFromRange(req)) });
  }));

  // GET /api/v1/reports/sales-by-customer?range=…
  router.get("/sales-by-customer", handler(async (req, res) => {
    res.json({ items: await service.salesByCustomer(tenantId(res), sinceFromRange(req)) });
  }));

  // GET /api/v1/reports/inventory-valuation — on-hand value at cost and retail.
  router.get("/inventory-valuation", handler(async (_req, res) => {
    res.json(await service.inventoryValuation(tenantId(res)));
  }));
}
