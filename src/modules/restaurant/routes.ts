import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { RestaurantService, TableStatus } from "./service.js";

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const mgr = requireRole("manager");

const createTableSchema = z.object({
  tableNumber: z.string().min(1).max(20),
  capacity:    z.number().int().positive().max(100),
  outletId:    z.string().min(1).optional(),
  floorSection:z.string().max(50).optional(),
});

const openSessionSchema = z.object({
  partySize: z.number().int().positive().default(1),
  serverId:  z.string().min(1).optional(),
  notes:     z.string().max(300).optional(),
});

const openTabSchema = z.object({
  tableId:      z.string().min(1).optional(),
  sessionId:    z.string().min(1).optional(),
  customerName: z.string().max(100).optional(),
});

export function registerRoutes(router: Router, svc: RestaurantService): void {

  // ── Tables ────────────────────────────────────────────────────────────────

  router.get("/restaurant/tables", handler(async (req, res) => {
    const outletId = typeof req.query.outletId === "string" ? req.query.outletId : undefined;
    res.json({ items: await svc.listTables(tid(res), outletId) });
  }));

  router.post("/restaurant/tables", mgr, handler(async (req, res) => {
    const body = parseBody(createTableSchema, req.body);
    res.status(201).json(await svc.createTable(tid(res), body));
  }));

  router.patch("/restaurant/tables/:id/status", handler(async (req, res) => {
    const { status } = parseBody(z.object({ status: z.enum(["available","occupied","reserved","cleaning"]) }), req.body);
    res.json(await svc.setTableStatus(String(req.params["id"]), tid(res), status as TableStatus));
  }));

  router.post("/restaurant/tables/:id/open-session", handler(async (req, res) => {
    const body = parseBody(openSessionSchema, req.body);
    res.status(201).json(await svc.openSession(String(req.params["id"]), tid(res), { partySize: body.partySize ?? 1, serverId: body.serverId, notes: body.notes }));
  }));

  router.post("/restaurant/sessions/:id/close", handler(async (req, res) => {
    res.json(await svc.closeSession(String(req.params["id"]), tid(res)));
  }));

  // ── Bar Tabs ───────────────────────────────────────────────────────────────

  router.get("/restaurant/tabs", handler(async (req, res) => {
    const status = req.query.status === "closed" ? "closed" : req.query.status === "open" ? "open" : undefined;
    res.json({ items: await svc.listTabs(tid(res), status as "open" | "closed" | undefined) });
  }));

  router.post("/restaurant/tabs", handler(async (req, res) => {
    const body = parseBody(openTabSchema, req.body);
    res.status(201).json(await svc.openTab(tid(res), body));
  }));

  router.post("/restaurant/tabs/:id/add-round", handler(async (req, res) => {
    const { orderId } = parseBody(z.object({ orderId: z.string().min(1) }), req.body);
    await svc.addRoundToTab(String(req.params["id"]), orderId, tid(res));
    res.json({ ok: true });
  }));

  router.post("/restaurant/tabs/:id/close", handler(async (req, res) => {
    res.json(await svc.closeTab(String(req.params["id"]), tid(res)));
  }));
}
