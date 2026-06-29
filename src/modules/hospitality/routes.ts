import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { HospitalityService, RoomStatus } from "./service.js";

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const mgr = requireRole("manager");

const createRoomSchema = z.object({
  roomNumber: z.string().min(1).max(20),
  outletId: z.string().min(1).optional(),
  type: z.string().max(50).optional(),
  floor: z.string().max(20).optional(),
  rateCents: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).optional(),
});

const chargeSchema = z.object({
  description: z.string().min(1).max(200),
  amountCents: z.number().int().positive(),
  orderId: z.string().min(1).optional(),
});

export function registerRoutes(router: Router, svc: HospitalityService): void {
  router.get("/hospitality/rooms", handler(async (req, res) => {
    const outletId = typeof req.query.outletId === "string" ? req.query.outletId : undefined;
    const items = await svc.listRooms(tid(res), outletId);
    res.json({ items, total: items.length });
  }));

  router.post("/hospitality/rooms", mgr, handler(async (req, res) => {
    const body = parseBody(createRoomSchema, req.body);
    res.status(201).json(await svc.createRoom(tid(res), body));
  }));

  router.patch("/hospitality/rooms/:id/status", handler(async (req, res) => {
    const { status } = parseBody(z.object({
      status: z.enum(["available", "occupied", "maintenance", "checkout"]),
    }), req.body);
    res.json(await svc.setRoomStatus(tid(res), String(req.params["id"]), status as RoomStatus));
  }));

  router.post("/hospitality/rooms/:id/charge", handler(async (req, res) => {
    const body = parseBody(chargeSchema, req.body);
    res.status(201).json(await svc.postCharge(tid(res), String(req.params["id"]), body));
  }));

  router.get("/hospitality/rooms/:id/folio", handler(async (req, res) => {
    res.json(await svc.getRoomFolio(tid(res), String(req.params["id"])));
  }));
}
