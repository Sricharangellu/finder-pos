"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/date";
import { apiGet, ApiResponseError } from "@/api-client/client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string; name: string; company: string | null; dba: string | null;
  email: string | null; phone: string | null; contact_name: string | null;
  primary_sales_rep: string | null; address1: string | null;
  city: string | null; state: string | null; zip: string | null;
  tax_id: string | null; fein_number: string | null;
  vendor_type: string | null; msa_type: string | null;
  terms_days: number | null; payment_method: string | null;
  lead_time_days: number | null; status: "active" | "inactive" | string;
  poCount: number; totalSpentCents: number; openCreditsCents: number;
  avg_po_value_cents: number;
  on_time_delivery_pct: number; fill_rate_pct: number; dispute_rate_pct: number;
  notes: string | null; created_at: number;
}

interface VendorProduct {
  id: string; product_id: string; product_name: string; sku: string;
  vendor_sku: string | null; cost_cents: number; retail_price_cents: number;
  margin_pct: number; last_cost_cents: number; moq: number | null;
  lead_time_days: number | null; is_preferred: boolean; last_ordered_at: number | null;
}

interface VendorPO {
  id: string; po_number: string; status: string; receive_status: string;
  total_cost_cents: number; line_count: number;
  created_at: number; received_at: number | null;
}

interface VendorInvoice {
  id: string; bill_number: string; po_id: string | null; po_number: string | null;
  status: "open" | "partial" | "paid" | "void" | string;
  total_cents: number; paid_cents: number; due_date: number; issued_at: number;
}

interface VendorCredit {
  id: string; type: "chargeback" | "credit_memo" | string;
  amount_cents: number; reason: string | null; po_id: string | null;
  po_number: string | null; status: "open" | "applied" | "void" | string;
  created_at: number;
}

interface ReceivingEvent {
  id: string; po_id: string; po_number: string; received_by: string;
  received_at: number; qty_ordered: number; qty_received: number;
  short_qty: number; damage_qty: number; notes: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

type Tab = "profile" | "products" | "pos" | "invoices" | "credits" | "receiving";

const TABS: { key: Tab; label: string }[] = [
  { key: "profile",   label: "Profile" },
  { key: "products",  label: "Products" },
  { key: "pos",       label: "Purchase Orders" },
  { key: "invoices",  label: "Invoices" },
  { key: "credits",   label: "Credits" },
  { key: "receiving", label: "Receiving" },
];

const PO_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  ordered:   { bg: "bg-blue-100",    text: "text-blue-700" },
  received:  { bg: "bg-emerald-100", text: "text-emerald-700" },
  billed:    { bg: "bg-violet-100",  text: "text-violet-700" },
  cancelled: { bg: "bg-red-100",     text: "text-red-600" },
  draft:     { bg: "bg-slate-100",   text: "text-slate-500" },
};

const INVOICE_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open:    { bg: "bg-amber-100",   text: "text-amber-700",   label: "Open" },
  partial: { bg: "bg-blue-100",    text: "text-blue-700",    label: "Partial" },
  paid:    { bg: "bg-emerald-100", text: "text-emerald-700", label: "Paid" },
  void:    { bg: "bg-red-100",     text: "text-red-600",     label: "Void" },
};

const CREDIT_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  open:    { bg: "bg-amber-100",   text: "text-amber-700" },
  applied: { bg: "bg-emerald-100", text: "text-emerald-700" },
  void:    { bg: "bg-red-100",     text: "text-red-600" },
};

// ── Helper hooks ──────────────────────────────────────────────────────────────

function useVendorSub<T>(vendorId: string, path: string, enabled: boolean) {
  const [data, setData]     = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiGet<{ items: T[] }>(`/api/v1/purchasing/vendors/${vendorId}/${path}`);
      setData(res.items ?? []);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load.");
    } finally { setLoading(false); }
  }, [vendorId, path]);

  useEffect(() => { if (enabled) void load(); }, [load, enabled]);
  return { data, loading, error };
}

// ── Sub-tab components ────────────────────────────────────────────────────────

function ProfileTab({ vendor }: { vendor: Vendor }) {
  const infoRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-start gap-2 py-2.5 border-b border-slate-100 last:border-0">
      <span className="w-40 shrink-0 text-xs text-slate-400">{label}</span>
      <span className="text-sm text-slate-900">{value ?? <span className="text-slate-300">—</span>}</span>
    </div>
  );

  const perfMetric = (label: string, value: number, good: number, bad: number, suffix = "%") => {
    const color = value >= good ? "text-emerald-700" : value >= bad ? "text-amber-600" : "text-red-600";
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
        <p className={`text-xl font-black ${color}`}>{value}{suffix}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{label}</p>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Scorecard */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {perfMetric("On-time delivery", vendor.on_time_delivery_pct, 90, 75)}
        {perfMetric("Fill rate", vendor.fill_rate_pct, 95, 80)}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
          <p className={`text-xl font-black ${vendor.dispute_rate_pct <= 2 ? "text-emerald-700" : vendor.dispute_rate_pct <= 5 ? "text-amber-600" : "text-red-600"}`}>
            {vendor.dispute_rate_pct}%
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">Dispute rate</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
          <p className="text-xl font-black text-slate-900">{vendor.lead_time_days ?? "—"} <span className="text-sm font-normal text-slate-400">days</span></p>
          <p className="mt-0.5 text-[11px] text-slate-400">Lead time</p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Contact */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Contact</h3>
          {infoRow("Company", vendor.company ?? vendor.name)}
          {infoRow("DBA", vendor.dba)}
          {infoRow("Contact", vendor.contact_name)}
          {infoRow("Sales rep", vendor.primary_sales_rep)}
          {infoRow("Email", vendor.email ? <a href={`mailto:${vendor.email}`} className="text-[#5D5FEF] hover:underline">{vendor.email}</a> : null)}
          {infoRow("Phone", vendor.phone)}
          {infoRow("Address", [vendor.address1, vendor.city, vendor.state, vendor.zip].filter(Boolean).join(", ") || null)}
        </div>

        {/* Commercial */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Commercial Terms</h3>
          {infoRow("Vendor type", vendor.vendor_type ? <span className="capitalize">{vendor.vendor_type}</span> : null)}
          {infoRow("MSA type", vendor.msa_type ? <span className="capitalize">{vendor.msa_type}</span> : null)}
          {infoRow("Payment terms", vendor.terms_days != null ? `Net ${vendor.terms_days}` : null)}
          {infoRow("Payment method", vendor.payment_method ? <span className="capitalize">{vendor.payment_method.replace(/_/g, " ")}</span> : null)}
          {infoRow("Tax ID", vendor.tax_id)}
          {infoRow("FEIN", vendor.fein_number)}
          {infoRow("Member since", fmtDate(vendor.created_at))}
        </div>
      </div>

      {/* Financials */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Financial summary</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Total spend",    value: formatMoney(vendor.totalSpentCents), color: "text-slate-900" },
            { label: "Total POs",      value: vendor.poCount,                       color: "text-slate-900" },
            { label: "Avg PO value",   value: formatMoney(vendor.avg_po_value_cents), color: "text-slate-900" },
            { label: "Open credits",   value: formatMoney(vendor.openCreditsCents),  color: vendor.openCreditsCents > 0 ? "text-emerald-700" : "text-slate-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg bg-slate-50 px-3 py-2.5">
              <p className="text-[11px] text-slate-400">{label}</p>
              <p className={`mt-0.5 text-base font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      {vendor.notes && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">Notes</p>
          <p className="mt-1 text-sm text-amber-900">{vendor.notes}</p>
        </div>
      )}
    </div>
  );
}

function ProductsTab({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const { data: products, loading, error } = useVendorSub<VendorProduct>(vendorId, "products", true);

  if (loading) return <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}</div>;
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (products.length === 0) return (
    <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
      No products linked to this vendor.
    </div>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr className="text-left">
            <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Product</th>
            <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Vendor SKU</th>
            <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">Cost</th>
            <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">Retail</th>
            <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">Margin</th>
            <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">MOQ</th>
            <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">Lead</th>
            <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Last ordered</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {products.map((p) => (
            <tr key={p.id} className="group hover:bg-slate-50 transition-colors">
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-2">
                  {p.is_preferred && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700">Preferred</span>}
                  <button type="button" onClick={() => router.push(`/catalog/${p.product_id}`)}
                    className="text-sm font-medium text-[#5D5FEF] hover:underline text-left">
                    {p.product_name}
                  </button>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">{p.sku}</p>
              </td>
              <td className="px-5 py-3.5 text-xs font-mono text-slate-500">{p.vendor_sku ?? "—"}</td>
              <td className="px-5 py-3.5 text-right">
                <span className="text-sm font-semibold text-slate-900">{formatMoney(p.cost_cents)}</span>
                {p.cost_cents !== p.last_cost_cents && (
                  <span className={`ml-1 text-[10px] ${p.cost_cents > p.last_cost_cents ? "text-red-500" : "text-emerald-600"}`}>
                    {p.cost_cents > p.last_cost_cents ? "↑" : "↓"}
                  </span>
                )}
              </td>
              <td className="px-5 py-3.5 text-right text-sm text-slate-700">{formatMoney(p.retail_price_cents)}</td>
              <td className="px-5 py-3.5 text-right">
                <span className={`text-xs font-semibold ${p.margin_pct >= 35 ? "text-emerald-700" : p.margin_pct >= 20 ? "text-amber-600" : "text-red-600"}`}>
                  {p.margin_pct.toFixed(1)}%
                </span>
              </td>
              <td className="px-5 py-3.5 text-right text-xs text-slate-600">{p.moq ?? "—"}</td>
              <td className="px-5 py-3.5 text-right text-xs text-slate-600">{p.lead_time_days != null ? `${p.lead_time_days}d` : "—"}</td>
              <td className="px-5 py-3.5 text-xs text-slate-500">{p.last_ordered_at ? fmtDate(p.last_ordered_at) : "—"}</td>
              <td className="px-5 py-3.5">
                <button type="button" onClick={() => router.push(`/purchasing/new?supplier=${vendorId}&product=${p.product_id}`)}
                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 opacity-0 group-hover:opacity-100 hover:bg-slate-50 transition-all whitespace-nowrap">
                  Create PO
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PurchaseOrdersTab({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const { data: pos, loading, error } = useVendorSub<VendorPO>(vendorId, "purchase-orders", true);

  if (loading) return <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>;
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (pos.length === 0) return (
    <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
      No purchase orders for this vendor.
      <button type="button" onClick={() => router.push(`/purchasing/new?supplier=${vendorId}`)}
        className="mt-2 block mx-auto text-sm text-[#5D5FEF] hover:underline">Create PO</button>
    </div>
  );

  const totalSpend = pos.filter((p) => p.status !== "cancelled").reduce((s, p) => s + p.total_cost_cents, 0);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr className="text-left">
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">PO #</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Status</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Lines</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">Total</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Created</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Received</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pos.map((po) => {
              const st = PO_STATUS_STYLES[po.status] ?? PO_STATUS_STYLES.draft;
              return (
                <tr key={po.id} className="group cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => router.push(`/purchasing/${po.id}`)}>
                  <td className="px-5 py-3.5">
                    <span className="text-sm font-semibold text-[#5D5FEF]">{po.po_number}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize ${st.bg} ${st.text}`}>
                      {po.status}
                    </span>
                    {po.receive_status !== po.status && po.receive_status && (
                      <span className="ml-1.5 text-[10px] text-slate-400 capitalize">{po.receive_status}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-600">{po.line_count} line{po.line_count !== 1 ? "s" : ""}</td>
                  <td className="px-5 py-3.5 text-right font-semibold text-slate-900">{formatMoney(po.total_cost_cents)}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{fmtDate(po.created_at)}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{po.received_at ? fmtDate(po.received_at) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50">
            <tr>
              <td colSpan={3} className="px-5 py-2.5 text-xs text-slate-400">{pos.length} POs</td>
              <td className="px-5 py-2.5 text-right text-sm font-bold text-slate-900">{formatMoney(totalSpend)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={() => router.push(`/purchasing/new?supplier=${vendorId}`)}
          className="rounded-lg bg-[#5D5FEF] px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600">
          + New Purchase Order
        </button>
      </div>
    </div>
  );
}

function InvoicesTab({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const { data: invoices, loading, error } = useVendorSub<VendorInvoice>(vendorId, "invoices", true);

  if (loading) return <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>;
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (invoices.length === 0) return (
    <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
      No invoices on record.
    </div>
  );

  const totalOwed = invoices.filter((i) => i.status !== "void" && i.status !== "paid").reduce((s, i) => s + (i.total_cents - i.paid_cents), 0);

  return (
    <div className="space-y-4">
      {totalOwed > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm text-amber-800">
          <svg className="h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span><strong>{formatMoney(totalOwed)}</strong> outstanding balance across {invoices.filter((i) => i.status !== "void" && i.status !== "paid").length} invoice{invoices.length !== 1 ? "s" : ""}</span>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr className="text-left">
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Invoice #</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">PO</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Status</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">Total</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">Paid</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500 text-right">Balance</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Due date</th>
              <th className="px-5 py-2.5 text-xs font-semibold text-slate-500">Issued</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((inv) => {
              const st = INVOICE_STATUS_STYLES[inv.status] ?? INVOICE_STATUS_STYLES.open;
              const balance = inv.total_cents - inv.paid_cents;
              const isOverdue = inv.status !== "paid" && inv.status !== "void" && inv.due_date < Date.now();
              return (
                <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 text-sm font-mono font-medium text-slate-900">{inv.bill_number}</td>
                  <td className="px-5 py-3.5">
                    {inv.po_number ? (
                      <button type="button" onClick={() => router.push(`/purchasing/${inv.po_id}`)}
                        className="text-xs text-[#5D5FEF] hover:underline">{inv.po_number}</button>
                    ) : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.bg} ${st.text}`}>{st.label}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold text-slate-900">{formatMoney(inv.total_cents)}</td>
                  <td className="px-5 py-3.5 text-right text-xs text-slate-600">{inv.paid_cents > 0 ? formatMoney(inv.paid_cents) : "—"}</td>
                  <td className="px-5 py-3.5 text-right">
                    {balance > 0 ? (
                      <span className={`text-sm font-bold ${isOverdue ? "text-red-600" : "text-amber-700"}`}>{formatMoney(balance)}</span>
                    ) : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-5 py-3.5 text-xs">
                    <span className={isOverdue ? "font-semibold text-red-600" : "text-slate-500"}>
                      {fmtDate(inv.due_date)}{isOverdue ? " ⚠" : ""}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-400">{fmtDate(inv.issued_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreditsTab({ vendorId }: { vendorId: string }) {
  const { data: credits, loading, error } = useVendorSub<VendorCredit>(vendorId, "credits", true);

  if (loading) return <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>;
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (credits.length === 0) return (
    <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">No credits on record.</div>
  );

  const openBalance = credits.filter((c) => c.status === "open").reduce((s, c) => s + c.amount_cents, 0);

  return (
    <div className="space-y-4">
      {openBalance > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3.5 text-sm text-emerald-800">
          <span><strong>{formatMoney(openBalance)}</strong> in open credits available</span>
        </div>
      )}
      <div className="space-y-3">
        {credits.map((c) => {
          const st = CREDIT_STATUS_STYLES[c.status] ?? CREDIT_STATUS_STYLES.open;
          return (
            <div key={c.id} className="flex items-start justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${st.bg} ${st.text}`}>{c.status}</span>
                  <span className="text-sm font-semibold capitalize text-slate-900">{c.type.replace(/_/g, " ")}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{c.reason ?? "No reason provided"}</p>
                {c.po_number && <p className="mt-0.5 text-[11px] text-slate-400">PO: {c.po_number}</p>}
                <p className="mt-0.5 text-[11px] text-slate-300">{fmtDateTime(c.created_at)}</p>
              </div>
              <span className="text-base font-black text-slate-900">{formatMoney(c.amount_cents)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReceivingTab({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const { data: events, loading, error } = useVendorSub<ReceivingEvent>(vendorId, "receiving", true);

  if (loading) return <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}</div>;
  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (events.length === 0) return (
    <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">No receiving history.</div>
  );

  return (
    <div className="space-y-3">
      {events.map((ev) => {
        const hasIssues = ev.short_qty > 0 || ev.damage_qty > 0;
        return (
          <div key={ev.id} className={`rounded-xl border bg-white px-5 py-4 shadow-sm ${hasIssues ? "border-amber-200" : "border-slate-200"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => router.push(`/purchasing/${ev.po_id}`)}
                    className="text-sm font-semibold text-[#5D5FEF] hover:underline">{ev.po_number}</button>
                  {hasIssues && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Issues</span>}
                </div>
                <p className="mt-0.5 text-xs text-slate-400">Received by {ev.received_by} · {fmtDateTime(ev.received_at)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-slate-900">{ev.qty_received} / {ev.qty_ordered}</p>
                <p className="text-[11px] text-slate-400">received / ordered</p>
              </div>
            </div>
            {hasIssues && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {ev.short_qty > 0 && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs">
                    <span className="font-semibold text-amber-800">{ev.short_qty} units short</span>
                  </div>
                )}
                {ev.damage_qty > 0 && (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-xs">
                    <span className="font-semibold text-red-700">{ev.damage_qty} units damaged</span>
                  </div>
                )}
              </div>
            )}
            {ev.notes && <p className="mt-2 text-xs text-slate-600 italic">{ev.notes}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [vendor, setVendor]     = useState<Vendor | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const v = await apiGet<Vendor>(`/api/v1/purchasing/vendors/${id}`);
      setVendor(v);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load vendor.");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <EnterpriseShell active="vendors" title="Vendor" subtitle="Loading…" contentClassName="overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6">
          {[1,2,3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      </EnterpriseShell>
    );
  }

  if (error || !vendor) {
    return (
      <EnterpriseShell active="vendors" title="Vendor" subtitle="Not found" contentClassName="overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? "Vendor not found."}</p>
          <button type="button" onClick={() => router.push("/vendors")} className="mt-3 text-sm text-[#5D5FEF] hover:underline">
            ← Back to Vendors
          </button>
        </div>
      </EnterpriseShell>
    );
  }

  return (
    <EnterpriseShell active="vendors" title={vendor.name} subtitle={vendor.company ?? vendor.vendor_type ?? "Vendor"} contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">

        {/* Back */}
        <button type="button" onClick={() => router.push("/vendors")}
          className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7"/>
          </svg>
          Vendors
        </button>

        {/* Header */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">{vendor.name}</h1>
              <Badge variant={vendor.status === "active" ? "green" : "gray"}>{vendor.status}</Badge>
              {vendor.vendor_type && (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 capitalize">{vendor.vendor_type}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {vendor.contact_name && <span>👤 {vendor.contact_name}</span>}
              {vendor.email && <a href={`mailto:${vendor.email}`} className="text-[#5D5FEF] hover:underline">{vendor.email}</a>}
              {vendor.city && <span>📍 {vendor.city}, {vendor.state}</span>}
              {vendor.terms_days != null && <span>Net {vendor.terms_days}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => router.push(`/purchasing/new?supplier=${vendor.id}`)}
              className="rounded-lg bg-[#5D5FEF] px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600">
              + New PO
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total spend",   value: formatMoney(vendor.totalSpentCents), color: "text-slate-900" },
            { label: "POs",           value: vendor.poCount,                       color: "text-slate-900" },
            { label: "Open credits",  value: formatMoney(vendor.openCreditsCents), color: vendor.openCreditsCents > 0 ? "text-emerald-700" : "text-slate-400" },
            { label: "Lead time",     value: vendor.lead_time_days != null ? `${vendor.lead_time_days} days` : "—", color: "text-slate-900" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] text-slate-400">{label}</p>
              <p className={`mt-0.5 text-base font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="-mx-1 mb-5 overflow-x-auto">
          <div className="flex min-w-max gap-0 border-b border-slate-200 px-1">
            {TABS.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setActiveTab(key)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === key
                    ? "border-b-2 border-[#5D5FEF] text-[#5D5FEF]"
                    : "border-b-2 border-transparent text-slate-500 hover:text-slate-800"
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "profile"   && <ProfileTab vendor={vendor} />}
        {activeTab === "products"  && <ProductsTab vendorId={id} />}
        {activeTab === "pos"       && <PurchaseOrdersTab vendorId={id} />}
        {activeTab === "invoices"  && <InvoicesTab vendorId={id} />}
        {activeTab === "credits"   && <CreditsTab vendorId={id} />}
        {activeTab === "receiving" && <ReceivingTab vendorId={id} />}

      </div>
    </EnterpriseShell>
  );
}
