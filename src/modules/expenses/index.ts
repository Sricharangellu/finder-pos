import type { PosModule } from "../types.js";
import { ExpensesService } from "./service.js";
import { ExpensesRepository } from "./expenses.repository.js";
import { registerRoutes } from "./routes.js";

// Business expenses — recording actual spend (distinct from the chart-of-accounts
// expense accounts). Tenant-scoped; money in integer cents.
const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS expenses (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  category     TEXT,
  amount_cents BIGINT NOT NULL,
  spent_at     BIGINT NOT NULL,
  vendor       TEXT,
  note         TEXT,
  account_id   TEXT,
  created_by   TEXT NOT NULL,
  created_at   BIGINT NOT NULL,
  CONSTRAINT expenses_amount_positive CHECK (amount_cents > 0)
);
`;

const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS expenses_tenant_spent_idx ON expenses (tenant_id, spent_at DESC);
CREATE INDEX IF NOT EXISTS expenses_tenant_category_idx ON expenses (tenant_id, category);
`;

export const expensesModule: PosModule = {
  name: "expenses",
  migrations: [CREATE_TABLE, CREATE_INDEXES],
  register({ db, router }) {
    registerRoutes(router, new ExpensesService(new ExpensesRepository(db)));
  },
};

export { ExpensesService } from "./service.js";
export type { Expense, CreateExpenseInput, ListExpensesQuery, ExpensesSummary } from "./expenses.dto.js";
