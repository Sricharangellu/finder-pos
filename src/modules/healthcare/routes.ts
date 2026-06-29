import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { HealthcareService } from "./service.js";

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const mgr = requireRole("manager");

const patientSchema = z.object({
  name: z.string().min(1).max(100),
  dob: z.string().optional(),
  gender: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  allergies: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

const prescriptionSchema = z.object({
  drug: z.string().min(1).max(200),
  dosage: z.string().max(100).optional(),
  prescriber: z.string().max(100).optional(),
  refillsTotal: z.number().int().nonnegative().optional(),
  expiryDate: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export function registerRoutes(router: Router, svc: HealthcareService): void {
  router.get("/healthcare/patients", handler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : undefined;
    const items = await svc.listPatients(tid(res), query);
    res.json({ items, total: items.length });
  }));

  router.post("/healthcare/patients", mgr, handler(async (req, res) => {
    const body = parseBody(patientSchema, req.body);
    res.status(201).json(await svc.createPatient(tid(res), body));
  }));

  router.get("/healthcare/patients/:id", handler(async (req, res) => {
    res.json(await svc.getPatient(tid(res), String(req.params["id"])));
  }));

  router.patch("/healthcare/patients/:id", mgr, handler(async (req, res) => {
    const body = parseBody(patientSchema.partial(), req.body);
    res.json(await svc.updatePatient(tid(res), String(req.params["id"]), body));
  }));

  router.get("/healthcare/patients/:id/prescriptions", handler(async (req, res) => {
    const items = await svc.listPrescriptions(tid(res), String(req.params["id"]));
    res.json({ items, total: items.length });
  }));

  router.post("/healthcare/patients/:id/prescriptions", mgr, handler(async (req, res) => {
    const body = parseBody(prescriptionSchema, req.body);
    res.status(201).json(await svc.createPrescription(tid(res), String(req.params["id"]), body));
  }));

  router.post("/healthcare/prescriptions/:id/refill", handler(async (req, res) => {
    res.json(await svc.refillPrescription(tid(res), String(req.params["id"])));
  }));
}
