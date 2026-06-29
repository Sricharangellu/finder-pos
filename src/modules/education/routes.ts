import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { EducationService, StudentStatus } from "./service.js";

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const mgr = requireRole("manager");

const studentSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  dateOfBirth: z.string().optional(),
  courseId: z.string().min(1).optional(),
  enrolledAt: z.number().int().positive().optional(),
  notes: z.string().max(500).optional(),
});

const feeSchema = z.object({
  description: z.string().min(1).max(200),
  amountCents: z.number().int().positive(),
  dueDate: z.string().optional(),
});

export function registerRoutes(router: Router, svc: EducationService): void {
  router.get("/education/students", handler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status as StudentStatus : undefined;
    const items = await svc.listStudents(tid(res), status);
    res.json({ items, total: items.length });
  }));

  router.post("/education/students", mgr, handler(async (req, res) => {
    const body = parseBody(studentSchema, req.body);
    res.status(201).json(await svc.createStudent(tid(res), body));
  }));

  router.patch("/education/students/:id", mgr, handler(async (req, res) => {
    const body = parseBody(studentSchema.partial().extend({
      status: z.enum(["active", "inactive", "graduated"]).optional(),
    }), req.body);
    res.json(await svc.updateStudent(tid(res), String(req.params["id"]), body));
  }));

  router.get("/education/students/:id/fees", handler(async (req, res) => {
    const items = await svc.listFees(tid(res), String(req.params["id"]));
    res.json({ items, total: items.length });
  }));

  router.post("/education/students/:id/fees", mgr, handler(async (req, res) => {
    const body = parseBody(feeSchema, req.body);
    res.status(201).json(await svc.createFee(tid(res), String(req.params["id"]), body));
  }));

  router.post("/education/fees/:id/pay", handler(async (req, res) => {
    const { paymentMethod } = parseBody(z.object({
      paymentMethod: z.string().min(1).max(50),
    }), req.body);
    res.json(await svc.payFee(tid(res), String(req.params["id"]), { paymentMethod }));
  }));
}
