import type { Request, Router, Response, CookieOptions } from "express";
import { z } from "zod";
import { handler, parseBody, badRequest } from "../shared/http.js";
import type { IdentityService } from "./service.js";
import type { AuthPayload } from "../gateway/auth.js";
import { requireRole } from "../gateway/auth.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────
const isProd = process.env["NODE_ENV"] === "production";

const COOKIE_BASE: CookieOptions = {
  secure: isProd,
  sameSite: "lax",
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days ms
};

/** Parse a named cookie from the request header without cookie-parser. */
function getCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  const seg = raw.split(";").find((s) => s.trim().startsWith(`${name}=`));
  return seg ? decodeURIComponent(seg.trim().slice(name.length + 1)) : undefined;
}

/** Set httpOnly refresh token cookie + non-httpOnly session hint for middleware. */
function setAuthCookies(res: Response, refreshToken: string): void {
  res.cookie("finder_refresh", refreshToken, { ...COOKIE_BASE, httpOnly: true });
  // Non-httpOnly hint: JavaScript and Next.js middleware can read it to know a session exists.
  res.cookie("finder_session_hint", "1", { ...COOKIE_BASE, httpOnly: false });
}

/** Clear both auth cookies on logout. */
function clearAuthCookies(res: Response): void {
  res.clearCookie("finder_refresh", { ...COOKIE_BASE, httpOnly: true });
  res.clearCookie("finder_session_hint", { ...COOKIE_BASE, httpOnly: false });
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

const loginMfaSchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(6).max(32),
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
      // Resolve real client IP — trust X-Forwarded-For behind a proxy (Vercel/Cloudflare).
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
        req.socket.remoteAddress ??
        null;
      const tokens = await service.login(body, ip);
      if ("mfaRequired" in tokens) {
        res.status(401).json({
          error: {
            code: "mfa_required",
            message: "Multi-factor authentication is required.",
          },
          pendingToken: tokens.pendingToken,
          expiresIn: tokens.expiresIn,
        });
        return;
      }
      setAuthCookies(res, tokens.refreshToken);
      res.status(200).json(tokens);
    }),
  );

  router.post(
    "/login/mfa",
    handler(async (req, res) => {
      const body = parseBody(loginMfaSchema, req.body);
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
        req.socket.remoteAddress ??
        null;
      const tokens = await service.completeMfaLogin(body, ip);
      setAuthCookies(res, tokens.refreshToken);
      res.status(200).json(tokens);
    }),
  );

  router.post(
    "/refresh",
    handler(async (req, res) => {
      // Accept token from httpOnly cookie (preferred) or request body (backward compat).
      const cookieToken = getCookie(req, "finder_refresh");
      const rawBody = req.body as Record<string, unknown>;
      const bodyToken = typeof rawBody["refreshToken"] === "string" ? rawBody["refreshToken"] : undefined;
      const refreshToken = cookieToken ?? bodyToken;
      if (!refreshToken) throw badRequest("refreshToken is required (cookie or body)");
      const tokens = await service.refresh(refreshToken);
      setAuthCookies(res, tokens.refreshToken);
      res.status(200).json(tokens);
    }),
  );

  // /logout: revoke token found in cookie (preferred) or body; clear both auth cookies.
  // tenantId sourced from the verified JWT only — never from the request body.
  router.post(
    "/logout",
    handler(async (req, res) => {
      const cookieToken = getCookie(req, "finder_refresh");
      const rawBody = req.body as Record<string, unknown>;
      const bodyToken = typeof rawBody["refreshToken"] === "string" ? rawBody["refreshToken"] : undefined;
      const tokenToRevoke = cookieToken ?? bodyToken;
      if (tokenToRevoke) {
        const auth = res.locals["auth"] as { tenantId?: string } | undefined;
        await service.revokeRefreshToken(tokenToRevoke, auth?.tenantId ?? "");
      }
      clearAuthCookies(res);
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

  // ── MFA routes (auth middleware must be applied upstream) ─────────────────────
  router.get(
    "/mfa/status",
    handler(async (_req, res) => {
      const auth = res.locals["auth"] as { userId: string; tenantId: string } | undefined;
      if (!auth) { res.status(401).end(); return; }
      res.json(await service.getMfaStatus(auth.userId, auth.tenantId));
    }),
  );

  router.post(
    "/mfa/setup",
    handler(async (_req, res) => {
      const auth = res.locals["auth"] as { userId: string; tenantId: string } | undefined;
      if (!auth) { res.status(401).end(); return; }
      res.json(await service.setupMfa(auth.userId, auth.tenantId));
    }),
  );

  router.post(
    "/mfa/verify",
    handler(async (req, res) => {
      const auth = res.locals["auth"] as { userId: string; tenantId: string } | undefined;
      if (!auth) { res.status(401).end(); return; }
      const body = parseBody(z.object({ code: z.string().length(6) }), req.body);
      const result = await service.verifyAndEnableMfa(auth.userId, auth.tenantId, body.code);
      res.json({ ok: true, message: "MFA enabled successfully", backupCodes: result.backupCodes });
    }),
  );

  router.post(
    "/mfa/disable",
    handler(async (_req, res) => {
      const auth = res.locals["auth"] as { userId: string; tenantId: string } | undefined;
      if (!auth) { res.status(401).end(); return; }
      await service.disableMfa(auth.userId, auth.tenantId);
      res.json({ ok: true });
    }),
  );

  // ── API Keys (owner only) ─────────────────────────────────────────────────────
  router.get(
    "/api-keys",
    requireRole("owner"),
    handler(async (_req, res) => {
      res.json({ items: await service.listApiKeys(tenantId(res)) });
    }),
  );

  router.post(
    "/api-keys",
    requireRole("owner"),
    handler(async (req, res) => {
      const auth = res.locals["auth"] as { userId: string; tenantId: string };
      const body = parseBody(z.object({ name: z.string().min(1), scopes: z.array(z.string()).min(1).optional(), expiresAt: z.number().int().positive().optional() }), req.body);
      const result = await service.createApiKey(auth.tenantId, body.name, body.scopes ?? ["read"], auth.userId, body.expiresAt);
      res.status(201).json(result);
    }),
  );

  router.delete(
    "/api-keys/:id",
    requireRole("owner"),
    handler(async (req, res) => {
      await service.revokeApiKey(String(req.params.id), tenantId(res));
      res.status(204).end();
    }),
  );

  // ── Password reset ────────────────────────────────────────────────────────────
  router.post(
    "/forgot-password",
    handler(async (req, res) => {
      const body = parseBody(z.object({ email: z.string().email() }), req.body);
      const result = await service.requestPasswordReset(body.email);
      // Always return 200 to prevent email enumeration
      res.json({ ok: true, ...(process.env["NODE_ENV"] !== "production" && result ? { token: result.token } : {}) });
    }),
  );

  router.post(
    "/reset-password",
    handler(async (req, res) => {
      const body = parseBody(z.object({ token: z.string().min(1), password: z.string().min(8) }), req.body);
      await service.resetPassword(body.token, body.password);
      res.json({ ok: true });
    }),
  );
}
