import { z } from "zod";

export const createExpenseSchema = z.object({
  amountCents: z.number().int().positive(),
  category: z.string().min(1).max(64).nullable().optional(),
  spentAt: z.number().int().positive().optional(),
  vendor: z.string().max(128).nullable().optional(),
  note: z.string().max(512).nullable().optional(),
  accountId: z.string().min(1).nullable().optional(),
});

export const updateExpenseSchema = z
  .object({
    amountCents: z.number().int().positive().optional(),
    category: z.string().min(1).max(64).nullable().optional(),
    spentAt: z.number().int().positive().optional(),
    vendor: z.string().max(128).nullable().optional(),
    note: z.string().max(512).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "at least one field is required" });

export type CreateExpenseDto = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseDto = z.infer<typeof updateExpenseSchema>;

/** What the service actually needs to create an expense — same shape as the DTO today. */
export type CreateExpenseInput = CreateExpenseDto;
export type UpdateExpenseInput = UpdateExpenseDto;

export interface ListExpensesQuery {
  category?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

/** Business expenses — recording actual spend (rent, supplies, wages, etc.),
 *  distinct from the chart-of-accounts expense *accounts*. Tenant-scoped;
 *  money in integer cents. Feeds the retail-proof report and the dashboard. */
export interface Expense {
  id: string;
  tenant_id: string;
  category: string | null; // null = uncategorized (a recommendation signal)
  amount_cents: number;
  spent_at: number; // epoch ms of the spend
  vendor: string | null;
  note: string | null;
  account_id: string | null; // optional link to a chart-of-accounts expense account
  created_by: string;
  created_at: number;
}

export interface ExpenseListResponseDto {
  items: Expense[];
  total: number;
}

export interface ExpensesSummary {
  totalCents: number;
  count: number;
  uncategorizedCount: number;
  byCategory: Array<{ category: string; totalCents: number; count: number }>;
}
