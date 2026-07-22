import type { Router, Request, Response } from "express";
import { handler } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requirePlan, requireRole } from "../../gateway/auth.js";
import type { ReportsService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

/** Parse+cap a `limit` query param; falls back to `fallback` on missing/invalid (NaN) input. */
function cappedLimit(raw: unknown, fallback: number, max = 500): number {
  const n = typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
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
      const limit = cappedLimit(req.query.limit, 10);
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

  // GET /api/v1/reports/end-of-day?date=YYYY-MM-DD&registerId=… — Z-report:
  // transactions, sales totals, tender breakdown, top items, cash drawer.
  router.get(
    "/end-of-day",
    handler(async (req, res) => {
      const date = typeof req.query.date === "string" ? req.query.date : undefined;
      const registerId = typeof req.query.registerId === "string" ? req.query.registerId : undefined;
      res.json(await service.endOfDay(tenantId(res), date, registerId));
    }),
  );

  // GET /api/v1/reports/retail-proof?recentDays=30 — real-data retail readiness
  // report: setup tasks, metrics, and deterministic rule-based signals.
  router.get("/retail-proof", handler(async (req, res) => {
    const raw = typeof req.query.recentDays === "string" ? Number(req.query.recentDays) : 30;
    const recentDays = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 365) : 30;
    res.json(await service.retailProof(tenantId(res), recentDays));
  }));

  // GET /api/v1/reports/recommendations?recentDays=30 — deterministic, rule-based
  // recommendations ranked most-urgent-first, derived from retail-proof signals.
  router.get("/recommendations", handler(async (req, res) => {
    const raw = typeof req.query.recentDays === "string" ? Number(req.query.recentDays) : 30;
    const recentDays = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 365) : 30;
    res.json(await service.retailRecommendations(tenantId(res), recentDays));
  }));

  // GET /api/v1/reports/ar-aging — Accounts Receivable aging buckets.
  router.get("/ar-aging", handler(async (_req, res) => {
    res.json(await service.arAging(tenantId(res)));
  }));

  // POST /api/v1/reports/ar-aging/sweep — flag overdue invoices with dunning_level.
  // Mutates AR/dunning state, so manager+ only (was unguarded — any cashier could
  // trigger a dunning sweep).
  router.post("/ar-aging/sweep", requireRole("manager"), handler(async (_req, res) => {
    res.json(await service.sweepArAging(tenantId(res)));
  }));

  // GET /api/v1/reports/ap-aging — Accounts Payable aging buckets.
  router.get("/ap-aging", handler(async (_req, res) => {
    res.json(await service.apAging(tenantId(res)));
  }));

  // GET /api/v1/reports/sales-by-category?range=…
  router.get("/sales-by-category", handler(async (req, res) => {
    res.json({ items: await service.salesByCategory(tenantId(res), sinceFromRange(req)) });
  }));

  // GET /api/v1/reports/sales-by-customer?range=…&limit=…
  router.get("/sales-by-customer", handler(async (req, res) => {
    const limit = cappedLimit(req.query.limit, 200);
    res.json({ items: await service.salesByCustomer(tenantId(res), sinceFromRange(req), limit) });
  }));

  // GET /api/v1/reports/inventory-valuation?limit=…&offset=… — on-hand value at cost and retail.
  router.get("/inventory-valuation", handler(async (req, res) => {
    const limit = cappedLimit(req.query.limit, 500);
    const offset = typeof req.query.offset === "string" ? Math.max(0, Number(req.query.offset) || 0) : 0;
    res.json(await service.inventoryValuation(tenantId(res), limit, offset));
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

  // GET /api/v1/reports/sales-by-product?range=…&limit=…
  router.get("/sales-by-product", handler(async (req, res) => {
    const limit = cappedLimit(req.query.limit, 20);
    const items = await service.salesByProduct(tenantId(res), sinceFromRange(req), limit);
    res.json({ items });
  }));

  // GET /api/v1/reports/margin-by-category?range=…
  router.get("/margin-by-category", handler(async (req, res) => {
    const items = await service.marginByCategory(tenantId(res), sinceFromRange(req));
    res.json({ items });
  }));

  // GET /api/v1/reports/aggregate/daily?date=YYYY-MM-DD — compute daily sales aggregate.
  router.get("/aggregate/daily", handler(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
    res.json(await service.aggregateDailySales(tenantId(res), date));
  }));

  // ── BE-36: Register Closures ───────────────────────────────────────────────

  // GET /api/v1/reports/register-closures?registerId=&from=&to=&limit=
  router.get("/register-closures", handler(async (req, res) => {
    const t = tenantId(res);
    const registerId = typeof req.query.registerId === "string" ? req.query.registerId : undefined;
    const from = typeof req.query.from === "string" ? Number(req.query.from) : undefined;
    const to   = typeof req.query.to   === "string" ? Number(req.query.to)   : undefined;
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    res.json({ items: await service.registerClosures(t, { registerId, from, to, limit }) });
  }));

  // GET /api/v1/reports/register-closures/:sessionId — session detail
  router.get("/register-closures/:sessionId", handler(async (req, res) => {
    res.json(await service.registerClosureDetail(tenantId(res), String(req.params.sessionId)));
  }));

  // ── BE-37: Cash Movement ──────────────────────────────────────────────────

  // GET /api/v1/reports/cash-movement?registerId=&sessionId=&from=&to=&limit=
  router.get("/cash-movement", handler(async (req, res) => {
    const t = tenantId(res);
    const registerId = typeof req.query.registerId === "string" ? req.query.registerId : undefined;
    const sessionId  = typeof req.query.sessionId  === "string" ? req.query.sessionId  : undefined;
    const from = typeof req.query.from === "string" ? Number(req.query.from) : undefined;
    const to   = typeof req.query.to   === "string" ? Number(req.query.to)   : undefined;
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    res.json(await service.cashMovement(t, { registerId, sessionId, from, to, limit }));
  }));

  // ── BE-38: Purchase/AP Report ─────────────────────────────────────────────

  // GET /api/v1/reports/purchases?vendorId=&from=&to=&limit= (professional+)
  router.get("/purchases", requirePlan("professional"), handler(async (req, res) => {
    const t = tenantId(res);
    const vendorId = typeof req.query.vendorId === "string" ? req.query.vendorId : undefined;
    const from = typeof req.query.from === "string" ? Number(req.query.from) : undefined;
    const to   = typeof req.query.to   === "string" ? Number(req.query.to)   : undefined;
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    res.json({ items: await service.purchasesReport(t, { vendorId, from, to, limit }) });
  }));

  // ── BE-40: Time Cards report ──────────────────────────────────────────────

  // GET /api/v1/reports/time-cards?employeeId=&from=&to= (growth+)
  router.get("/time-cards", requirePlan("growth"), handler(async (req, res) => {
    const t = tenantId(res);
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const from = typeof req.query.from === "string" ? Number(req.query.from) : undefined;
    const to   = typeof req.query.to   === "string" ? Number(req.query.to)   : undefined;
    res.json(await service.timeCardsReport(t, { employeeId, from, to }));
  }));
}
