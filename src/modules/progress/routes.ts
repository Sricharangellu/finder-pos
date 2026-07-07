import type { Router, Request, Response } from "express";
import { z } from "zod";
import { requireRole, type AuthPayload } from "../../gateway/auth.js";
import { handler, parseBody } from "../../shared/http.js";
import type { ProgressService, ProgressStatus } from "./service.js";

function auth(res: Response): AuthPayload {
  return res.locals["auth"] as AuthPayload;
}
function tenantId(res: Response): string {
  return auth(res).tenantId;
}
function actorId(res: Response): string {
  return auth(res).userId ?? "unknown";
}

const statusSchema = z.enum([
  "not_started",
  "planned",
  "in_progress",
  "self_reported_done",
  "evidence_attached",
  "system_verified",
  "validated",
  "invalidated",
  "blocked",
  "skipped",
]);

const createHypothesisSchema = z.object({
  statement: z.string().min(3).max(1000),
  category: z.string().min(1).max(80).optional(),
  confidenceScore: z.number().int().min(0).max(100).optional(),
  successCriteria: z.string().max(2000).nullable().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(3).max(240),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().min(1).max(80).optional(),
  hypothesisId: z.string().min(1).nullable().optional(),
  verificationSource: z.string().min(1).max(80).nullable().optional(),
  dueAt: z.number().int().positive().nullable().optional(),
});

const updateTaskStatusSchema = z.object({ status: statusSchema });

const createEvidenceSchema = z.object({
  taskId: z.string().min(1).nullable().optional(),
  hypothesisId: z.string().min(1).nullable().optional(),
  evidenceType: z.string().min(1).max(80).optional(),
  title: z.string().min(3).max(240),
  url: z.string().url().max(1000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  source: z.string().min(1).max(80).optional(),
});

const createDecisionSchema = z.object({
  decision: z.enum(["validated", "invalidated"]),
  reason: z.string().max(2000).nullable().optional(),
  nextAction: z.string().max(1000).nullable().optional(),
});

export function registerRoutes(router: Router, service: ProgressService): void {
  const mgr = requireRole("manager");

  router.get("/summary", handler(async (_req, res) => {
    res.json(await service.summary(tenantId(res)));
  }));

  router.get("/hypotheses", handler(async (_req, res) => {
    res.json(await service.listHypotheses(tenantId(res)));
  }));

  router.post("/hypotheses", mgr, handler(async (req, res) => {
    const body = parseBody(createHypothesisSchema, req.body);
    res.status(201).json(await service.createHypothesis(body, tenantId(res), actorId(res)));
  }));

  router.post("/hypotheses/:id/decisions", mgr, handler(async (req, res) => {
    const body = parseBody(createDecisionSchema, req.body);
    res.status(201).json(await service.createDecision({
      hypothesisId: String(req.params.id),
      decision: body.decision,
      reason: body.reason,
      nextAction: body.nextAction,
    }, tenantId(res), actorId(res)));
  }));

  router.get("/tasks", handler(async (req: Request, res) => {
    const raw = typeof req.query.status === "string" ? req.query.status : undefined;
    const parsed = raw ? statusSchema.parse(raw) as ProgressStatus : undefined;
    res.json(await service.listTasks(tenantId(res), parsed));
  }));

  router.post("/tasks", mgr, handler(async (req, res) => {
    const body = parseBody(createTaskSchema, req.body);
    res.status(201).json(await service.createTask(body, tenantId(res), actorId(res)));
  }));

  router.patch("/tasks/:id/status", mgr, handler(async (req, res) => {
    const body = parseBody(updateTaskStatusSchema, req.body);
    res.json(await service.updateTaskStatus(String(req.params.id), tenantId(res), actorId(res), body.status));
  }));

  router.post("/tasks/:id/evidence", mgr, handler(async (req, res) => {
    const body = parseBody(createEvidenceSchema, { ...req.body, taskId: String(req.params.id) });
    res.status(201).json(await service.addEvidence(body, tenantId(res), actorId(res)));
  }));

  router.post("/tasks/:id/system-verify", mgr, handler(async (req, res) => {
    res.json(await service.systemVerifyTask(String(req.params.id), tenantId(res), actorId(res)));
  }));

  router.post("/evidence", mgr, handler(async (req, res) => {
    const body = parseBody(createEvidenceSchema, req.body);
    res.status(201).json(await service.addEvidence(body, tenantId(res), actorId(res)));
  }));
}
