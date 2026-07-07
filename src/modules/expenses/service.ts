import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { notFound } from "../../shared/http.js";
import { writeAudit } from "../../shared/audit.js";

/** Business expenses — recording actual spend (rent, supplies, wages, etc.),
 *  distinct from the chart-of-accounts expense *accounts*. Tenant-scoped;
 *  money in integer cents. Feeds the retail-proof report and the dashboard. */

export interface Expense {
  id: string;
  tenant_id: string;
  category: string | null;   // null = uncategorized (a recommendation signal)
  amount_cents: number;
  spent_at: number;          // epoch ms of the spend
  vendor: string | null;
  note: string | null;
  account_id: string | null; // optional link to a chart-of-accounts expense account
  created_by: string;
  created_at: number;
}

export interface CreateExpenseInput {
  amountCents: number;
  category?: string | null;
  spentAt?: number;
  vendor?: string | null;
  note?: string | null;
  accountId?: string | null;
}

export interface UpdateExpenseInput {
  category?: string | null;
  vendor?: string | null;
  note?: string | null;
  amountCents?: number;
  spentAt?: number;
}

export interface ListExpensesQuery {
  category?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface ExpensesSummary {
  totalCents: number;
  count: number;
  uncategorizedCount: number;
  byCategory: Array<{ category: string; totalCents: number; count: number }>;
}

export class ExpensesService {
  constructor(private readonly db: DB) {}

  async create(input: CreateExpenseInput, tenantId: string, actorId: string): Promise<Expense> {
    const now = Date.now();
    const row: Expense = {
      id: `exp_${uuidv7()}`,
      tenant_id: tenantId,
      category: input.category?.trim() ? input.category.trim() : null,
      amount_cents: input.amountCents,
      spent_at: input.spentAt ?? now,
      vendor: input.vendor?.trim() ? input.vendor.trim() : null,
      note: input.note?.trim() ? input.note.trim() : null,
      account_id: input.accountId ?? null,
      created_by: actorId,
      created_at: now,
    };
    await this.db.query(
      `INSERT INTO expenses
         (id, tenant_id, category, amount_cents, spent_at, vendor, note, account_id, created_by, created_at)
       VALUES
         (@id, @tenant_id, @category, @amount_cents, @spent_at, @vendor, @note, @account_id, @created_by, @created_at)`,
      row as unknown as Record<string, unknown>,
    );
    await writeAudit(this.db, {
      tenantId, actorId, action: "expense.created", entityType: "expense", entityId: row.id,
      after: { amount_cents: row.amount_cents, category: row.category, vendor: row.vendor },
    });
    return row;
  }

  async list(query: ListExpensesQuery, tenantId: string): Promise<{ items: Expense[]; total: number }> {
    const where = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (query.category) { where.push("category = @category"); params["category"] = query.category; }
    if (query.from != null) { where.push("spent_at >= @from"); params["from"] = query.from; }
    if (query.to != null) { where.push("spent_at <= @to"); params["to"] = query.to; }
    const whereSql = where.join(" AND ");

    const totalRow = await this.db.one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM expenses WHERE ${whereSql}`,
      params,
    );
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const items = await this.db.query<Expense>(
      `SELECT * FROM expenses WHERE ${whereSql} ORDER BY spent_at DESC, created_at DESC LIMIT @limit OFFSET @offset`,
      { ...params, limit, offset },
    );
    return { items, total: Number(totalRow?.n ?? 0) };
  }

  async summary(tenantId: string, from?: number, to?: number): Promise<ExpensesSummary> {
    const where = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (from != null) { where.push("spent_at >= @from"); params["from"] = from; }
    if (to != null) { where.push("spent_at <= @to"); params["to"] = to; }
    const whereSql = where.join(" AND ");

    const totals = await this.db.one<{ total: number; count: number; uncat: number }>(
      `SELECT COALESCE(SUM(amount_cents),0) AS total,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE category IS NULL)::int AS uncat
         FROM expenses WHERE ${whereSql}`,
      params,
    );
    const byCat = await this.db.query<{ category: string; total: number; count: number }>(
      `SELECT category, COALESCE(SUM(amount_cents),0) AS total, COUNT(*)::int AS count
         FROM expenses WHERE ${whereSql} AND category IS NOT NULL
        GROUP BY category ORDER BY SUM(amount_cents) DESC`,
      params,
    );
    return {
      totalCents: Number(totals?.total ?? 0),
      count: Number(totals?.count ?? 0),
      uncategorizedCount: Number(totals?.uncat ?? 0),
      byCategory: byCat.map((c) => ({ category: c.category, totalCents: Number(c.total), count: Number(c.count) })),
    };
  }

  async get(id: string, tenantId: string): Promise<Expense> {
    const row = await this.db.one<Expense>(
      "SELECT * FROM expenses WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!row) throw notFound(`expense '${id}' not found`);
    return row;
  }

  /** Partial update — the categorize/correct workflow. Only provided fields change;
   *  category can be set to null to un-categorize. Manager+ (enforced at the route). */
  async update(id: string, input: UpdateExpenseInput, tenantId: string, actorId: string): Promise<Expense> {
    const existing = await this.get(id, tenantId); // throws notFound if missing/other tenant
    const sets: string[] = [];
    const params: Record<string, unknown> = { id, tenantId };
    const next: Partial<Expense> = {};
    if (input.category !== undefined) {
      const c = input.category?.trim() ? input.category.trim() : null;
      sets.push("category = @category"); params["category"] = c; next.category = c;
    }
    if (input.vendor !== undefined) {
      const v = input.vendor?.trim() ? input.vendor.trim() : null;
      sets.push("vendor = @vendor"); params["vendor"] = v; next.vendor = v;
    }
    if (input.note !== undefined) {
      const n = input.note?.trim() ? input.note.trim() : null;
      sets.push("note = @note"); params["note"] = n; next.note = n;
    }
    if (input.amountCents !== undefined) {
      sets.push("amount_cents = @amountCents"); params["amountCents"] = input.amountCents; next.amount_cents = input.amountCents;
    }
    if (input.spentAt !== undefined) {
      sets.push("spent_at = @spentAt"); params["spentAt"] = input.spentAt; next.spent_at = input.spentAt;
    }
    if (sets.length === 0) return existing; // no-op

    await this.db.query(
      `UPDATE expenses SET ${sets.join(", ")} WHERE id = @id AND tenant_id = @tenantId`,
      params,
    );
    await writeAudit(this.db, {
      tenantId, actorId, action: "expense.updated", entityType: "expense", entityId: existing.id,
      before: { category: existing.category, vendor: existing.vendor, note: existing.note, amount_cents: existing.amount_cents },
      after: next,
    });
    return { ...existing, ...next };
  }

  async remove(id: string, tenantId: string, actorId: string): Promise<Expense> {
    const existing = await this.get(id, tenantId);
    await this.db.query("DELETE FROM expenses WHERE id = @id AND tenant_id = @tenantId", { id, tenantId });
    await writeAudit(this.db, {
      tenantId, actorId, action: "expense.deleted", entityType: "expense", entityId: existing.id,
      before: { amount_cents: existing.amount_cents, category: existing.category },
    });
    return existing;
  }
}
