import type { DB } from "../../shared/db.js";
import { writeAudit, type AuditEntry } from "../../shared/audit.js";
import type { Expense, ExpenseListResponseDto, ExpensesSummary, ListExpensesQuery } from "./expenses.dto.js";

export interface ResolvedListQuery extends ListExpensesQuery {
  limit: number;
  offset: number;
}

export type UpdateExpenseFields = Partial<
  Pick<Expense, "category" | "vendor" | "note" | "amount_cents" | "spent_at">
>;

/** Wraps every raw SQL call expenses needs — the service holds no `db` reference. */
export class ExpensesRepository {
  constructor(private readonly db: DB) {}

  async insert(row: Expense): Promise<void> {
    await this.db.query(
      `INSERT INTO expenses
         (id, tenant_id, category, amount_cents, spent_at, vendor, note, account_id, created_by, created_at)
       VALUES
         (@id, @tenant_id, @category, @amount_cents, @spent_at, @vendor, @note, @account_id, @created_by, @created_at)`,
      row as unknown as Record<string, unknown>,
    );
  }

  /** Best-effort audit write (never throws) — same helper every other module uses. */
  async writeAudit(entry: AuditEntry): Promise<void> {
    await writeAudit(this.db, entry);
  }

  async findById(id: string, tenantId: string): Promise<Expense | undefined> {
    return this.db.one<Expense>(
      "SELECT * FROM expenses WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
  }

  async list(query: ResolvedListQuery, tenantId: string): Promise<ExpenseListResponseDto> {
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
    const items = await this.db.query<Expense>(
      `SELECT * FROM expenses WHERE ${whereSql} ORDER BY spent_at DESC, created_at DESC LIMIT @limit OFFSET @offset`,
      { ...params, limit: query.limit, offset: query.offset },
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

  async update(id: string, tenantId: string, fields: UpdateExpenseFields): Promise<void> {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id, tenantId };
    if (fields.category !== undefined) { sets.push("category = @category"); params["category"] = fields.category; }
    if (fields.vendor !== undefined) { sets.push("vendor = @vendor"); params["vendor"] = fields.vendor; }
    if (fields.note !== undefined) { sets.push("note = @note"); params["note"] = fields.note; }
    if (fields.amount_cents !== undefined) { sets.push("amount_cents = @amount_cents"); params["amount_cents"] = fields.amount_cents; }
    if (fields.spent_at !== undefined) { sets.push("spent_at = @spent_at"); params["spent_at"] = fields.spent_at; }
    if (sets.length === 0) return; // no-op guard, service already checks too

    await this.db.query(
      `UPDATE expenses SET ${sets.join(", ")} WHERE id = @id AND tenant_id = @tenantId`,
      params,
    );
  }

  async delete(id: string, tenantId: string): Promise<void> {
    await this.db.query("DELETE FROM expenses WHERE id = @id AND tenant_id = @tenantId", { id, tenantId });
  }
}
