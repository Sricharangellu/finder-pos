import type { Router, Response } from "express";
import { handler, HttpError } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { TeamService } from "./service.js";

function auth(res: Response): AuthPayload {
  return res.locals["auth"] as AuthPayload;
}

export function registerRoutes(router: Router, service: TeamService): void {
  // GET /api/v1/team — owner/manager only.
  router.get(
    "/",
    handler(async (_req, res) => {
      const { role, tenantId } = auth(res);
      if (role !== "owner" && role !== "manager") {
        throw new HttpError(403, "forbidden", "team directory requires owner or manager");
      }
      res.json({ items: await service.list(tenantId) });
    }),
  );
}
