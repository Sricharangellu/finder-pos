"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney, parseToCents } from "@/lib/money";
import { hasRole } from "@/lib/auth";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import type { AgingReport, Bill, Invoice, BillingStatus } from "@/api-client/types";

interface Account { id: string; code: string; name: string; type: string; is_active: number; }
interface Deposit { id: string; batch_number: string; status: string; total_cents: number; account_id: string; created_at: number; }

const TYPE_STYLE: Record<string, string> = {
  asset: "bg-blue-100 text-blue-800",
  liability: "bg-amber-100 text-amber-800",
  income: "bg-green-100 text-green-800",
  expense: "bg-red-100 text-red-700",
};
const DEP_STYLE: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
};
const BILLING_STYLE: Record<BillingStatus, string> = {
  open: "bg-blue-100 text-blue-800",
  partial: "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-800",
  void: "bg-gray-100 text-gray-500",
};

function formatDate(ms: number | null) {
  if (ms === null) return "-";
  return new Date(ms).toLocaleDateString();
}

export default function AccountingPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [apAging, setApAging] = useState<AgingReport | null>(null);
  const [arAging, setArAging] = useState<AgingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPay = hasRole("manager");

  const load = useCallback(async () => {
    try {
      setError(null);
      const [a, d, b, i, ap, ar] = await Promise.all([
        apiGet<{ items: Account[] }>("/api/v1/accounting/accounts"),
        apiGet<{ items: Deposit[] }>("/api/v1/accounting/deposits"),
        apiGet<{ items: Bill[] }>("/api/v1/billing/bills"),
        apiGet<{ items: Invoice[] }>("/api/v1/billing/invoices"),
        apiGet<AgingReport>("/api/v1/reports/ap-aging"),
        apiGet<AgingReport>("/api/v1/reports/ar-aging"),
      ]);
      setAccounts(a.items ?? []);
      setDeposits(d.items ?? []);
      setBills(b.items ?? []);
      setInvoices(i.items ?? []);
      setApAging(ap);
      setArAging(ar);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const seed = async () => {
    setBusy(true);
    try { await apiPost("/api/v1/accounting/accounts/seed", {}); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Seed failed"); }
    finally { setBusy(false); }
  };

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusy(true);
    try { await apiPost(`/api/v1/accounting/deposits/${id}/${action}`, {}); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(false); }
  };

  const payBill = async (id: string, amountCents: number) => {
    setBusy(true);
    try {
      await apiPost(`/api/v1/billing/bills/${id}/pay`, { amountCents });
      await load();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const payInvoice = async (id: string, amountCents: number) => {
    setBusy(true);
    try {
      await apiPost(`/api/v1/billing/invoices/${id}/pay`, { amountCents });
      await load();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseShell active="accounting" title="Accounting" subtitle="Chart of Accounts & Batch Deposits">
      <div className="space-y-4 p-4">
        {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

        <Card
          title="Chart of Accounts"
          description="Typed account tree used across products, shipping, and bills."
        >
          <div className="mb-3">
            {accounts.length === 0 && <Button size="sm" disabled={busy} onClick={seed}>Seed standard COA</Button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Code</th><th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Type</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-gray-400">No accounts — seed to get started</td></tr>}
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{a.code}</td>
                    <td className="py-2 pr-4">{a.name}</td>
                    <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[a.type] ?? "bg-gray-100"}`}>{a.type}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Batch Deposits" description="Group received payments into bank deposits for approval.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Batch #</th><th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4 text-right">Total</th><th className="py-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deposits.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-400">No batch deposits</td></tr>}
                {deposits.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{d.batch_number}</td>
                    <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DEP_STYLE[d.status] ?? "bg-gray-100"}`}>{d.status.replace(/_/g, " ")}</span></td>
                    <td className="py-2 pr-4 text-right">{formatMoney(d.total_cents)}</td>
                    <td className="py-2 pr-4 text-right">
                      {d.status === "pending_approval" && (
                        <span className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(d.id, "approve")}>Approve</Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(d.id, "reject")}>Reject</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Accounts Receivable" description="Customer invoices and aging by days outstanding.">
          {arAging && <AgingSummary report={arAging} />}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Invoice #</th><th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Due</th>
                  <th className="py-2 pr-4 text-right">Total</th><th className="py-2 pr-4 text-right">Paid</th>
                  <th className="py-2 pr-4 text-right">Due amount</th><th className="py-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-gray-400">No invoices</td></tr>}
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{inv.invoice_number}</td>
                    <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BILLING_STYLE[inv.status]}`}>{inv.status}</span></td>
                    <td className="py-2 pr-4 text-gray-500">{formatDate(inv.due_date)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(inv.total_cents)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(inv.paid_cents)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(inv.total_cents - inv.paid_cents)}</td>
                    <td className="py-2 pr-4 text-right">
                      {canPay && inv.status !== "paid" && inv.status !== "void" && (
                        <PayControl busy={busy} max={inv.total_cents - inv.paid_cents} onPay={(cents) => payInvoice(inv.id, cents)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Accounts Payable" description="Supplier bills and aging by days outstanding.">
          {apAging && <AgingSummary report={apAging} />}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Bill #</th><th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Due</th>
                  <th className="py-2 pr-4 text-right">Total</th><th className="py-2 pr-4 text-right">Paid</th>
                  <th className="py-2 pr-4 text-right">Due amount</th><th className="py-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bills.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-gray-400">No bills</td></tr>}
                {bills.map((bill) => (
                  <tr key={bill.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{bill.bill_number}</td>
                    <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BILLING_STYLE[bill.status]}`}>{bill.status}</span></td>
                    <td className="py-2 pr-4 text-gray-500">{formatDate(bill.due_date)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(bill.total_cents)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(bill.paid_cents)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(bill.total_cents - bill.paid_cents)}</td>
                    <td className="py-2 pr-4 text-right">
                      {canPay && bill.status !== "paid" && bill.status !== "void" && (
                        <PayControl busy={busy} max={bill.total_cents - bill.paid_cents} onPay={(cents) => payBill(bill.id, cents)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </EnterpriseShell>
  );
}

const AGING_BUCKETS: { key: keyof Omit<AgingReport["totals"], "total">; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1-30 days" },
  { key: "d31_60", label: "31-60 days" },
  { key: "d61_90", label: "61-90 days" },
  { key: "d90_plus", label: "90+ days" },
];

function AgingSummary({ report }: { report: AgingReport }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {AGING_BUCKETS.map(({ key, label }) => (
        <div key={key} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
          <p className="mt-1 text-sm font-semibold text-gray-900">{formatMoney(report.totals[key])}</p>
        </div>
      ))}
      <div className="col-span-2 rounded-lg border border-gray-200 bg-gray-100 p-3 sm:col-span-5">
        <p className="text-xs font-medium uppercase text-gray-500">Total outstanding</p>
        <p className="mt-1 text-sm font-semibold text-gray-900">{formatMoney(report.totals.total)}</p>
      </div>
    </div>
  );
}

function PayControl({ max, busy, onPay }: { max: number; busy: boolean; onPay: (amountCents: number) => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  if (!open) {
    return <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setOpen(true); setAmount((max / 100).toFixed(2)); }}>Pay</Button>;
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
        className="w-20 rounded border border-gray-300 px-1.5 py-1 text-right text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />
      <Button
        size="sm"
        variant="primary"
        disabled={busy || !valid}
        onClick={() => { if (valid) { onPay(cents); setOpen(false); } }}
      >
        Confirm
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
    </span>
  );
}
