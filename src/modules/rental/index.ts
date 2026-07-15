import type { PosModule, ModuleContext } from "../types.js";
import { v7 as uuidv7 } from "uuid";
import { handler, parseBody, notFound } from "../../shared/http.js";
import { requireRole, requireModule } from "../../gateway/auth.js";
import { z } from "zod";
import type { Response } from "express";
import type { AuthPayload } from "../../gateway/auth.js";

// ── BE-R1: Rental — Assets + Contracts ────────────────────────────────────

const CREATE_RENTAL_ASSETS = `
CREATE TABLE IF NOT EXISTS rental_assets (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  sku             TEXT,
  category        TEXT,
  daily_rate_cents BIGINT NOT NULL DEFAULT 0,
  deposit_cents   BIGINT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'available',
  serial_number   TEXT,
  notes           TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_assets_tenant_status_idx ON rental_assets (tenant_id, status);
CREATE INDEX IF NOT EXISTS rental_assets_tenant_name_idx ON rental_assets (tenant_id, name);
`;

const CREATE_RENTAL_CONTRACTS = `
CREATE TABLE IF NOT EXISTS rental_contracts (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  asset_id        TEXT NOT NULL REFERENCES rental_assets(id) ON DELETE CASCADE,
  customer_id     TEXT,
  starts_at       BIGINT NOT NULL,
  ends_at         BIGINT NOT NULL,
  deposit_cents   BIGINT NOT NULL DEFAULT 0,
  total_cents     BIGINT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active',
  returned_at     BIGINT,
  notes           TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_contracts_tenant_asset_idx ON rental_contracts (tenant_id, asset_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS rental_contracts_tenant_status_idx ON rental_contracts (tenant_id, status, starts_at DESC);
CREATE INDEX IF NOT EXISTS rental_contracts_tenant_customer_idx ON rental_contracts (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
`;

function tid(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const assetSchema = z.object({
  name:           z.string().min(1).max(150),
  sku:            z.string().max(50).optional(),
  category:       z.string().max(80).optional(),
  dailyRateCents: z.number().int().nonnegative().default(0),
  depositCents:   z.number().int().nonnegative().default(0),
  serialNumber:   z.string().max(80).optional(),
  notes:          z.string().max(500).optional(),
});

const contractSchema = z.object({
  assetId:    z.string().min(1),
  customerId: z.string().min(1).optional(),
  startsAt:   z.number().int().positive(),
  endsAt:     z.number().int().positive(),
  notes:      z.string().max(500).optional(),
});

export const rentalModule: PosModule = {
  name: "rental",
  migrations: [CREATE_RENTAL_ASSETS, CREATE_RENTAL_CONTRACTS],
  register({ db, router }: ModuleContext) {
    router.use(requireModule("rental_contracts"));

    // ── Assets ────────────────────────────────────────────────────────────────

    router.get("/assets", handler(async (req, res) => {
      const t      = tid(res);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const where  = status ? "WHERE tenant_id = @t AND status = @s" : "WHERE tenant_id = @t";
      const params: Record<string, unknown> = { t };
      if (status) params.s = status;
      res.json({ items: await db.query(
        `SELECT * FROM rental_assets ${where} ORDER BY name ASC LIMIT 500`,
        params,
      )});
    }));

    router.post("/assets", requireRole("manager"), handler(async (req, res) => {
      const body = parseBody(assetSchema, req.body);
      const t    = tid(res);
      const now  = Date.now();
      const id   = `rasset_${uuidv7()}`;
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO rental_assets
             (id, tenant_id, name, sku, category, daily_rate_cents, deposit_cents, status, serial_number, notes, created_at, updated_at)
           VALUES (@id,@t,@name,@sku,@cat,@rate,@dep,'available',@serial,@notes,@now,@now)`,
          { id, t, name: body.name, sku: body.sku ?? null, cat: body.category ?? null,
            rate: body.dailyRateCents, dep: body.depositCents,
            serial: body.serialNumber ?? null, notes: body.notes ?? null, now },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM rental_assets WHERE id = @id", { id }));
    }));

    // ── Contracts ─────────────────────────────────────────────────────────────

    router.get("/contracts", handler(async (req, res) => {
      const t      = tid(res);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const where  = status ? "WHERE rc.tenant_id = @t AND rc.status = @s" : "WHERE rc.tenant_id = @t";
      const params: Record<string, unknown> = { t };
      if (status) params.s = status;
      res.json({ items: await db.query(
        `SELECT rc.*, ra.name AS asset_name, ra.daily_rate_cents
         FROM rental_contracts rc
         JOIN rental_assets ra ON ra.id = rc.asset_id
         ${where} ORDER BY rc.starts_at DESC LIMIT 200`,
        params,
      )});
    }));

    router.post("/contracts", handler(async (req, res) => {
      const body  = parseBody(contractSchema, req.body);
      const t     = tid(res);
      const now   = Date.now();
      const id    = `rcon_${uuidv7()}`;
      const asset = await db.one<{ daily_rate_cents: number; deposit_cents: number; status: string }>(
        "SELECT * FROM rental_assets WHERE id = @id AND tenant_id = @t",
        { id: body.assetId, t },
      );
      if (!asset) throw notFound(`rental_asset '${body.assetId}'`);
      if (asset.status !== "available") {
        res.status(409).json({ error: { code: "asset_unavailable" } });
        return;
      }
      const days  = Math.max(1, Math.ceil((body.endsAt - body.startsAt) / 86_400_000));
      const total = days * asset.daily_rate_cents;
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO rental_contracts
             (id, tenant_id, asset_id, customer_id, starts_at, ends_at, deposit_cents, total_cents, status, notes, created_at, updated_at)
           VALUES (@id,@t,@assetId,@custId,@start,@end,@dep,@total,'active',@notes,@now,@now)`,
          { id, t, assetId: body.assetId, custId: body.customerId ?? null,
            start: body.startsAt, end: body.endsAt,
            dep: asset.deposit_cents, total, notes: body.notes ?? null, now },
        );
        await tdb.query(
          "UPDATE rental_assets SET status = 'rented', updated_at = @now WHERE id = @assetId AND tenant_id = @t",
          { now, assetId: body.assetId, t },
        );
      });
      res.status(201).json(await db.one("SELECT * FROM rental_contracts WHERE id = @id", { id }));
    }));

    // Return asset
    router.post("/contracts/:id/return", handler(async (req, res) => {
      const id  = String(req.params["id"]);
      const t   = tid(res);
      const now = Date.now();
      const contract = await db.one<{ asset_id: string; status: string }>(
        "SELECT * FROM rental_contracts WHERE id = @id AND tenant_id = @t",
        { id, t },
      );
      if (!contract) throw notFound(`rental_contract '${id}'`);
      if (contract.status !== "active") {
        res.status(409).json({ error: { code: "contract_not_active" } });
        return;
      }
      await db.withTenant(t).tx(async (tdb) => {
        await tdb.query(
          "UPDATE rental_contracts SET status = 'returned', returned_at = @now, updated_at = @now WHERE id = @id AND tenant_id = @t",
          { now, id, t },
        );
        await tdb.query(
          "UPDATE rental_assets SET status = 'available', updated_at = @now WHERE id = @assetId AND tenant_id = @t",
          { now, assetId: contract.asset_id, t },
        );
      });
      res.json(await db.one("SELECT * FROM rental_contracts WHERE id = @id", { id }));
    }));
  },
};
