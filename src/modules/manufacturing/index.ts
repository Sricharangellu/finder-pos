import type { PosModule, ModuleContext } from "../types.js";
import { v7 as uuidv7 } from "uuid";
import { handler, parseBody, notFound } from "../../shared/http.js";
import { requireRole, requireModule } from "../../gateway/auth.js";
import { z } from "zod";
import type { Response } from "express";
import type { AuthPayload } from "../../gateway/auth.js";

// ── BE-M1: Manufacturing — Production Orders + BOM ─────────────────────────

const CREATE_PRODUCTION_ORDERS = `
CREATE TABLE IF NOT EXISTS production_orders (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  quantity        INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',
  started_at      BIGINT,
  completed_at    BIGINT,
  notes           TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS po_tenant_status_idx ON production_orders (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS po_tenant_product_idx ON production_orders (tenant_id, product_id);
`;

const CREATE_BOM_LINES = `
CREATE TABLE IF NOT EXISTS bom_lines (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  production_order_id  TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  raw_material_id      TEXT NOT NULL,
  qty_required         NUMERIC(12,4) NOT NULL,
  qty_consumed         NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit                 TEXT NOT NULL DEFAULT 'unit'
);
CREATE INDEX IF NOT EXISTS bom_lines_order_idx ON bom_lines (production_order_id);
`;

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const bomLineSchema = z.object({
  rawMaterialId: z.string().min(1),
  qtyRequired:   z.number().positive(),
  unit:          z.string().max(20).default("unit"),
});

const createSchema = z.object({
  productId: z.string().min(1),
  quantity:  z.number().int().positive(),
  notes:     z.string().max(500).optional(),
  bom:       z.array(bomLineSchema).min(1),
});

export const manufacturingModule: PosModule = {
  name: "manufacturing",
  migrations: [CREATE_PRODUCTION_ORDERS, CREATE_BOM_LINES],
  register({ db, router }: ModuleContext) {
    router.use(requireModule("production_orders"));

    // ── Production Orders ──────────────────────────────────────────────────────

    router.get("/orders", handler(async (req, res) => {
      const t      = tid(res);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const where  = status ? "WHERE tenant_id = @t AND status = @s" : "WHERE tenant_id = @t";
      const params: Record<string, unknown> = { t };
      if (status) params.s = status;
      res.json({ items: await db.query(
        `SELECT * FROM production_orders ${where} ORDER BY created_at DESC LIMIT 200`,
        params,
      )});
    }));

    router.get("/orders/:id", handler(async (req, res) => {
      const id = String(req.params["id"]);
      const po = await db.one("SELECT * FROM production_orders WHERE id = @id AND tenant_id = @t",
        { id, t: tid(res) });
      if (!po) throw notFound(`production_order '${id}'`);
      const lines = await db.query(
        "SELECT * FROM bom_lines WHERE production_order_id = @id",
        { id },
      );
      res.json({ ...po, bom: lines });
    }));

    router.post("/orders", requireRole("manager"), handler(async (req, res) => {
      const body = parseBody(createSchema, req.body);
      const t    = tid(res);
      const now  = Date.now();
      const id   = `prod_${uuidv7()}`;
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO production_orders (id, tenant_id, product_id, quantity, status, notes, created_at, updated_at)
           VALUES (@id,@t,@productId,@qty,'draft',@notes,@now,@now)`,
          { id, t, productId: body.productId, qty: body.quantity, notes: body.notes ?? null, now },
        );
        for (const line of body.bom) {
          await tdb.query(
            `INSERT INTO bom_lines (id, tenant_id, production_order_id, raw_material_id, qty_required, unit)
             VALUES (@lid,@t,@orderId,@matId,@qty,@unit)`,
            { lid: `bom_${uuidv7()}`, t, orderId: id,
              matId: line.rawMaterialId, qty: line.qtyRequired, unit: line.unit },
          );
        }
      });
      const po    = await db.one("SELECT * FROM production_orders WHERE id = @id", { id });
      const lines = await db.query("SELECT * FROM bom_lines WHERE production_order_id = @id", { id });
      res.status(201).json({ ...po, bom: lines });
    }));

    // Advance status: draft → in_progress → completed
    router.patch("/orders/:id/status", requireRole("manager"), handler(async (req, res) => {
      const id     = String(req.params["id"]);
      const t      = tid(res);
      const status = z.enum(["in_progress", "completed", "cancelled"]).parse(
        (req.body as Record<string, unknown>).status,
      );
      const now = Date.now();
      const updates: Record<string, unknown> = { status, updated_at: now };
      if (status === "in_progress") updates.started_at = now;
      if (status === "completed")   updates.completed_at = now;
      const setClause = Object.keys(updates).map(k => `${k} = @${k}`).join(", ");
      await db.query(
        `UPDATE production_orders SET ${setClause} WHERE id = @id AND tenant_id = @t`,
        { ...updates, id, t },
      );
      res.json(await db.one("SELECT * FROM production_orders WHERE id = @id", { id }));
    }));

    // Record actual consumption for a BOM line
    router.patch("/bom-lines/:id/consume", requireRole("manager"), handler(async (req, res) => {
      const id  = String(req.params["id"]);
      const t   = tid(res);
      const qty = z.number().nonnegative().parse((req.body as Record<string, unknown>).qtyConsumed);
      await db.query(
        "UPDATE bom_lines SET qty_consumed = @qty WHERE id = @id AND tenant_id = @t",
        { qty, id, t },
      );
      res.json(await db.one("SELECT * FROM bom_lines WHERE id = @id", { id }));
    }));
  },
};
