import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { WebhooksService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const subscribeSchema = z.object({
  url: z.string().url(),
  eventTypes: z.array(z.string().min(1)).optional(),
  secret: z.string().min(8).optional(),
});

export function registerRoutes(router: Router, service: WebhooksService): void {
  router.post(
    "/",
    handler(async (req, res) => {
      const body = parseBody(subscribeSchema, req.body);
      const sub = await service.subscribe(body, tenantId(res));
      res.status(201).json(sub);
    }),
  );

  router.get(
    "/",
    handler(async (_req, res) => {
      res.json({ items: await service.list(tenantId(res)) });
    }),
  );

  router.get(
    "/deliveries",
    handler(async (_req, res) => {
      res.json({ items: await service.deliveries(tenantId(res)) });
    }),
  );

  router.delete(
    "/:id",
    handler(async (req, res) => {
      const ok = await service.remove(String(req.params.id), tenantId(res));
      if (!ok) throw notFound(`webhook '${req.params.id}' not found`);
      res.status(204).end();
    }),
  );
}
