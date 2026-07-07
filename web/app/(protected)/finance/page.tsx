"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney, parseToCents } from "@/lib/money";
import { hasRole } from "@/lib/auth";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import type { AgingReport, Bill, Invoice, BillingStatus } from "@/api-client/types";
import { usePathname, useRouter } from "next/navigation";
import { fmtDate } from "@/lib/date";
import ExpensesPanel from "./_components/ExpensesPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinanceInvoice extends Invoice {
  due_amount_cents?: number;
}

interface FinanceBill extends Bill {
  due_amount_cents?: number;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BILLING_STYLE: Record<BillingStatus, string> = {
  open: "bg-blue-50 text-blue-700 ring-blue-200",
  partial: "bg-amber-50 text-amber-700 ring-amber-200",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  void: "bg-slate-100 text-slate-500 ring-slate-200",
};

const TABS = [
  { id: "ar", label: "Receivables (AR)" },
  { id: "ap", label: "Payables (AP)" },
  { id: "expenses", label: "Expenses" },
  { id: "aging", label: "Aging" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dueAmount(item: { total_cents: number; paid_cents: number; due_amount_cents?: number }) {
  return item.due_amount_cents ?? item.total_cents - item.paid_cents;
}

function isOverdue(item: { due_date: number | null; status: BillingStatus }): boolean {
  if (item.status === "paid" || item.status === "void") return false;
  if (!item.due_date) return false;
  return item.due_date < Date.now();
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-4 shadow-sm ${highlight ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${highlight ? "text-red-700" : "text-slate-950"}`}>{value}</p>
    </div>
  );
}

// ─── Pay control ──────────────────────────────────────────────────────────────

function PayControl({
  max,
  busy,
  onPay,
}: {
  max: number;
  busy: boolean;
  onPay: (amountCents: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setOpen(true);
          setAmount((max / 100).toFixed(2));
        }}
      >
        Pay
      </Button>
    );
  }

  const cents = parseToCents(amount);
  const valid = !isNaN(cents) && cents > 0 && cents <= max;

  return (
    <span className="flex items-center justify-end gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={busy}
        aria-label="Payment amount"
        className="w-20 rounded border border-slate-300 px-1.5 py-1 text-right text-xs outline-none focus:border-slate-950 focus:ring-1 focus:ring-slate-950"
      />
      <Button
        size="sm"
        variant="primary"
        disabled={busy || !valid}
        onClick={() => {
          if (valid) {
            onPay(cents);
            setOpen(false);
          }
        }}
      >
        Confirm
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </span>
  );
}

// ─── Aging table ──────────────────────────────────────────────────────────────

const AGING_COLS: Array<{ key: keyof Omit<AgingReport["totals"], "total">; label: string }> = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1-30d" },
  { key: "d31_60", label: "31-60d" },
  { key: "d61_90", label: "61-90d" },
  { key: "d90_plus", label: "90d+" },
];

function AgingTable({ report, title }: { report: AgingReport; title: string }) {
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-sm font-semibold text-slate-700">{title}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <th className="py-2 pr-4">Party</th>
            {AGING_COLS.map((c) => (
              <th key={c.key} className="py-2 pr-3 text-right">
                {c.label}
              </th>
            ))}
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {report.parties.length === 0 && (
            <tr>
              <td colSpan={7} className="py-6 text-center text-slate-400">
                No data
              </td>
            </tr>
          )}
          {report.parties.map((row) => (
            <tr key={row.partyId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.partyId}</td>
              {AGING_COLS.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 text-right text-xs tabular-nums ${c.key === "d90_plus" && row.buckets[c.key] > 0 ? "font-semibold text-red-600" : "text-slate-700"}`}
                >
                  {formatMoney(row.buckets[c.key])}
                </td>
              ))}
              <td className="px-4 py-3 text-right text-xs font-semibold tabular-nums">{formatMoney(row.buckets.total)}</td>
            </tr>
          ))}
          {/* Totals row */}
          {report.parties.length > 0 && (
            <tr className="border-t bg-slate-50 font-semibold">
              <td className="py-2 pr-4 text-xs text-slate-600">Total</td>
              {AGING_COLS.map((c) => (
                <td
                  key={c.key}
                  className={`py-2 pr-3 text-right text-xs ${c.key === "d90_plus" && report.totals[c.key] > 0 ? "text-red-600" : "text-slate-950"}`}
                >
                  {formatMoney(report.totals[c.key])}
                </td>
              ))}
              <td className="py-2 text-right text-xs text-slate-950">{formatMoney(report.totals.total)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
      <span className="text-sm font-medium text-green-800">{message}</span>
      <button onClick={onDismiss} className="text-emerald-700 hover:text-emerald-900" aria-label="Dismiss">
        x
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const pathname = usePathname();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>(() => financeTabFromPath(pathname));
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [bills, setBills] = useState<FinanceBill[]>([]);
  const [arAging, setArAging] = useState<AgingReport | null>(null);
  const [apAging, setApAging] = useState<AgingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => setTab(financeTabFromPath(pathname)), [pathname]);
  const canPay = hasRole("manager");

  const load = useCallback(async () => {
    try {
      setError(null);
      const [inv, bil, ar, ap] = await Promise.all([
        apiGet<{ items: FinanceInvoice[] }>("/api/v1/billing/invoices"),
        apiGet<{ items: FinanceBill[] }>("/api/v1/billing/bills"),
        apiGet<AgingReport>("/api/v1/reports/ar-aging"),
        apiGet<AgingReport>("/api/v1/reports/ap-aging"),
      ]);
      setInvoices(inv.items ?? []);
      setBills(bil.items ?? []);
      setArAging(ar);
      setApAging(ap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load finance data");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const payInvoice = async (id: string, amountCents: number) => {
    setBusy(true);
    try {
      await apiPost(`/api/v1/billing/invoices/${id}/pay`, { amountCents, mode: "cash" });
      await load();
      setToast("Invoice payment recorded");
    } catch (e) {
      setError(
        e instanceof ApiResponseError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Payment failed"
      );
    } finally {
      setBusy(false);
    }
  };

  const payBill = async (id: string, amountCents: number) => {
    setBusy(true);
    try {
      await apiPost(`/api/v1/billing/bills/${id}/pay`, { amountCents, mode: "bank_transfer" });
      await load();
      setToast("Bill payment recorded");
    } catch (e) {
      setError(
        e instanceof ApiResponseError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Payment failed"
      );
    } finally {
      setBusy(false);
    }
  };

  // AR summary metrics
  const arOutstanding = invoices.reduce((s, inv) => s + dueAmount(inv), 0);
  const arOverdue = invoices
    .filter(isOverdue)
    .reduce((s, inv) => s + dueAmount(inv), 0);
  const now = Date.now();
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const arCollectedThisMonth = invoices
    .filter((inv) => inv.status === "paid" && inv.due_date !== null && inv.due_date >= startOfMonth)
    .reduce((s, inv) => s + inv.total_cents, 0);

  // AP summary metrics
  const apOwed = bills.reduce((s, b) => s + dueAmount(b), 0);
  const apOverdue = bills.filter(isOverdue).reduce((s, b) => s + dueAmount(b), 0);

  return (
    <EnterpriseShell
      active="finance"
      title="Finance"
      subtitle="Receivables, Payables & Aging"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        <div className="border-b border-slate-200 pb-4">
          <h1 className="text-lg font-semibold text-slate-950">Finance center</h1>
          <p className="mt-1 text-sm text-slate-500">Track outstanding receivables, supplier payables, and aging exposure.</p>
        </div>
        {error && (
          <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.id}
                onClick={() => {
                  setTab(t.id);
                  router.replace(t.id === "ap" ? "/finance/bills" : t.id === "aging" ? "/reporting/ar-aging" : "/finance", { scroll: false });
                }}
                aria-current={tab === t.id ? "page" : undefined}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-b-2 border-slate-950 text-slate-950"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Receivables (AR) ─────────────────────────────────────── */}
        {tab === "ar" && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SummaryCard label="Total Outstanding" value={formatMoney(arOutstanding)} />
              <SummaryCard label="Overdue" value={formatMoney(arOverdue)} highlight={arOverdue > 0} />
              <SummaryCard label="Collected This Month" value={formatMoney(arCollectedThisMonth)} />
            </div>

            <Card title="Invoices" description="Customer invoices and payment status." noPadding>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <th className="px-5 py-3">Invoice #</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3">Due Date</th>
                      <th className="px-4 py-3 text-right">Due Amount</th>
                      {canPay && <th className="px-5 py-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.length === 0 && (
                      <tr>
                        <td colSpan={canPay ? 7 : 6} className="px-5 py-8 text-center text-slate-500">
                          No invoices found
                        </td>
                      </tr>
                    )}
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-3 font-medium text-slate-950">{inv.invoice_number}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{inv.customer_id}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${BILLING_STYLE[inv.status]}`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">{formatMoney(inv.total_cents)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 ${isOverdue(inv) ? "font-medium text-red-600" : "text-slate-500"}`}>
                          {fmtDate(inv.due_date)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-950">{formatMoney(dueAmount(inv))}</td>
                        {canPay && (
                          <td className="whitespace-nowrap px-5 py-3 text-right">
                            {inv.status !== "paid" && inv.status !== "void" && (
                              <PayControl
                                busy={busy}
                                max={dueAmount(inv)}
                                onPay={(cents) => void payInvoice(inv.id, cents)}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {/* ── Tab: Payables (AP) ────────────────────────────────────────── */}
        {tab === "ap" && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SummaryCard label="Total Owed" value={formatMoney(apOwed)} />
              <SummaryCard label="Overdue Bills" value={formatMoney(apOverdue)} highlight={apOverdue > 0} />
            </div>

            <Card title="Bills" description="Supplier bills awaiting payment." noPadding>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <th className="py-2 pr-4">Bill #</th>
                      <th className="py-2 pr-4">Supplier</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4 text-right">Total</th>
                      <th className="py-2 pr-4">Due Date</th>
                      <th className="py-2 pr-4 text-right">Due Amount</th>
                      {canPay && <th className="py-2 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {bills.length === 0 && (
                      <tr>
                        <td colSpan={canPay ? 7 : 6} className="py-6 text-center text-slate-400">
                          No bills found
                        </td>
                      </tr>
                    )}
                    {bills.map((bill) => (
                      <tr key={bill.id} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{bill.bill_number}</td>
                        <td className="py-2 pr-4 text-slate-600">{bill.supplier_id}</td>
                        <td className="py-2 pr-4">
                          <span
                            className={`rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${BILLING_STYLE[bill.status]}`}
                          >
                            {bill.status}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right">{formatMoney(bill.total_cents)}</td>
                        <td className={`py-2 pr-4 ${isOverdue(bill) ? "font-medium text-red-600" : "text-slate-500"}`}>
                          {fmtDate(bill.due_date)}
                        </td>
                        <td className="py-2 pr-4 text-right">{formatMoney(dueAmount(bill))}</td>
                        {canPay && (
                          <td className="py-2 text-right">
                            {bill.status !== "paid" && bill.status !== "void" && (
                              <PayControl
                                busy={busy}
                                max={dueAmount(bill)}
                                onPay={(cents) => void payBill(bill.id, cents)}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {/* ── Tab: Aging ────────────────────────────────────────────────── */}
        {tab === "expenses" && <ExpensesPanel />}

        {tab === "aging" && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="AR Aging" description="Receivables broken down by days outstanding.">
              {arAging ? (
                <AgingTable report={arAging} title="Accounts Receivable" />
              ) : (
                <TableSkeleton headers={["Party", "Current", "1-30d", "31-60d", "61-90d", "90d+", "Total"]} rows={5} />
              )}
            </Card>

            <Card title="AP Aging" description="Payables broken down by days outstanding.">
              {apAging ? (
                <AgingTable report={apAging} title="Accounts Payable" />
              ) : (
                <TableSkeleton headers={["Party", "Current", "1-30d", "31-60d", "61-90d", "90d+", "Total"]} rows={5} />
              )}
            </Card>
          </div>
        )}
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </EnterpriseShell>
  );
}

function financeTabFromPath(pathname: string): TabId {
  if (pathname.endsWith("/bills") || pathname.endsWith("/payment-made")) return "ap";
  return "ar";
}
