import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { AccountingService, AccountType, DepositStatus } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function readInt(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
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
// Simpler schema used by the Settings → Deposits UI (no payment IDs required).
const manualDepositSchema = z.object({
  totalCents: z.number().int().positive(),
  note: z.string().optional(),
  accountId: z.string().min(1).optional(),
});

export function registerRoutes(router: Router, service: AccountingService): void {
  const mgr = requireRole("manager");

  // ── Posting ledger ─────────────────────────────────────────────────────
  // Read-only surface: postings are created by event subscribers (and the
  // manual endpoint below); journal rows are never updated or deleted.
  router.get("/journal", handler(async (req, res) => {
    const q = req.query;
    // Returns { items, nextCursor, limit } — additive to the prior { items }.
    // Pass ?cursor=<nextCursor> to page deeper into ledger history.
    res.json(
      await service.listJournal(tenantId(res), {
        docType: typeof q.docType === "string" ? q.docType : undefined,
        docId: typeof q.docId === "string" ? q.docId : undefined,
        accountCode: typeof q.accountCode === "string" ? q.accountCode : undefined,
        limit: typeof q.limit === "string" ? Number(q.limit) : undefined,
        cursor: typeof q.cursor === "string" && q.cursor !== "" ? q.cursor : undefined,
      }),
    );
  }));

  router.get("/trial-balance", handler(async (_req, res) => {
    res.json(await service.trialBalance(tenantId(res)));
  }));

  // Manual journal transaction (adjustments/reversals) — manager+.
  const journalSchema = z.object({
    memo: z.string().max(300).optional(),
    legs: z.array(z.object({
      accountCode: z.string().min(1),
      debitCents: z.number().int().nonnegative().optional(),
      creditCents: z.number().int().nonnegative().optional(),
    })).min(2).max(20),
  });
  router.post("/journal", mgr, handler(async (req, res) => {
    const b = parseBody(journalSchema, req.body);
    res.status(201).json({ items: await service.postTransaction("manual", null, b.legs, tenantId(res), b.memo) });
  }));

  // ── Chart of Accounts ──────────────────────────────────────────────────
  router.post("/accounts", mgr, handler(async (req, res) => {
    res.status(201).json(await service.createAccount(parseBody(accountSchema, req.body), tenantId(res)));
  }));
  router.post("/accounts/seed", mgr, handler(async (_req, res) => {
    res.json(await service.seedDefaults(tenantId(res)));
  }));
  router.get("/accounts", handler(async (req, res) => {
    const type = typeof req.query.type === "string" ? (req.query.type as AccountType) : undefined;
    res.json({ items: await service.listAccounts(tenantId(res), type) });
  }));
  router.get("/accounts/tree", handler(async (_req, res) => {
    res.json({ items: await service.tree(tenantId(res)) });
  }));
  router.patch("/accounts/:id", mgr, handler(async (req, res) => {
    res.json(await service.updateAccount(String(req.params.id), parseBody(updateAccountSchema, req.body), tenantId(res)));
  }));

  // ── Batch Deposits ─────────────────────────────────────────────────────
  router.post("/deposits", mgr, handler(async (req, res) => {
    // Dispatch: Settings UI sends { totalCents, note }; API clients send { accountId, paymentIds[] }.
    if (typeof (req.body as Record<string, unknown>).totalCents === "number") {
      res.status(201).json(await service.createManualDeposit(parseBody(manualDepositSchema, req.body), tenantId(res)));
    } else {
      res.status(201).json(await service.createDeposit(parseBody(depositSchema, req.body), tenantId(res)));
    }
  }));
  router.get("/deposits", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? (req.query.status as DepositStatus) : undefined;
    const limit = readInt(req.query.limit, 500);
    const offset = readInt(req.query.offset, 0);
    res.json({ items: await service.listDeposits(tenantId(res), { status, limit, offset }) });
  }));
  router.get("/deposits/:id", handler(async (req, res) => {
    res.json(await service.getDeposit(String(req.params.id), tenantId(res)));
  }));
  // Financial control: deposit approval/rejection requires manager+.
  router.post("/deposits/:id/approve", requireRole("manager"), handler(async (req, res) => {
    res.json(await service.approveDeposit(String(req.params.id), tenantId(res)));
  }));
  router.post("/deposits/:id/reject", requireRole("manager"), handler(async (req, res) => {
    res.json(await service.rejectDeposit(String(req.params.id), tenantId(res)));
  }));
}
