import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { LoyaltyService } from "./service.js";
import type { EventBus } from "../../shared/events.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function readInt(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

const tierSchema = z.object({
  name: z.string().min(1).max(100),
  level: z.enum(["bronze", "silver", "gold", "platinum"]),
  points_required: z.number().int().min(0),
  discount_pct: z.number().min(0).max(100),
  description: z.string().max(500).nullable().optional(),
});

const rewardSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  points_cost: z.number().int().min(1),
  discount_cents: z.number().int().min(0),
  status: z.enum(["active", "inactive", "archived"]).optional(),
});

const adjustSchema = z.object({
  delta: z.number().int(),
  reason: z.string().max(255).optional(),
});

export function registerRoutes(router: Router, service: LoyaltyService, events: EventBus): void {
  // ── Tiers ──────────────────────────────────────────────────────────────────

  router.get(
    "/tiers",
    handler(async (_req, res) => {
      const items = await service.listTiers(tenantId(res));
      res.json({ items });
    }),
  );

  router.post(
    "/tiers",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(tierSchema, req.body);
      const tier = await service.createTier(tenantId(res), body);
      res.status(201).json(tier);
    }),
  );

  router.patch(
    "/tiers/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(tierSchema.partial(), req.body);
      const tier = await service.updateTier(String(req.params.id), tenantId(res), body);
      if (!tier) throw notFound(`tier '${req.params.id}' not found`);
      res.json(tier);
    }),
  );

  router.delete(
    "/tiers/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      const ok = await service.deleteTier(String(req.params.id), tenantId(res));
      if (!ok) throw notFound(`tier '${req.params.id}' not found`);
      res.status(204).end();
    }),
  );

  // ── Members ────────────────────────────────────────────────────────────────

  router.get(
    "/members",
    handler(async (req, res) => {
      const result = await service.listMembers(tenantId(res), {
        tier_id: req.query.tier_id ? String(req.query.tier_id) : undefined,
        limit: readInt(req.query.limit, 50),
        offset: readInt(req.query.offset, 0),
      });
      res.json(result);
    }),
  );

  router.get(
    "/members/:id",
    handler(async (req, res) => {
      const member = await service.getMember(String(req.params.id), tenantId(res));
      if (!member) throw notFound(`member '${req.params.id}' not found`);
      res.json(member);
    }),
  );

  router.post(
    "/members/:id/adjust",
    requireRole("manager"),
    handler(async (req, res) => {
      const { delta } = parseBody(adjustSchema, req.body);
      const member = await service.adjustPoints(String(req.params.id), tenantId(res), delta, events);
      if (!member) throw notFound(`member '${req.params.id}' not found`);
      res.json(member);
    }),
  );

  // ── Rewards ────────────────────────────────────────────────────────────────

  router.get(
    "/rewards",
    handler(async (req, res) => {
      const result = await service.listRewards(tenantId(res), {
        status: req.query.status ? String(req.query.status) : undefined,
        limit: readInt(req.query.limit, 50),
        offset: readInt(req.query.offset, 0),
      });
      res.json(result);
    }),
  );

  router.post(
    "/rewards",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(rewardSchema, req.body);
      const reward = await service.createReward(tenantId(res), body);
      res.status(201).json(reward);
    }),
  );

  router.patch(
    "/rewards/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(rewardSchema.partial(), req.body);
      const reward = await service.updateReward(String(req.params.id), tenantId(res), body);
      if (!reward) throw notFound(`reward '${req.params.id}' not found`);
      res.json(reward);
    }),
  );

  router.delete(
    "/rewards/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      const ok = await service.deleteReward(String(req.params.id), tenantId(res));
      if (!ok) throw notFound(`reward '${req.params.id}' not found`);
      res.status(204).end();
    }),
  );
}
