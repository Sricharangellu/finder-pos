"use client";
import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { apiGet, apiPost, apiPatch, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type {
  CustomerInvoice, CustomerInvoiceLine, InvoiceStatus, CustomerInvoiceResponse,
} from "@/api-client/types";
import { fmtDate } from "@/lib/date";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STATUS_BADGE: Record<InvoiceStatus, BadgeVariant> = {
  draft: "gray", sent: "blue", partial: "yellow", paid: "green", overdue: "red", void: "gray",
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft", sent: "Sent", partial: "Partial", paid: "Paid", overdue: "Overdue", void: "Void",
};
const ALL_STATUSES: InvoiceStatus[] = ["draft", "sent", "partial", "paid", "overdue", "void"];

// ── Line item builder ─────────────────────────────────────────────────────────

interface LineItem {
  _key: number;
  upc: string;
  product_id: string | null;
  sku: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_rate_pct: number;
}

let lineKey = 0;
function emptyLine(): LineItem {
  return { _key: ++lineKey, upc: "", product_id: null, sku: null, name: "", quantity: 1, unit_price_cents: 0, discount_cents: 0, tax_rate_pct: 8.25 };
}

function lineTotal(l: LineItem): number {
  const base = l.quantity * l.unit_price_cents;
  const afterDiscount = base - l.discount_cents;
  return afterDiscount + Math.round(afterDiscount * l.tax_rate_pct / 100);
}

function InvoiceBuilder({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [scanning, setScanning] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const updateLine = (idx: number, patch: Partial<LineItem>) =>
    setLines((ls) => ls.map((l, i) => i === idx ? { ...l, ...patch } : l));

  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (idx: number) => setLines((ls) => ls.filter((_, i) => i !== idx));

  const lookupUpc = async (idx: number, upc: string) => {
    if (!upc.trim()) return;
    setScanning(idx);
    try {
      const result = await apiGet<{ product_id: string; name: string; price_cents: number; sku: string }>(
        `/api/v1/customer-invoices/lookup-upc?upc=${encodeURIComponent(upc)}`
      );
      updateLine(idx, { product_id: result.product_id, name: result.name, unit_price_cents: result.price_cents, sku: result.sku });
    } catch {
      updateLine(idx, { name: "Unknown product — enter manually" });
    } finally { setScanning(null); }
  };

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price_cents, 0);
  const totalDiscount = lines.reduce((s, l) => s + l.discount_cents, 0);
  const totalTax = lines.reduce((s, l) => s + Math.round((l.quantity * l.unit_price_cents - l.discount_cents) * l.tax_rate_pct / 100), 0);
  const total = subtotal - totalDiscount + totalTax;

  const handleSave = async () => {
    setSaving(true); setErr(null);
    try {
      await apiPost("/api/v1/customer-invoices", {
        customer_name: customerName || "Walk-in Customer",
        customer_email: customerEmail || null,
        customer_phone: customerPhone || null,
        billing_address: billingAddress || null,
        due_date: dueDate ? new Date(dueDate).getTime() : null,
        notes: notes || null,
        lines: lines.filter(l => l.name).map(l => ({
          product_id: l.product_id ?? null, upc: l.upc || null, sku: l.sku ?? null,
          name: l.name, quantity: l.quantity, unit_price_cents: l.unit_price_cents,
          discount_cents: l.discount_cents, tax_rate_pct: l.tax_rate_pct,
        })),
      });
      onSaved();
    } catch (ex) { setErr(ex instanceof ApiResponseError ? ex.message : "Failed to create invoice."); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl flex flex-col max-h-[95vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">New Customer Invoice</h2>
            <p className="text-xs text-slate-400 mt-0.5">Scan UPCs or enter products manually</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Customer info */}
          <div className="px-6 py-4 border-b border-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Customer Details</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-500 mb-1">Customer Name</label>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Walk-in Customer"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Email</label>
                <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="customer@email.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Phone</label>
                <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="555-0100"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-500 mb-1">Billing Address</label>
                <input value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)}
                  placeholder="Street, City, State ZIP"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Due Date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Terms, instructions…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="px-6 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Line Items</p>
            {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
            <div className="space-y-2">
              {/* Header */}
              <div className="grid grid-cols-[1fr_2fr_80px_100px_80px_60px_auto] gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <span>UPC / SKU</span><span>Product</span><span>Qty</span><span>Price</span><span>Discount</span><span>Tax %</span><span />
              </div>
              {lines.map((line, idx) => (
                <div key={line._key} className="grid grid-cols-[1fr_2fr_80px_100px_80px_60px_auto] gap-2 items-center">
                  <input
                    value={line.upc}
                    onChange={(e) => updateLine(idx, { upc: e.target.value })}
                    onBlur={(e) => void lookupUpc(idx, e.target.value)}
                    placeholder="Scan / type UPC"
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    value={scanning === idx ? "Looking up…" : line.name}
                    onChange={(e) => updateLine(idx, { name: e.target.value })}
                    placeholder="Product name"
                    disabled={scanning === idx}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <input type="number" min="1" value={line.quantity}
                    onChange={(e) => updateLine(idx, { quantity: parseInt(e.target.value, 10) || 1 })}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input type="number" min="0" step="0.01"
                    value={(line.unit_price_cents / 100).toFixed(2)}
                    onChange={(e) => updateLine(idx, { unit_price_cents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input type="number" min="0" step="0.01"
                    value={(line.discount_cents / 100).toFixed(2)}
                    onChange={(e) => updateLine(idx, { discount_cents: Math.round(parseFloat(e.target.value || "0") * 100) })}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input type="number" min="0" max="100" step="0.01"
                    value={line.tax_rate_pct}
                    onChange={(e) => updateLine(idx, { tax_rate_pct: parseFloat(e.target.value || "0") })}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-mono text-slate-500 w-16 text-right">{formatMoney(lineTotal(line))}</span>
                    <button onClick={() => removeLine(idx)} className="text-slate-300 hover:text-red-500 text-lg leading-none px-1">&times;</button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addLine} className="mt-3 text-sm text-blue-600 hover:underline">+ Add line</button>
          </div>
        </div>

        {/* Totals + actions */}
        <div className="border-t border-slate-200 px-6 py-4 flex items-end justify-between gap-4">
          <div className="space-y-1 text-sm min-w-48">
            <div className="flex justify-between text-slate-600"><span>Subtotal</span><span className="font-mono">{formatMoney(subtotal)}</span></div>
            {totalDiscount > 0 && <div className="flex justify-between text-slate-600"><span>Discount</span><span className="font-mono text-red-600">−{formatMoney(totalDiscount)}</span></div>}
            <div className="flex justify-between text-slate-600"><span>Tax</span><span className="font-mono">{formatMoney(totalTax)}</span></div>
            <div className="flex justify-between text-slate-900 font-semibold text-base border-t border-slate-200 pt-1"><span>Total</span><span className="font-mono">{formatMoney(total)}</span></div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Discard</Button>
            <Button variant="primary" onClick={() => void handleSave()} disabled={saving || lines.every(l => !l.name)}>
              {saving ? "Saving…" : "Create Invoice"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Invoice detail modal ──────────────────────────────────────────────────────

function InvoiceDetailModal({ invoice, onClose, onStatusChange }: {
  invoice: CustomerInvoice;
  onClose: () => void;
  onStatusChange: (status: InvoiceStatus, paidCents?: number) => Promise<void>;
}) {
  const [changing, setChanging] = useState(false);

  const next: Partial<Record<InvoiceStatus, InvoiceStatus>> = {
    draft: "sent", sent: "paid", partial: "paid",
  };

  const handleNext = async () => {
    const nextStatus = next[invoice.status];
    if (!nextStatus) return;
    setChanging(true);
    try { await onStatusChange(nextStatus, nextStatus === "paid" ? invoice.total_cents : undefined); }
    finally { setChanging(false); }
  };

  const totalLines = invoice.lines ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-950">{invoice.invoice_number}</h2>
              <Badge variant={STATUS_BADGE[invoice.status]}>{STATUS_LABEL[invoice.status]}</Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{invoice.customer_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Customer */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Customer", invoice.customer_name],
              ["Email", invoice.customer_email ?? "—"],
              ["Phone", invoice.customer_phone ?? "—"],
              ["Due", invoice.due_date ? fmtDate(invoice.due_date) : "—"],
              ["Billing Address", invoice.billing_address ?? "—"],
              ["Notes", invoice.notes ?? "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-xs text-slate-400">{k}</p>
                <p className="font-medium text-slate-900 break-words">{v}</p>
              </div>
            ))}
          </div>

          {/* Line items */}
          {totalLines.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Items</p>
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="text-left pb-1">Product</th>
                    <th className="text-center pb-1">Qty</th>
                    <th className="text-right pb-1">Price</th>
                    <th className="text-right pb-1">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {totalLines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1.5">
                        <p className="text-slate-900">{l.name}</p>
                        {l.upc && <p className="text-[11px] text-slate-400 font-mono">{l.upc}</p>}
                      </td>
                      <td className="py-1.5 text-center text-slate-600">{l.quantity}</td>
                      <td className="py-1.5 text-right font-mono text-slate-600">{formatMoney(l.unit_price_cents)}</td>
                      <td className="py-1.5 text-right font-mono font-medium text-slate-900">{formatMoney(l.line_total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals */}
          <div className="border-t border-slate-200 pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-slate-600"><span>Subtotal</span><span className="font-mono">{formatMoney(invoice.subtotal_cents)}</span></div>
            {invoice.discount_cents > 0 && <div className="flex justify-between text-slate-600"><span>Discount</span><span className="font-mono text-red-600">−{formatMoney(invoice.discount_cents)}</span></div>}
            <div className="flex justify-between text-slate-600"><span>Tax</span><span className="font-mono">{formatMoney(invoice.tax_cents)}</span></div>
            <div className="flex justify-between font-semibold text-slate-900 text-base"><span>Total</span><span className="font-mono">{formatMoney(invoice.total_cents)}</span></div>
            {invoice.paid_cents > 0 && invoice.paid_cents < invoice.total_cents && (
              <div className="flex justify-between text-amber-700"><span>Paid</span><span className="font-mono">{formatMoney(invoice.paid_cents)}</span></div>
            )}
            {invoice.paid_cents > 0 && invoice.paid_cents < invoice.total_cents && (
              <div className="flex justify-between text-red-700 font-semibold"><span>Balance Due</span><span className="font-mono">{formatMoney(invoice.total_cents - invoice.paid_cents)}</span></div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {next[invoice.status] && (
            <Button variant="primary" onClick={() => void handleNext()} disabled={changing}>
              {changing ? "…" : `Mark ${STATUS_LABEL[next[invoice.status]!]}`}
            </Button>
          )}
          {invoice.status !== "void" && !next[invoice.status] && invoice.status !== "paid" && (
            <Button variant="danger" onClick={() => void onStatusChange("void")} disabled={changing}>Void</Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InvoicingPage() {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");
  const [showBuilder, setShowBuilder] = useState(false);
  const [selected, setSelected] = useState<CustomerInvoice | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const data = await apiGet<CustomerInvoiceResponse>(`/api/v1/customer-invoices?${params}`);
      setInvoices(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load invoices.");
    } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const handleStatusChange = async (inv: CustomerInvoice, status: InvoiceStatus, paidCents?: number) => {
    try {
      const updated = await apiPatch<CustomerInvoice>(`/api/v1/customer-invoices/${inv.id}/status`, { status, paid_cents: paidCents });
      setSelected(updated);
      await load();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to update invoice.");
    }
  };

  const openDetail = async (inv: CustomerInvoice) => {
    try {
      const full = await apiGet<CustomerInvoice>(`/api/v1/customer-invoices/${inv.id}`);
      setSelected(full);
    } catch { setSelected(inv); }
  };

  const totalsByStatus = invoices.reduce((acc, inv) => {
    acc[inv.status] = (acc[inv.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalRevenue = invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.total_cents, 0);
  const totalOutstanding = invoices.filter(i => ["sent", "partial", "overdue"].includes(i.status)).reduce((s, i) => s + (i.total_cents - i.paid_cents), 0);

  return (
    <EnterpriseShell active="invoicing" title="Customer Invoices" subtitle="Create, send, and track customer invoices"
      contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-2xl font-bold text-slate-900">{total}</p>
            <p className="text-xs text-slate-500 mt-0.5">Total Invoices</p>
          </Card>
          <Card className="p-4">
            <p className="text-2xl font-bold text-emerald-700">{formatMoney(totalRevenue)}</p>
            <p className="text-xs text-slate-500 mt-0.5">Collected</p>
          </Card>
          <Card className="p-4">
            <p className="text-2xl font-bold text-amber-700">{formatMoney(totalOutstanding)}</p>
            <p className="text-xs text-slate-500 mt-0.5">Outstanding</p>
          </Card>
          <Card className="p-4">
            <p className="text-2xl font-bold text-red-700">{totalsByStatus["overdue"] ?? 0}</p>
            <p className="text-xs text-slate-500 mt-0.5">Overdue</p>
          </Card>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {(["all", ...ALL_STATUSES] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${statusFilter === s ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {s === "all" ? "All" : STATUS_LABEL[s]}
                {s !== "all" && totalsByStatus[s] ? ` (${totalsByStatus[s]})` : ""}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <Button variant="primary" onClick={() => setShowBuilder(true)}>+ New Invoice</Button>
          </div>
        </div>

        {/* Table */}
        <Card className="overflow-hidden p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">Loading invoices…</div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm font-medium text-slate-700">No invoices yet</p>
              <p className="text-xs text-slate-400">Create your first customer invoice to get started.</p>
              <button onClick={() => setShowBuilder(true)} className="mt-2 text-sm text-blue-600 hover:underline">Create invoice →</button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice #</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Total</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Paid</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Balance</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Due</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => {
                  const balance = inv.total_cents - inv.paid_cents;
                  const isOverdue = inv.status === "overdue";
                  return (
                    <tr key={inv.id} className={`hover:bg-slate-50 cursor-pointer ${isOverdue ? "bg-red-50/30" : ""}`}
                      onClick={() => void openDetail(inv)}>
                      <td className="px-5 py-3 font-mono text-blue-600 font-medium">{inv.invoice_number}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{inv.customer_name}</p>
                        {inv.customer_email && <p className="text-xs text-slate-400">{inv.customer_email}</p>}
                      </td>
                      <td className="px-5 py-3"><Badge variant={STATUS_BADGE[inv.status]}>{STATUS_LABEL[inv.status]}</Badge></td>
                      <td className="px-5 py-3 text-right font-mono font-medium text-slate-900">{formatMoney(inv.total_cents)}</td>
                      <td className="px-5 py-3 text-right font-mono text-slate-500">{formatMoney(inv.paid_cents)}</td>
                      <td className={`px-5 py-3 text-right font-mono font-medium ${balance > 0 ? (isOverdue ? "text-red-700" : "text-amber-700") : "text-emerald-600"}`}>
                        {balance > 0 ? formatMoney(balance) : "—"}
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-xs">
                        {inv.due_date ? fmtDate(inv.due_date) : "—"}
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs">{fmtDate(inv.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!loading && total > 0 && (
            <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
              {total} invoice{total !== 1 ? "s" : ""}
            </div>
          )}
        </Card>
      </div>

      {showBuilder && (
        <InvoiceBuilder onClose={() => setShowBuilder(false)} onSaved={() => { setShowBuilder(false); void load(); }} />
      )}
      {selected && (
        <InvoiceDetailModal
          invoice={selected}
          onClose={() => setSelected(null)}
          onStatusChange={async (status, paid) => handleStatusChange(selected, status, paid)}
        />
      )}
    </EnterpriseShell>
  );
}
