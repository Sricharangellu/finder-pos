import express, { Router, type Express } from "express";
import { openDb, type DB } from "./shared/db.js";
import { EventBus } from "./shared/events.js";
import { errorMiddleware } from "./shared/http.js";
import { modules } from "./modules/index.js";
import { identityModule } from "./identity/index.js";
import {
  requestIdMiddleware,
  rateLimitMiddleware,
  tenantRateLimitMiddleware,
  authMiddleware,
  tenantResolver,
  errorEnvelopeMiddleware,
  metricsMiddleware,
  renderMetrics,
} from "./gateway/index.js";
import { handler } from "./shared/http.js";

export interface App {
  express: Express;
  db: DB;
  events: EventBus;
}

export interface BuildAppOptions {
  connectionString?: string;
  schema?: string;
}

/**
 * Assemble the modular monolith: open the (Postgres) DB, run every module's
 * migrations, then register each module's routes under /api/<name>.
 * Wave 0: gateway middleware + identity module + health probes + feature flags.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<App> {
  const schema = options.schema ?? "public";
  const db = openDb({ connectionString: options.connectionString, schema });
  const events = new EventBus();
  const app = express();
  app.use(express.json());

  await db.exec(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

  // ── Identity migrations run first (platform tables: tenants, users, audit_log, etc.)
  for (const sql of identityModule.migrations) await db.exec(sql);

  // ── Domain module migrations
  for (const mod of modules) {
    for (const sql of mod.migrations) await db.exec(sql);
  }

  // ── Global gateway middleware (applied before all /api routes)
  app.use(requestIdMiddleware);
  app.use(metricsMiddleware);
  app.use(rateLimitMiddleware({ capacity: 120, refillRate: 40 }));

  // ── Liveness + readiness probes (no auth — infrastructure-level)
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", ts: Date.now() });
  });

  // ── Prometheus metrics (no auth — scrape target; RED metrics per route)
  app.get("/metrics", (_req, res) => {
    res.set("content-type", "text/plain; version=0.0.4").send(renderMetrics());
  });

  // ── Service health (documented in README; lists the domain modules)
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      modules: modules.map((m) => m.name),
      ts: Date.now(),
    });
  });

  app.get("/readyz", handler(async (_req, res) => {
    await db.one("SELECT 1");
    res.json({
      status: "ok",
      db: "connected",
      modules: ["identity", ...modules.map((m) => m.name)],
      ts: Date.now(),
    });
  }));

  // ── Identity routes (/api/identity/login and /refresh are PUBLIC; /me is protected)
  // Security: public auth endpoints are brute-force surfaces, so apply a strict
  // per-IP limiter (≈20/min sustained, small burst) in front of the router.
  const identityRouter = Router();
  await identityModule.register({ db, events, router: identityRouter });
  app.use("/api/identity", rateLimitMiddleware({ capacity: 10, refillRate: 0.33 }), identityRouter);

  // ── Auth + per-tenant tiered rate limit applied to all /api/v1/* routes
  app.use("/api/v1", authMiddleware, tenantResolver, tenantRateLimitMiddleware());

  // ── Feature flags (tenant-scoped, requires auth)
  app.get(
    "/api/v1/flags",
    handler(async (_req, res) => {
      const auth = res.locals["auth"] as { tenantId: string } | undefined;
      const tenantId = auth?.tenantId;
      // Return global flags + tenant-overrides (tenant row wins over global row).
      const flags = await db.query<{ flag_key: string; enabled: boolean }>(
        `SELECT flag_key, enabled FROM feature_flags
         WHERE tenant_id IS NULL OR tenant_id = @tenantId
         ORDER BY tenant_id NULLS FIRST`,
        { tenantId: tenantId ?? "" },
      );
      // Merge: tenant row overrides global row for the same key.
      const map = new Map<string, boolean>();
      for (const f of flags) {
        map.set(f.flag_key, f.enabled);
      }
      res.json(Object.fromEntries(map));
    }),
  );

  // ── Domain modules (mounted under /api/<name>; auth applied via /api/v1 prefix below)
  for (const mod of modules) {
    const router = Router();
    await mod.register({ db, events, router });
    app.use(`/api/v1/${mod.name}`, router);
  }

  // ── Root info
  app.get("/", (_req, res) => {
    res.json({
      service: "finder-pos",
      status: "ok",
      storage: "postgres",
      modules: ["identity", ...modules.map((m) => m.name)],
      endpoints: [
        "/health",
        "/healthz",
        "/readyz",
        "/api/identity/login",
        "/api/identity/refresh",
        "/api/v1/flags",
        "/api/catalog",
        "/api/inventory",
        "/api/orders",
        "/api/payments",
        "/api/sync",
      ],
    });
  });

  // ── Error handling (errorEnvelope must be last)
  app.use(errorMiddleware);
  app.use(errorEnvelopeMiddleware);

  return { express: app, db, events };
}
