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

  // GET /api/v1/reports/sales-by-rep?range=… — revenue grouped by sales rep.
  router.get("/sales-by-rep", handler(async (req, res) => {
    res.json({ items: await service.salesByRep(tenantId(res), sinceFromRange(req)) });
  }));

  // GET /api/v1/reports/sales-by-vendor?range=… — revenue grouped by vendor.
  router.get("/sales-by-vendor", handler(async (req, res) => {
    res.json({ items: await service.salesByVendor(tenantId(res), sinceFromRange(req)) });
  }));

  // GET /api/v1/reports/p-l?range=… — P&L: revenue, COGS, gross profit, expenses, net.
  router.get("/p-l", handler(async (req, res) => {
    res.json(await service.pnl(tenantId(res), sinceFromRange(req)));
  }));

  // GET /api/v1/reports/revenue-trend?range=7d|30d|90d — daily revenue series.
  router.get("/revenue-trend", handler(async (req, res) => {
    const r = typeof req.query.range === "string" ? req.query.range : "7d";
    const days: 7 | 30 | 90 = r === "30d" ? 30 : r === "90d" ? 90 : 7;
    res.json({ items: await service.revenueTrend(tenantId(res), days) });
  }));

  // GET /api/v1/reports/aggregate/daily?date=YYYY-MM-DD — compute daily sales aggregate.
  router.get("/aggregate/daily", handler(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
    res.json(await service.aggregateDailySales(tenantId(res), date));
  }));
}
