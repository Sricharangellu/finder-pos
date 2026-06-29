import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { RentalService, AssetStatus, ContractStatus } from "./service.js";

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const mgr = requireRole("manager");

const createAssetSchema = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().min(1).max(50),
  category: z.string().max(50).optional(),
  dailyRateCents: z.number().int().nonnegative().optional(),
  depositCents: z.number().int().nonnegative().optional(),
  serial: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

const createContractSchema = z.object({
  customerId: z.string().min(1).optional(),
  assetId: z.string().min(1),
  startsAt: z.number().int().positive(),
  endsAt: z.number().int().positive(),
  depositCents: z.number().int().nonnegative().optional(),
  dailyRateCents: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).optional(),
});

export function registerRoutes(router: Router, svc: RentalService): void {
  router.get("/rental/assets", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status as AssetStatus : undefined;
    const items = await svc.listAssets(tid(res), status);
    res.json({ items, total: items.length });
  }));

  router.post("/rental/assets", mgr, handler(async (req, res) => {
    const body = parseBody(createAssetSchema, req.body);
    res.status(201).json(await svc.createAsset(tid(res), body));
  }));

  router.patch("/rental/assets/:id", mgr, handler(async (req, res) => {
    const body = parseBody(createAssetSchema.partial().extend({
      status: z.enum(["available", "rented", "maintenance", "retired"]).optional(),
    }), req.body);
    res.json(await svc.updateAsset(tid(res), String(req.params["id"]), body));
  }));

  router.get("/rental/contracts", handler(async (req, res) => {
    const assetId = typeof req.query.assetId === "string" ? req.query.assetId : undefined;
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status as ContractStatus : undefined;
    const items = await svc.listContracts(tid(res), { assetId, customerId, status });
    res.json({ items, total: items.length });
  }));

  router.post("/rental/contracts", handler(async (req, res) => {
    const body = parseBody(createContractSchema, req.body);
    res.status(201).json(await svc.createContract(tid(res), body));
  }));

  router.get("/rental/contracts/:id", handler(async (req, res) => {
    res.json(await svc.getContract(tid(res), String(req.params["id"])));
  }));

  router.post("/rental/contracts/:id/return", handler(async (req, res) => {
    const body = parseBody(z.object({
      returnDepositCents: z.number().int().nonnegative().optional(),
    }), req.body);
    res.json(await svc.returnAsset(tid(res), String(req.params["id"]), body.returnDepositCents));
  }));
}
