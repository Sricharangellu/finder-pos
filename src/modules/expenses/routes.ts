import type { Router, Response, Request } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { ExpensesService } from "./service.js";

function auth(res: Response): AuthPayload {
  return res.locals["auth"] as AuthPayload;
}
function tenantId(res: Response): string {
  return auth(res).tenantId;
}
function actorId(res: Response): string {
  return auth(res).userId ?? "unknown";
}
function readInt(v: unknown): number | undefined {
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

const createSchema = z.object({
  amountCents: z.number().int().positive(),
  category: z.string().min(1).max(64).nullable().optional(),
  spentAt: z.number().int().positive().optional(),
  vendor: z.string().max(128).nullable().optional(),
  note: z.string().max(512).nullable().optional(),
  accountId: z.string().min(1).nullable().optional(),
});

const updateSchema = z
  .object({
    amountCents: z.number().int().positive().optional(),
    category: z.string().min(1).max(64).nullable().optional(),
    spentAt: z.number().int().positive().optional(),
    vendor: z.string().max(128).nullable().optional(),
    note: z.string().max(512).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "at least one field is required" });

export function registerRoutes(router: Router, service: ExpensesService): void {
  const mgr = requireRole("manager");

  // POST /api/v1/expenses — record a business expense (manager+). Audited in the service.
  router.post("/", mgr, handler(async (req, res) => {
    const body = parseBody(createSchema, req.body);
    res.status(201).json(await service.create(body, tenantId(res), actorId(res)));
  }));

  // GET /api/v1/expenses?category=&from=&to=&limit=&offset=
  router.get("/", handler(async (req: Request, res) => {
    res.json(await service.list({
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      from: readInt(req.query.from),
      to: readInt(req.query.to),
      limit: readInt(req.query.limit),
      offset: readInt(req.query.offset),
    }, tenantId(res)));
  }));

  // GET /api/v1/expenses/summary?from=&to= — totals + by-category + uncategorized count.
  // Registered before /:id so "summary" is not treated as an id.
  router.get("/summary", handler(async (req: Request, res) => {
    res.json(await service.summary(tenantId(res), readInt(req.query.from), readInt(req.query.to)));
  }));

  router.get("/:id", handler(async (req, res) => {
    res.json(await service.get(String(req.params.id), tenantId(res)));
  }));

  // PATCH /api/v1/expenses/:id — categorize/correct an expense (manager+). Audited in the service.
  router.patch("/:id", mgr, handler(async (req, res) => {
    const body = parseBody(updateSchema, req.body);
    res.json(await service.update(String(req.params.id), body, tenantId(res), actorId(res)));
  }));

  // DELETE /api/v1/expenses/:id — correction (manager+). Audited in the service.
  router.delete("/:id", mgr, handler(async (req, res) => {
    const removed = await service.remove(String(req.params.id), tenantId(res), actorId(res));
    res.json({ ok: true, id: removed.id });
  }));
}
