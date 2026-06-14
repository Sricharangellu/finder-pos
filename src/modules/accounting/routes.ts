import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { AccountingService, AccountType, DepositStatus } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const accountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["asset", "liability", "income", "expense"]),
  parentId: z.string().min(1).optional(),
});
const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});
const depositSchema = z.object({
  accountId: z.string().min(1),
  description: z.string().optional(),
  paymentIds: z.array(z.string().min(1)).min(1),
  depositDate: z.number().int().positive().optional(),
});

export function registerRoutes(router: Router, service: AccountingService): void {
  // ── Chart of Accounts ──────────────────────────────────────────────────
  router.post("/accounts", handler(async (req, res) => {
    res.status(201).json(await service.createAccount(parseBody(accountSchema, req.body), tenantId(res)));
  }));
  router.post("/accounts/seed", handler(async (_req, res) => {
    res.json(await service.seedDefaults(tenantId(res)));
  }));
  router.get("/accounts", handler(async (req, res) => {
    const type = typeof req.query.type === "string" ? (req.query.type as AccountType) : undefined;
    res.json({ items: await service.listAccounts(tenantId(res), type) });
  }));
  router.get("/accounts/tree", handler(async (_req, res) => {
    res.json({ items: await service.tree(tenantId(res)) });
  }));
  router.patch("/accounts/:id", handler(async (req, res) => {
    res.json(await service.updateAccount(String(req.params.id), parseBody(updateAccountSchema, req.body), tenantId(res)));
  }));

  // ── Batch Deposits ─────────────────────────────────────────────────────
  router.post("/deposits", handler(async (req, res) => {
    res.status(201).json(await service.createDeposit(parseBody(depositSchema, req.body), tenantId(res)));
  }));
  router.get("/deposits", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? (req.query.status as DepositStatus) : undefined;
    res.json({ items: await service.listDeposits(tenantId(res), status) });
  }));
  router.get("/deposits/:id", handler(async (req, res) => {
    res.json(await service.getDeposit(String(req.params.id), tenantId(res)));
  }));
  router.post("/deposits/:id/approve", handler(async (req, res) => {
    res.json(await service.approveDeposit(String(req.params.id), tenantId(res)));
  }));
  router.post("/deposits/:id/reject", handler(async (req, res) => {
    res.json(await service.rejectDeposit(String(req.params.id), tenantId(res)));
  }));
}
