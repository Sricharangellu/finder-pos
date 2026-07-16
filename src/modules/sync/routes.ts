import type { Router, Request, Response } from "express";
import { z } from "zod";
import { handler, parseBody, badRequest } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { SyncEngine, SyncStatus } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const onlineSchema = z.object({ online: z.boolean() });

const SYNC_STATUSES: readonly SyncStatus[] = ["pending", "synced", "failed"];

function parseInt0(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readQueueQuery(req: Request) {
  let status: SyncStatus | undefined;
  if (typeof req.query.status === "string" && req.query.status !== "") {
    if (!SYNC_STATUSES.includes(req.query.status as SyncStatus)) {
      throw badRequest(
        `invalid status '${req.query.status}'; expected one of ${SYNC_STATUSES.join(", ")}`,
      );
    }
    status = req.query.status as SyncStatus;
  }
  return {
    status,
    limit: parseInt0(req.query.limit),
    offset: parseInt0(req.query.offset),
  };
}

export function registerRoutes(router: Router, engine: SyncEngine): void {
  router.get(
    "/status",
    handler(async (_req, res) => {
      res.json(await engine.status());
    }),
  );

  // Sync controls mutate company-wide state (toggle the engine, force-drain the
  // queue) — manager+ only. Previously unguarded: any cashier could flip a
  // tenant's sync state or drain its queue.
  router.post(
    "/online",
    requireRole("manager"),
    handler(async (req, res) => {
      const { online } = parseBody(onlineSchema, req.body);
      engine.setOnline(online);
      let drained = { attempted: 0, synced: 0, failed: 0 };
      if (online) drained = await engine.pushSync({ forceAll: true });
      res.json({ online: engine.isOnline(), drained, ...(await engine.counts()) });
    }),
  );

  router.post(
    "/push",
    requireRole("manager"),
    handler(async (_req, res) => {
      const result = await engine.pushSync({ forceAll: true });
      res.json({ online: engine.isOnline(), ...result, ...(await engine.counts()) });
    }),
  );

  router.get(
    "/queue",
    handler(async (req, res) => {
      res.json(await engine.list(readQueueQuery(req)));
    }),
  );

  router.post(
    "/pull",
    requireRole("manager"),
    handler((_req, res) => {
      res.json({ pulled: 0, note: "pull sync stub — Year 2" });
    }),
  );

  // Import/Export batch tracking
  router.get("/import-batches", handler(async (_req, res) => {
    res.json({ items: await engine.listImportBatches(tenantId(res)) });
  }));

  router.get("/export-batches", handler(async (_req, res) => {
    res.json({ items: await engine.listExportBatches(tenantId(res)) });
  }));

  // Integration providers (catalogue — public to tenant)
  router.get("/integration-providers", handler(async (_req, res) => {
    res.json({ items: await engine.listIntegrationProviders() });
  }));

  // Company integrations
  router.get("/integrations", handler(async (_req, res) => {
    res.json({ items: await engine.listCompanyIntegrations(tenantId(res)) });
  }));

  // Connecting/configuring a third-party integration (may carry credentials in
  // settings) is owner-level, matching the webhooks module's external-config
  // guard. Was unguarded.
  router.post("/integrations", requireRole("owner"), handler(async (req, res) => {
    const body = parseBody(z.object({ providerId: z.string().min(1), status: z.string().optional(), settings: z.string().nullable().optional() }), req.body);
    const id = await engine.upsertCompanyIntegration(tenantId(res), body.providerId, body.status ?? 'inactive', body.settings);
    res.status(201).json({ id });
  }));
}
