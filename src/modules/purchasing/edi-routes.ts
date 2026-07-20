import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { DB } from "../../shared/db.js";
import type { EdiImportsService } from "./edi-imports.js";
import { getVendorHistory } from "./vendor-history.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const createSchema = z.object({
  filename: z.string().min(1),
  format: z.string().min(1),
  supplier_id: z.string().min(1),
  supplier_name: z.string().min(1),
  file_size_bytes: z.number().nonnegative(),
});

/**
 * Registers the EDI-imports surface (Purchasing > EDI Imports page) and the
 * vendor-history surface (Purchasing > Reorder tab). Separate route group
 * from routes.ts, mounted on the same router by index.ts — same pattern as
 * notifications' settings-routes.ts alongside routes.ts.
 *
 * NOTE on `/formats` route ordering: it must be registered before
 * `/edi-imports/:id`, since Express matches literal-vs-param routes by
 * registration order (both are 2 path segments) — `formats` would otherwise
 * be swallowed as an `:id` value.
 */
export function registerEdiRoutes(router: Router, service: EdiImportsService, db: DB): void {
  const mgr = requireRole("manager");

  router.get(
    "/edi-imports/formats",
    handler(async (_req, res) => {
      res.json({ formats: service.listFormats() });
    }),
  );

  router.post(
    "/edi-imports",
    mgr,
    handler(async (req, res) => {
      const body = parseBody(createSchema, req.body);
      const created = await service.create(body, tenantId(res));
      res.status(201).json(created);
    }),
  );

  router.get(
    "/edi-imports",
    handler(async (req, res) => {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const items = await service.list(tenantId(res), status);
      res.json({ items });
    }),
  );

  router.get(
    "/edi-imports/:id",
    handler(async (req, res) => {
      const detail = await service.get(String(req.params.id), tenantId(res));
      res.json(detail);
    }),
  );

  router.post(
    "/edi-imports/:id/validate",
    mgr,
    handler(async (req, res) => {
      const updated = await service.validate(String(req.params.id), tenantId(res));
      res.json(updated);
    }),
  );

  router.post(
    "/edi-imports/:id/process",
    mgr,
    handler(async (req, res) => {
      const result = await service.process(String(req.params.id), tenantId(res));
      res.json(result);
    }),
  );

  // Vendor purchase-order history — grouped by supplier id, real join over
  // purchase_orders (see vendor-history.ts).
  router.get(
    "/vendor-history",
    handler(async (_req, res) => {
      const history = await getVendorHistory(db, tenantId(res));
      res.json({ history });
    }),
  );
}
