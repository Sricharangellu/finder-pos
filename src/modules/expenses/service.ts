import { v7 as uuidv7 } from "uuid";
import { notFound } from "../../shared/http.js";
import type { ExpensesRepository } from "./expenses.repository.js";
import type {
  CreateExpenseInput,
  Expense,
  ExpenseListResponseDto,
  ExpensesSummary,
  ListExpensesQuery,
  UpdateExpenseInput,
} from "./expenses.dto.js";

/** Business expenses — recording actual spend (rent, supplies, wages, etc.),
 *  distinct from the chart-of-accounts expense *accounts*. Tenant-scoped;
 *  money in integer cents. Feeds the retail-proof report and the dashboard. */
export class ExpensesService {
  constructor(private readonly repo: ExpensesRepository) {}

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
    await this.repo.insert(row);
    await this.repo.writeAudit({
      tenantId, actorId, action: "expense.created", entityType: "expense", entityId: row.id,
      after: { amount_cents: row.amount_cents, category: row.category, vendor: row.vendor },
    });
    return row;
  }

  async list(query: ListExpensesQuery, tenantId: string): Promise<ExpenseListResponseDto> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    return this.repo.list({ ...query, limit, offset }, tenantId);
  }

  async summary(tenantId: string, from?: number, to?: number): Promise<ExpensesSummary> {
    return this.repo.summary(tenantId, from, to);
  }

  async get(id: string, tenantId: string): Promise<Expense> {
    const row = await this.repo.findById(id, tenantId);
    if (!row) throw notFound(`expense '${id}' not found`);
    return row;
  }

  /** Partial update — the categorize/correct workflow. Only provided fields change;
   *  category can be set to null to un-categorize. Manager+ (enforced at the route). */
  async update(id: string, input: UpdateExpenseInput, tenantId: string, actorId: string): Promise<Expense> {
    const existing = await this.get(id, tenantId); // throws notFound if missing/other tenant
    const next: Partial<Expense> = {};
    if (input.category !== undefined) next.category = input.category?.trim() ? input.category.trim() : null;
    if (input.vendor !== undefined) next.vendor = input.vendor?.trim() ? input.vendor.trim() : null;
    if (input.note !== undefined) next.note = input.note?.trim() ? input.note.trim() : null;
    if (input.amountCents !== undefined) next.amount_cents = input.amountCents;
    if (input.spentAt !== undefined) next.spent_at = input.spentAt;

    if (Object.keys(next).length === 0) return existing; // no-op

    await this.repo.update(id, tenantId, next);
    await this.repo.writeAudit({
      tenantId, actorId, action: "expense.updated", entityType: "expense", entityId: existing.id,
      before: { category: existing.category, vendor: existing.vendor, note: existing.note, amount_cents: existing.amount_cents },
      after: next,
    });
    return { ...existing, ...next };
  }

  async remove(id: string, tenantId: string, actorId: string): Promise<Expense> {
    const existing = await this.get(id, tenantId);
    await this.repo.delete(id, tenantId);
    await this.repo.writeAudit({
      tenantId, actorId, action: "expense.deleted", entityType: "expense", entityId: existing.id,
      before: { amount_cents: existing.amount_cents, category: existing.category },
    });
    return existing;
  }
}
