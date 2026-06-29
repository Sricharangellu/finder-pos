import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound, HttpError } from "../../shared/http.js";

export type AssetStatus = "available" | "rented" | "maintenance" | "retired";
export type ContractStatus = "draft" | "active" | "returned" | "cancelled";

export interface RentalAsset {
  id: string;
  tenant_id: string;
  name: string;
  sku: string;
  category: string | null;
  daily_rate_cents: number;
  deposit_cents: number;
  status: AssetStatus;
  serial: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface RentalContract {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  asset_id: string;
  starts_at: number;
  ends_at: number;
  actual_return_at: number | null;
  deposit_cents: number;
  deposit_returned: number;
  daily_rate_cents: number;
  status: ContractStatus;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export type RentalService = ReturnType<typeof rentalService>;

export function rentalService(db: DB, events: EventBus) {
  return {
    async listAssets(tenantId: string, status?: AssetStatus): Promise<RentalAsset[]> {
      const where = status
        ? "WHERE tenant_id = @t AND status = @status ORDER BY name"
        : "WHERE tenant_id = @t ORDER BY name";
      return db.query<RentalAsset>(
        `SELECT * FROM rental_assets ${where} LIMIT 200`,
        status ? { t: tenantId, status } : { t: tenantId },
      );
    },

    async createAsset(tenantId: string, input: {
      name: string;
      sku: string;
      category?: string;
      dailyRateCents?: number;
      depositCents?: number;
      serial?: string;
      notes?: string;
    }): Promise<RentalAsset> {
      const now = Date.now();
      const row: RentalAsset = {
        id: `ra_${uuidv7()}`,
        tenant_id: tenantId,
        name: input.name,
        sku: input.sku,
        category: input.category ?? null,
        daily_rate_cents: input.dailyRateCents ?? 0,
        deposit_cents: input.depositCents ?? 0,
        status: "available",
        serial: input.serial ?? null,
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      };
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO rental_assets (id, tenant_id, name, sku, category, daily_rate_cents, deposit_cents, status, serial, notes, created_at, updated_at)
           VALUES (@id, @tenant_id, @name, @sku, @category, @daily_rate_cents, @deposit_cents, @status, @serial, @notes, @created_at, @updated_at)`,
          row as unknown as Record<string, unknown>,
        );
      });
      return row;
    },

    async updateAsset(tenantId: string, id: string, input: Partial<{
      name: string;
      category: string;
      dailyRateCents: number;
      depositCents: number;
      status: AssetStatus;
      serial: string;
      notes: string;
    }>): Promise<RentalAsset> {
      const existing = await db.one<RentalAsset>(
        "SELECT * FROM rental_assets WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!existing) throw notFound(`rental_asset '${id}'`);
      const now = Date.now();
      const updated: RentalAsset = {
        ...existing,
        name: input.name !== undefined ? input.name : existing.name,
        category: input.category !== undefined ? input.category : existing.category,
        daily_rate_cents: input.dailyRateCents !== undefined ? input.dailyRateCents : existing.daily_rate_cents,
        deposit_cents: input.depositCents !== undefined ? input.depositCents : existing.deposit_cents,
        status: input.status !== undefined ? input.status : existing.status,
        serial: input.serial !== undefined ? input.serial : existing.serial,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        updated_at: now,
      };
      await db.query(
        `UPDATE rental_assets SET name=@name, category=@category, daily_rate_cents=@daily_rate_cents,
         deposit_cents=@deposit_cents, status=@status, serial=@serial, notes=@notes, updated_at=@updated_at
         WHERE id=@id AND tenant_id=@tenant_id`,
        { ...updated, id, tenant_id: tenantId } as unknown as Record<string, unknown>,
      );
      return updated;
    },

    async listContracts(tenantId: string, opts: {
      assetId?: string;
      customerId?: string;
      status?: ContractStatus;
    } = {}): Promise<RentalContract[]> {
      const where: string[] = ["tenant_id = @t"];
      const params: Record<string, unknown> = { t: tenantId };
      if (opts.assetId) { where.push("asset_id = @assetId"); params["assetId"] = opts.assetId; }
      if (opts.customerId) { where.push("customer_id = @customerId"); params["customerId"] = opts.customerId; }
      if (opts.status) { where.push("status = @status"); params["status"] = opts.status; }
      return db.query<RentalContract>(
        `SELECT * FROM rental_contracts WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 200`,
        params,
      );
    },

    async createContract(tenantId: string, input: {
      customerId?: string;
      assetId: string;
      startsAt: number;
      endsAt: number;
      depositCents?: number;
      dailyRateCents?: number;
      notes?: string;
    }): Promise<RentalContract> {
      const asset = await db.one<RentalAsset>(
        "SELECT * FROM rental_assets WHERE id = @id AND tenant_id = @t",
        { id: input.assetId, t: tenantId },
      );
      if (!asset) throw notFound(`rental_asset '${input.assetId}'`);
      if (asset.status !== "available") {
        throw new HttpError(409, "asset_not_available", `Asset is not available (status: ${asset.status}).`);
      }
      const now = Date.now();
      const row: RentalContract = {
        id: `rc_${uuidv7()}`,
        tenant_id: tenantId,
        customer_id: input.customerId ?? null,
        asset_id: input.assetId,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        actual_return_at: null,
        deposit_cents: input.depositCents ?? asset.deposit_cents,
        deposit_returned: 0,
        daily_rate_cents: input.dailyRateCents ?? asset.daily_rate_cents,
        status: "active",
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      };
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO rental_contracts (id, tenant_id, customer_id, asset_id, starts_at, ends_at, actual_return_at, deposit_cents, deposit_returned, daily_rate_cents, status, notes, created_at, updated_at)
           VALUES (@id, @tenant_id, @customer_id, @asset_id, @starts_at, @ends_at, @actual_return_at, @deposit_cents, @deposit_returned, @daily_rate_cents, @status, @notes, @created_at, @updated_at)`,
          row as unknown as Record<string, unknown>,
        );
        await tdb.query(
          "UPDATE rental_assets SET status = 'rented', updated_at = @now WHERE id = @id AND tenant_id = @t",
          { now, id: input.assetId, t: tenantId },
        );
      });
      void events.publish("rental.contract_created", { tenantId, contractId: row.id, assetId: input.assetId }, row.id);
      return row;
    },

    async getContract(tenantId: string, id: string): Promise<RentalContract> {
      const row = await db.one<RentalContract>(
        "SELECT * FROM rental_contracts WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!row) throw notFound(`rental_contract '${id}'`);
      return row;
    },

    async returnAsset(tenantId: string, contractId: string, returnDepositCents?: number): Promise<RentalContract> {
      const contract = await db.one<RentalContract>(
        "SELECT * FROM rental_contracts WHERE id = @id AND tenant_id = @t",
        { id: contractId, t: tenantId },
      );
      if (!contract) throw notFound(`rental_contract '${contractId}'`);
      if (contract.status !== "active") {
        throw new HttpError(409, "contract_not_active", `Contract is not active (status: ${contract.status}).`);
      }
      const now = Date.now();
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `UPDATE rental_contracts SET status = 'returned', actual_return_at = @now, updated_at = @now
           WHERE id = @id AND tenant_id = @t`,
          { now, id: contractId, t: tenantId },
        );
        await tdb.query(
          "UPDATE rental_assets SET status = 'available', updated_at = @now WHERE id = @assetId AND tenant_id = @t",
          { now, assetId: contract.asset_id, t: tenantId },
        );
      });
      void events.publish("rental.asset_returned", { tenantId, contractId, assetId: contract.asset_id }, contractId);
      return {
        ...contract,
        status: "returned",
        actual_return_at: now,
        deposit_returned: returnDepositCents !== undefined ? returnDepositCents : contract.deposit_returned,
        updated_at: now,
      };
    },
  };
}
