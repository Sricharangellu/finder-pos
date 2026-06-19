import type { Router, Request, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound, badRequest } from "../../shared/http.js";
import type { OrdersService, OrderStatus } from "./service.js";
import type { AuthPayload } from "../../gateway/auth.js";

const stateSchema = z.enum(["CA", "NY", "TX", "FL"]);

const ORDER_STATUSES: readonly OrderStatus[] = ["open", "completed", "refunded", "voided"];

function readStatusFilter(value: unknown): OrderStatus | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (!ORDER_STATUSES.includes(value as OrderStatus)) {
    throw badRequest(
      `invalid status '${value}'; expected one of ${ORDER_STATUSES.join(", ")}`,
    );
  }
  return value as OrderStatus;
}

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  ageVerified: z.boolean().optional(),
});

const createSchema = z.object({
  stateCode: stateSchema.optional(), // optional — POS terminal doesn't send it; defaults to "CA"
  lines: z.array(lineSchema).min(1),
  discountCents: z.number().int().nonnegative().optional(),
  customerId: z.string().min(1).nullable().optional(),
  storeId: z.string().min(1).nullable().optional(),
});

const updateSchema = z.object({
  lines: z.array(lineSchema).min(1),
  discountCents: z.number().int().nonnegative().optional(),
  customerId: z.string().min(1).nullable().optional(),
  storeId: z.string().min(1).nullable().optional(),
});

function parseInt0(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function auth(res: Response): AuthPayload {
  return res.locals["auth"] as AuthPayload;
}

export function registerRoutes(router: Router, service: OrdersService): void {
  router.post(
    "/",
    handler(async (req: Request, res: Response) => {
      const body = parseBody(createSchema, req.body);
      const { storeIds } = auth(res);
      // If the user is scoped to specific stores and a storeId is provided, validate it.
      if (body.storeId && storeIds.length > 0 && !storeIds.includes(body.storeId)) {
        throw badRequest(`storeId '${body.storeId}' is not in your allowed stores`);
      }
      const order = await service.create(body, tenantId(res));
      res.status(201).json(order);
    }),
  );

  router.get(
    "/",
    handler(async (req: Request, res: Response) => {
      const status = readStatusFilter(req.query.status);
      const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
      const { storeIds } = auth(res);
      const requestedStore = typeof req.query.storeId === "string" && req.query.storeId !== "" ? req.query.storeId : undefined;
      // Users scoped to specific stores cannot query outside their allowed set.
      if (requestedStore && storeIds.length > 0 && !storeIds.includes(requestedStore)) {
        throw badRequest(`storeId '${requestedStore}' is not in your allowed stores`);
      }
      // If the user has store restrictions and no specific store filter was requested,
      // implicitly restrict to their first allowed store (prevents cross-store data leak).
      const storeId = requestedStore ?? (storeIds.length === 1 ? storeIds[0] : requestedStore);
      const page = await service.list(
        {
          status,
          limit: parseInt0(req.query.limit),
          offset: parseInt0(req.query.offset),
          cursor,
          storeId,
        },
        tenantId(res),
      );
      res.json(page);
    }),
  );

  router.get(
    "/:id",
    handler(async (req: Request, res: Response) => {
      const id = String(req.params.id);
      const order = await service.get(id, tenantId(res));
      if (!order) throw notFound(`order '${id}' not found`);
      res.json(order);
    }),
  );

  // PUT /:id — replace cart lines (used by POS terminal on every cart change).
  router.put(
    "/:id",
    handler(async (req: Request, res: Response) => {
      const body = parseBody(updateSchema, req.body);
      res.json(await service.update(String(req.params.id), body, tenantId(res)));
    }),
  );

  router.post(
    "/:id/refund",
    handler(async (req: Request, res: Response) => {
      res.json(await service.refund(String(req.params.id), tenantId(res)));
    }),
  );

  router.post(
    "/:id/void",
    handler(async (req: Request, res: Response) => {
      res.json(await service.void(String(req.params.id), tenantId(res)));
    }),
  );
}
