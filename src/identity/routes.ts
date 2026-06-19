import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../shared/http.js";
import type { IdentityService } from "./service.js";
import type { AuthPayload } from "../gateway/auth.js";
import { requireRole } from "../gateway/auth.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const registerDeviceSchema = z.object({
  deviceName: z.string().min(1),
  deviceType: z.string().min(1).optional(),
  outletId: z.string().min(1).nullable().optional(),
  registerId: z.string().min(1).nullable().optional(),
  deviceIdentifier: z.string().min(1).nullable().optional(),
  appVersion: z.string().min(1).nullable().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  storeName: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

/**
 * Register identity routes onto the provided router.
 *
 * POST /login    — verify credentials → {accessToken, refreshToken, expiresIn}
 * POST /refresh  — rotate token pair via a valid refreshToken
 * GET  /me       — return the caller's own identity (requires auth middleware upstream)
 */
export function registerIdentityRoutes(router: Router, service: IdentityService): void {
  router.post(
    "/register",
    handler(async (req, res) => {
      const body = parseBody(registerSchema, req.body);
      const result = await service.register(body);
      res.status(201).json(result);
    }),
  );

  router.post(
    "/login",
    handler(async (req, res) => {
      const body = parseBody(loginSchema, req.body);
      const tokens = await service.login(body);
      res.status(200).json(tokens);
    }),
  );

  router.post(
    "/refresh",
    handler(async (req, res) => {
      const body = parseBody(refreshSchema, req.body);
      const tokens = await service.refresh(body.refreshToken);
      res.status(200).json(tokens);
    }),
  );

  // /logout can be called both authenticated and unauthenticated (token may be expired).
  // We gracefully handle missing auth by falling back to a tenantId from the request body.
  router.post(
    "/logout",
    handler(async (req, res) => {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (refreshToken) {
        const auth = res.locals["auth"] as { tenantId?: string } | undefined;
        const tenantId = auth?.tenantId ?? (req.body as Record<string, unknown>).tenantId as string ?? "";
        await service.revokeRefreshToken(refreshToken, tenantId);
      }
      res.json({ ok: true });
    }),
  );

  // /me is protected — auth middleware must be mounted on this router upstream.
  router.get(
    "/me",
    handler(async (_req, res) => {
      const auth = res.locals["auth"] as { userId: string; tenantId: string; role: string } | undefined;
      if (!auth) {
        res.status(401).json({ error: { code: "unauthenticated", message: "Not authenticated." } });
        return;
      }
      res.json({ userId: auth.userId, tenantId: auth.tenantId, role: auth.role });
    }),
  );

  // ── Devices (auth required — auth middleware mounted upstream) ───────────────
  router.get(
    "/devices",
    handler(async (_req, res) => {
      res.json({ items: await service.listDevices(tenantId(res)) });
    }),
  );

  router.post(
    "/devices",
    handler(async (req, res) => {
      const body = parseBody(registerDeviceSchema, req.body);
      const device = await service.registerDevice(tenantId(res), body);
      res.status(201).json(device);
    }),
  );

  router.patch(
    "/devices/:id/trust",
    requireRole("owner"),
    handler(async (req, res) => {
      const device = await service.trustDevice(String(req.params.id), tenantId(res));
      res.json(device);
    }),
  );
}
