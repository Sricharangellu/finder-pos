import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { notFound, badRequest, conflict } from "../../shared/http.js";

/**
 * Accounting module — Chart of Accounts + Batch Deposits (ERP benchmark #9).
 *
 * The Chart of Accounts is a typed tree (asset/liability/income/expense) used as
 * dropdowns across the app (product accounting tab, shipping config, bills).
 * Batch deposits group received payments into a bank deposit that moves through
 * an approval workflow before being marked deposited. Tenant-scoped, cents.
 */

export type AccountType = "asset" | "liability" | "income" | "expense";
export type DepositStatus = "pending_approval" | "approved" | "rejected";

export interface Account {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  type: AccountType;
  parent_id: string | null;
  is_active: number; // 1|0
  created_at: number;
}

export interface AccountNode extends Account {
  children: AccountNode[];
}

export interface BatchDeposit {
  id: string;
  tenant_id: string;
  batch_number: string;
  description: string | null;
  account_id: string;
  status: DepositStatus;
  total_cents: number;
  deposit_date: number | null;
  created_at: number;
  decided_at: number | null;
}

export interface BatchDepositItem {
  id: string;
  tenant_id: string;
  batch_id: string;
  payment_id: string;
  amount_cents: number;
}

/** Standard wholesale-distribution chart of accounts, seeded on first use. */
const DEFAULT_COA: Array<{ code: string; name: string; type: AccountType }> = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1010", name: "Bank Checking", type: "asset" },
  { code: "1020", name: "Bank Savings", type: "asset" },
  { code: "1100", name: "Accounts Receivable", type: "asset" },
  { code: "1200", name: "Inventory Asset", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "Sales Tax Payable", type: "liability" },
  { code: "2200", name: "Credit Card", type: "liability" },
  { code: "4000", name: "Sales Revenue", type: "income" },
  { code: "4100", name: "Shipping Income", type: "income" },
  { code: "4200", name: "Discount Given", type: "income" },
  { code: "5000", name: "Cost of Goods Sold", type: "expense" },
  { code: "5100", name: "Shipping Expense", type: "expense" },
  { code: "5200", name: "Operating Expenses", type: "expense" },
];

export class AccountingService {
  constructor(private readonly db: DB) {}

  // ── Chart of Accounts ────────────────────────────────────────────────────
  async createAccount(input: { code: string; name: string; type: AccountType; parentId?: string | null }, tenantId: string): Promise<Account> {
    const acct: Account = {
      id: `acct_${uuidv7()}`, tenant_id: tenantId, code: input.code, name: input.name, type: input.type,
      parent_id: input.parentId ?? null, is_active: 1, created_at: Date.now(),
    };
    try {
      await this.db.query(
        "INSERT INTO accounts (id, tenant_id, code, name, type, parent_id, is_active, created_at) VALUES (@id,@tenant_id,@code,@name,@type,@parent_id,@is_active,@created_at)",
        acct as unknown as Record<string, unknown>,
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw conflict(`account code '${input.code}' already exists`);
      throw err;
    }
    return acct;
  }

  /** Seed the standard COA if the tenant has none. Idempotent. Returns inserted count. */
  async seedDefaults(tenantId: string): Promise<{ seeded: number }> {
    const existing = await this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM accounts WHERE tenant_id = @t", { t: tenantId });
    if (Number(existing?.n ?? 0) > 0) return { seeded: 0 };
    let n = 0;
    for (const a of DEFAULT_COA) { await this.createAccount(a, tenantId); n++; }
    return { seeded: n };
  }

  async listAccounts(tenantId: string, type?: AccountType): Promise<Account[]> {
    if (type) return this.db.query<Account>("SELECT * FROM accounts WHERE tenant_id = @t AND type = @ty ORDER BY code ASC", { t: tenantId, ty: type });
    return this.db.query<Account>("SELECT * FROM accounts WHERE tenant_id = @t ORDER BY code ASC", { t: tenantId });
  }

  /** Accounts as a parent/child tree (roots = accounts with no parent). */
  async tree(tenantId: string): Promise<AccountNode[]> {
    const all = await this.listAccounts(tenantId);
    const byId = new Map<string, AccountNode>();
    all.forEach((a) => byId.set(a.id, { ...a, children: [] }));
    const roots: AccountNode[] = [];
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id)!.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async updateAccount(id: string, patch: { name?: string; isActive?: boolean }, tenantId: string): Promise<Account> {
    const a = await this.db.one<Account>("SELECT * FROM accounts WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!a) throw notFound(`account '${id}' not found`);
    const name = patch.name ?? a.name;
    const active = patch.isActive === undefined ? a.is_active : patch.isActive ? 1 : 0;
    await this.db.query("UPDATE accounts SET name = @n, is_active = @a WHERE id = @id AND tenant_id = @t", { n: name, a: active, id, t: tenantId });
    return { ...a, name, is_active: active };
  }

  // ── Batch Deposits ─────────────────────────────────────────────────────────
  private async nextNumber(tenantId: string): Promise<string> {
    const row = await this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM batch_deposits WHERE tenant_id = @t", { t: tenantId });
    return `DEP-${String(Number(row?.n ?? 0) + 1).padStart(5, "0")}`;
  }

  /** Create a batch deposit grouping payment ids into a target bank account.
   *  Total is summed from the provided payments (looked up in billing_payments). */
  async createDeposit(input: { accountId: string; description?: string; paymentIds: string[]; depositDate?: number }, tenantId: string): Promise<BatchDeposit & { items: BatchDepositItem[] }> {
    if (input.paymentIds.length === 0) throw badRequest("at least one payment is required");
    const acct = await this.db.one("SELECT id FROM accounts WHERE id = @a AND tenant_id = @t", { a: input.accountId, t: tenantId });
    if (!acct) throw notFound(`account '${input.accountId}' not found`);

    const payments = await this.db.query<{ id: string; amount_cents: number }>(
      `SELECT id, amount_cents FROM billing_payments WHERE tenant_id = @t AND id = ANY(@ids)`,
      { t: tenantId, ids: input.paymentIds },
    );
    if (payments.length !== input.paymentIds.length) throw badRequest("one or more payments were not found");
    const total = payments.reduce((s, p) => s + Number(p.amount_cents), 0);

    const now = Date.now();
    const dep: BatchDeposit = {
      id: `dep_${uuidv7()}`, tenant_id: tenantId, batch_number: await this.nextNumber(tenantId),
      description: input.description ?? null, account_id: input.accountId, status: "pending_approval",
      total_cents: total, deposit_date: input.depositDate ?? null, created_at: now, decided_at: null,
    };
    const items = await this.db.tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO batch_deposits (id, tenant_id, batch_number, description, account_id, status, total_cents, deposit_date, created_at, decided_at)
         VALUES (@id,@tenant_id,@batch_number,@description,@account_id,@status,@total_cents,@deposit_date,@created_at,@decided_at)`,
        dep as unknown as Record<string, unknown>,
      );
      const out: BatchDepositItem[] = [];
      for (const p of payments) {
        const item: BatchDepositItem = { id: `dpi_${uuidv7()}`, tenant_id: tenantId, batch_id: dep.id, payment_id: p.id, amount_cents: Number(p.amount_cents) };
        await tdb.query(
          "INSERT INTO batch_deposit_items (id, tenant_id, batch_id, payment_id, amount_cents) VALUES (@id,@tenant_id,@batch_id,@payment_id,@amount_cents)",
          item as unknown as Record<string, unknown>,
        );
        out.push(item);
      }
      return out;
    });
    return { ...dep, items };
  }

  async listDeposits(tenantId: string, status?: DepositStatus): Promise<BatchDeposit[]> {
    if (status) return this.db.query<BatchDeposit>("SELECT * FROM batch_deposits WHERE tenant_id = @t AND status = @s ORDER BY created_at DESC LIMIT 500", { t: tenantId, s: status });
    return this.db.query<BatchDeposit>("SELECT * FROM batch_deposits WHERE tenant_id = @t ORDER BY created_at DESC LIMIT 500", { t: tenantId });
  }

  async getDeposit(id: string, tenantId: string): Promise<BatchDeposit & { items: BatchDepositItem[] }> {
    const dep = await this.db.one<BatchDeposit>("SELECT * FROM batch_deposits WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!dep) throw notFound(`batch deposit '${id}' not found`);
    const items = await this.db.query<BatchDepositItem>("SELECT * FROM batch_deposit_items WHERE batch_id = @id AND tenant_id = @t", { id, t: tenantId });
    return { ...dep, items };
  }

  private async decide(id: string, status: DepositStatus, tenantId: string): Promise<BatchDeposit> {
    const dep = await this.db.one<BatchDeposit>("SELECT * FROM batch_deposits WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!dep) throw notFound(`batch deposit '${id}' not found`);
    if (dep.status !== "pending_approval") throw conflict(`batch deposit is already ${dep.status}`);
    const now = Date.now();
    await this.db.query("UPDATE batch_deposits SET status = @s, decided_at = @now WHERE id = @id AND tenant_id = @t", { s: status, now, id, t: tenantId });
    return { ...dep, status, decided_at: now };
  }

  approveDeposit(id: string, tenantId: string) { return this.decide(id, "approved", tenantId); }
  rejectDeposit(id: string, tenantId: string) { return this.decide(id, "rejected", tenantId); }

  /** Simple manual cash deposit — used by the Settings UI which doesn't pick payment IDs.
   *  Auto-selects the first active asset account if no accountId is supplied. */
  async createManualDeposit(
    input: { totalCents: number; note?: string; accountId?: string },
    tenantId: string,
  ): Promise<BatchDeposit> {
    if (input.totalCents <= 0) throw badRequest("totalCents must be positive");

    let accountId = input.accountId;
    if (!accountId) {
      const acct = await this.db.one<{ id: string }>(
        "SELECT id FROM accounts WHERE tenant_id = @t AND type = 'asset' AND is_active = 1 ORDER BY code ASC LIMIT 1",
        { t: tenantId },
      );
      if (!acct) throw badRequest("no asset accounts found — seed your chart of accounts first (Settings → Chart of Accounts → seed)");
      accountId = acct.id;
    } else {
      const acct = await this.db.one("SELECT id FROM accounts WHERE id = @a AND tenant_id = @t", { a: accountId, t: tenantId });
      if (!acct) throw notFound(`account '${accountId}' not found`);
    }

    const now = Date.now();
    const dep: BatchDeposit = {
      id: `dep_${uuidv7()}`,
      tenant_id: tenantId,
      batch_number: await this.nextNumber(tenantId),
      description: input.note ?? null,
      account_id: accountId,
      status: "pending_approval",
      total_cents: input.totalCents,
      deposit_date: null,
      created_at: now,
      decided_at: null,
    };
    await this.db.query(
      `INSERT INTO batch_deposits (id, tenant_id, batch_number, description, account_id, status, total_cents, deposit_date, created_at, decided_at)
       VALUES (@id,@tenant_id,@batch_number,@description,@account_id,@status,@total_cents,@deposit_date,@created_at,@decided_at)`,
      dep as unknown as Record<string, unknown>,
    );
    return dep;
  }
}
