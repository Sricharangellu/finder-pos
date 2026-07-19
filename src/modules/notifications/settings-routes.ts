import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { NotificationSettingsService } from "./settings.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const prefUpdateSchema = z.array(
  z.object({
    type: z.string().min(1),
    channel: z.enum(["in_app", "email", "sms", "push"]).optional(),
    enabled: z.boolean().optional(),
    min_severity: z.enum(["info", "warning", "critical"]).optional(),
  }),
);

const createRuleSchema = z.object({
  name: z.string().min(1),
  trigger: z.string().min(1),
  condition: z.string().min(1),
  threshold: z.number().nullable().optional(),
  channels: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const updateRuleSchema = z.object({
  name: z.string().min(1).optional(),
  trigger: z.string().min(1).optional(),
  condition: z.string().min(1).optional(),
  threshold: z.number().nullable().optional(),
  channels: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const digestPatchSchema = z.object({
  enabled: z.boolean().optional(),
  frequency: z.enum(["daily", "weekly"]).optional(),
  day_of_week: z.number().int().min(0).max(6).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  include: z.array(z.string()).optional(),
  recipient_emails: z.array(z.string().min(1)).optional(),
});

/**
 * Registers the notifications settings surface (preferences / alert rules /
 * digest config) — a separate route group from the inbox routes in
 * routes.ts, mounted on the same router by index.ts. Reads never 404 on a
 * missing row (preferences/digest read back sensible defaults, matching
 * inventory.getStock's precedent); alert rules are real CRUD.
 */
export function registerSettingsRoutes(router: Router, service: NotificationSettingsService): void {
  // ── Preferences ────────────────────────────────────────────────────────
  router.get(
    "/preferences",
    handler(async (_req, res) => {
      res.json({ items: await service.getPreferences(tenantId(res)) });
    }),
  );

  router.patch(
    "/preferences",
    requireRole("manager"),
    handler(async (req, res) => {
      const updates = parseBody(prefUpdateSchema, req.body);
      await service.updatePreferences(tenantId(res), updates);
      res.json({ ok: true });
    }),
  );

  // ── Alert rules ────────────────────────────────────────────────────────
  router.get(
    "/rules",
    handler(async (_req, res) => {
      res.json({ items: await service.listRules(tenantId(res)) });
    }),
  );

  router.post(
    "/rules",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(createRuleSchema, req.body);
      const rule = await service.createRule(tenantId(res), body);
      res.status(201).json(rule);
    }),
  );

  router.patch(
    "/rules/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(updateRuleSchema, req.body);
      const rule = await service.updateRule(tenantId(res), String(req.params.id), body);
      if (!rule) throw notFound(`alert rule '${req.params.id}' not found`);
      res.json(rule);
    }),
  );

  router.delete(
    "/rules/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      const ok = await service.deleteRule(tenantId(res), String(req.params.id));
      if (!ok) throw notFound(`alert rule '${req.params.id}' not found`);
      res.status(204).end();
    }),
  );

  // ── Digest config ──────────────────────────────────────────────────────
  router.get(
    "/digest",
    handler(async (_req, res) => {
      res.json(await service.getDigest(tenantId(res)));
    }),
  );

  router.patch(
    "/digest",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(digestPatchSchema, req.body);
      res.json(await service.updateDigest(tenantId(res), body));
    }),
  );
}
