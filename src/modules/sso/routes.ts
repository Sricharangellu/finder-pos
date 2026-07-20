import { z } from "zod";
import type { Router, Response } from "express";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { SsoService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const ROLES = ["owner", "manager", "cashier"] as const;

const UpsertBody = z.object({
  enabled: z.boolean(),
  providerName: z.string().min(1).max(64),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  discoveryUrl: z.string().url(),
  scopes: z.string().default("openid profile email"),
  defaultRole: z.enum(ROLES).default("cashier"),
});

// `/initiate` and `/callback` are registered separately in src/app.ts, ahead of
// the global `/api/v1` auth gate — see registerPublicRoutes() below. A caller
// without a token can't reach anything behind makeAuthMiddleware, so a
// pre-login SSO handshake can never be mounted through this module's normal
// router (which is only reachable after auth already succeeded).
export const InitiateBody = z.object({
  tenantId: z.string().min(1),
  redirectUri: z.string().url(),
});

export const CallbackBody = z.object({
  state: z.string().min(1),
  code: z.string().min(1),
  redirectUri: z.string().url(),
});

/** Public pre-login routes — mount before the `/api/v1` auth gate (see src/app.ts). */
export function registerPublicRoutes(router: Router, service: SsoService): void {
  // POST /api/v1/sso/initiate — returns the OIDC authorization URL for the given tenant.
  router.post(
    "/initiate",
    handler(async (req, res) => {
      const { tenantId: tid, redirectUri } = parseBody(InitiateBody, req.body);
      const result = await service.initiateLogin(tid, redirectUri);
      res.json(result);
    }),
  );

  // POST /api/v1/sso/callback — exchanges an authorization code for an Ascend JWT.
  router.post(
    "/callback",
    handler(async (req, res) => {
      const body = parseBody(CallbackBody, req.body);
      const tokens = await service.handleCallback(body.state, body.code, body.redirectUri);
      res.json(tokens);
    }),
  );
}

export function registerRoutes(router: Router, service: SsoService): void {
  // GET /api/v1/sso/config — owner reads their IdP config (secret redacted)
  router.get(
    "/config",
    requireRole("owner"),
    handler(async (_req, res) => {
      const cfg = await service.getSanitizedConfig(tenantId(res));
      if (!cfg) {
        res.json({ configured: false });
        return;
      }
      res.json({ configured: true, ...cfg });
    }),
  );

  // PUT /api/v1/sso/config — owner upserts IdP config
  router.put(
    "/config",
    requireRole("owner"),
    handler(async (req, res) => {
      const raw = parseBody(UpsertBody, req.body);
      res.json(await service.upsertConfig(tenantId(res), {
        ...raw,
        scopes: raw.scopes ?? "openid profile email",
        defaultRole: raw.defaultRole ?? "cashier",
      }));
    }),
  );

  // DELETE /api/v1/sso/config — owner removes IdP config
  router.delete(
    "/config",
    requireRole("owner"),
    handler(async (_req, res) => {
      await service.deleteConfig(tenantId(res));
      res.status(204).end();
    }),
  );

}
