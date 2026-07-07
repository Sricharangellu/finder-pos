"use client";

/**
 * ExpensesPanel — record, list, categorize, and delete real business expenses
 * against the live `/api/v1/expenses` backend. Rendered as the "Expenses" tab of
 * the Finance page; it is where the "Categorize expenses" recommendation lands.
 *
 * Split for testability: `ExpensesView` is presentational (data + callbacks via
 * props); `ExpensesPanel` is the container that fetches and wires mutations.
 * Mutations are manager+ only — read-only roles never see the controls (and the
 * backend enforces the same, so hiding the UI is convenience, not the guard).
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { formatMoney, parseToCents } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import { hasRole } from "@/lib/auth";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";

export interface Expense {
  id: string;
  tenant_id: string;
  category: string | null;
  amount_cents: number;
  spent_at: number;
  vendor: string | null;
  note: string | null;
  account_id: string | null;
  created_by: string;
  created_at: number;
}

export interface ExpensesSummary {
  totalCents: number;
  count: number;
  uncategorizedCount: number;
  byCategory: Array<{ category: string; totalCents: number; count: number }>;
}

export interface CreateExpenseInput {
  amountCents: number;
  category?: string | null;
  spentAt?: number;
  vendor?: string | null;
  note?: string | null;
}

interface ExpensesViewProps {
  expenses: Expense[];
  summary: ExpensesSummary | null;
  canManage: boolean;
  loading: boolean;
  error: string | null;
  busy?: boolean;
  onCreate: (input: CreateExpenseInput) => void | Promise<void>;
  onCategorize: (id: string, category: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

function SummaryTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-4 shadow-sm ${highlight ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${highlight ? "text-amber-700" : "text-slate-950"}`}>{value}</p>
    </div>
  );
}

/** Presentational expenses surface — pure render + callbacks, no data fetching. */
export function ExpensesView({
  expenses, summary, canManage, loading, error, busy = false, onCreate, onCategorize, onDelete,
}: ExpensesViewProps) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [vendor, setVendor] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [catDraft, setCatDraft] = useState<Record<string, string>>({});

  function submitCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const cents = parseToCents(amount);
    if (!Number.isFinite(cents) || cents <= 0) {
      setFormError("Enter an amount greater than zero.");
      return;
    }
    void Promise.resolve(
      onCreate({
        amountCents: cents,
        category: category.trim() || null,
        vendor: vendor.trim() || null,
        note: note.trim() || null,
      }),
    ).then(() => {
      setAmount(""); setCategory(""); setVendor(""); setNote("");
    });
  }

  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
          Could not load expenses. {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="Total spend" value={formatMoney(summary?.totalCents ?? 0)} />
        <SummaryTile label="Expenses" value={String(summary?.count ?? 0)} />
        <SummaryTile
          label="Uncategorized"
          value={String(summary?.uncategorizedCount ?? 0)}
          highlight={(summary?.uncategorizedCount ?? 0) > 0}
        />
      </div>

      {canManage && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-950">Record an expense</h3>
          <form onSubmit={submitCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Amount</span>
              <input
                aria-label="Amount" inputMode="decimal" placeholder="0.00" value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="min-h-[40px] rounded-md border border-slate-300 px-3 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Category <span className="text-slate-400">(optional)</span></span>
              <input
                aria-label="Category" placeholder="e.g. Rent" value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="min-h-[40px] rounded-md border border-slate-300 px-3 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Vendor <span className="text-slate-400">(optional)</span></span>
              <input
                aria-label="Vendor" placeholder="e.g. Landlord Co" value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="min-h-[40px] rounded-md border border-slate-300 px-3 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Note <span className="text-slate-400">(optional)</span></span>
              <input
                aria-label="Note" placeholder="Description" value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-[40px] rounded-md border border-slate-300 px-3 text-sm"
              />
            </label>
            <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3">
              <Button type="submit" loading={busy}>Add expense</Button>
              {formError && <span role="alert" className="text-sm text-red-600">{formError}</span>}
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div role="status" aria-label="Loading expenses" className="p-6 text-sm text-slate-500">Loading expenses…</div>
        ) : expenses.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No expenses recorded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 font-semibold">Category</th>
                <th className="px-4 py-2 font-semibold">Vendor</th>
                <th className="px-4 py-2 font-semibold">Note</th>
                <th className="px-4 py-2 text-right font-semibold">Amount</th>
                {canManage && <th className="px-4 py-2 text-right font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.map((exp) => (
                <tr key={exp.id}>
                  <td className="px-4 py-2 tabular-nums text-slate-700">{fmtDate(exp.spent_at)}</td>
                  <td className="px-4 py-2">
                    {exp.category ? (
                      <Badge variant="blue">{exp.category}</Badge>
                    ) : (
                      <span className="text-amber-700">Uncategorized</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{exp.vendor ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">{exp.note ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-950">{formatMoney(exp.amount_cents)}</td>
                  {canManage && (
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        {!exp.category && (
                          <>
                            <input
                              aria-label={`Category for expense ${exp.id}`}
                              placeholder="Category"
                              value={catDraft[exp.id] ?? ""}
                              onChange={(e) => setCatDraft((d) => ({ ...d, [exp.id]: e.target.value }))}
                              className="min-h-[32px] w-32 rounded-md border border-slate-300 px-2 text-sm"
                            />
                            <Button
                              variant="secondary" disabled={busy || !(catDraft[exp.id] ?? "").trim()}
                              onClick={() => {
                                const value = (catDraft[exp.id] ?? "").trim();
                                if (value) void onCategorize(exp.id, value);
                              }}
                            >
                              Save
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost" disabled={busy}
                          aria-label={`Delete expense ${exp.id}`}
                          onClick={() => onDelete(exp.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/** Container — fetches expenses + summary and wires mutations to the real API. */
export default function ExpensesPanel() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpensesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = hasRole("manager");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, sum] = await Promise.all([
        apiGet<{ items: Expense[]; total: number }>("/api/v1/expenses"),
        apiGet<ExpensesSummary>("/api/v1/expenses/summary"),
      ]);
      setExpenses(list.items);
      setSummary(sum);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (op: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await op();
        await load();
      } catch (e) {
        setError(e instanceof ApiResponseError ? e.message : "Action failed.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const onCreate = useCallback((input: CreateExpenseInput) => mutate(() => apiPost("/api/v1/expenses", input)), [mutate]);
  const onCategorize = useCallback((id: string, category: string) => mutate(() => apiPatch(`/api/v1/expenses/${id}`, { category })), [mutate]);
  const onDelete = useCallback((id: string) => mutate(() => apiDelete(`/api/v1/expenses/${id}`)), [mutate]);

  return (
    <ExpensesView
      expenses={expenses}
      summary={summary}
      canManage={canManage}
      loading={loading}
      error={error}
      busy={busy}
      onCreate={onCreate}
      onCategorize={onCategorize}
      onDelete={onDelete}
    />
  );
}
