"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost } from "@/api-client/client";
import type { CustomerSummary } from "@/api-client/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CustomerView {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  visits: number;
  spendCents: number;
  avgOrderCents: number;
  segment: "Loyal" | "Regular" | "New" | "At risk";
  loyaltyPoints: number;
  lastVisitAt: number | null;
  recentOrders: CustomerSummary["recentOrders"];
  notes: string;
}

type DetailTab = "details" | "loyalty" | "account" | "notes";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLastVisit(timestamp: number | null) {
  if (timestamp === null) return "No visits";
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function formatOrderDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function PanelField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-white/40">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

// ── Tab components ────────────────────────────────────────────────────────────

function DetailsTab({ customer }: { customer: CustomerView }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <PanelField label="Email" value={customer.email ?? "—"} />
      <PanelField label="Phone" value={customer.phone ?? "—"} />
      <PanelField label="Avg order" value={formatMoney(customer.avgOrderCents)} />
      <PanelField label="Last visit" value={formatLastVisit(customer.lastVisitAt)} />
    </div>
  );
}

function LoyaltyTab({ customer }: { customer: CustomerView }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="text-3xl font-bold text-white">{customer.loyaltyPoints.toLocaleString()}</span>
        <span className="ml-2 text-sm text-white/50">points</span>
      </div>
      {customer.recentOrders.length === 0 ? (
        <p className="text-sm text-white/50">No purchase history yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-white/40">
              <th className="pb-2 font-medium">Order</th>
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 text-right font-medium">Total</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {customer.recentOrders.map((o) => (
              <tr key={o.id}>
                <td className="py-2 font-mono text-xs text-white/80">{o.orderNumber}</td>
                <td className="py-2 text-white/60">{formatOrderDate(o.createdAt)}</td>
                <td className="py-2 text-right font-semibold text-white">{formatMoney(o.totalCents)}</td>
                <td className="py-2 capitalize text-white/60">{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StoreCreditPanel({ customerId }: { customerId: string }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"add" | "deduct">("add");

  useEffect(() => {
    setLoading(true);
    apiGet<{ balanceCents: number }>(`/api/v1/customers/${customerId}/store-credit`)
      .then((r) => setBalance(r.balanceCents))
      .catch(() => setBalance(0))
      .finally(() => setLoading(false));
  }, [customerId]);

  const handleAdjust = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!cents || cents <= 0) { setError("Enter a positive amount."); return; }
    if (!reason.trim()) { setError("Reason is required."); return; }
    setAdjusting(true); setError(null);
    try {
      const delta = mode === "add" ? cents : -cents;
      const result = await apiPost<{ balanceCents: number }>(
        `/api/v1/customers/${customerId}/store-credit`,
        { deltaCents: delta, reason: reason.trim() },
      );
      setBalance(result.balanceCents);
      setAmount(""); setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjustment failed.");
    } finally { setAdjusting(false); }
  };

  return (
    <div className="rounded-md bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Store Credit</h3>
        {loading ? (
          <div className="h-5 w-20 animate-pulse rounded bg-gray-200" />
        ) : (
          <span className="text-lg font-bold text-emerald-600">{formatMoney(balance ?? 0)}</span>
        )}
      </div>
      <div className="mt-3 flex gap-1.5">
        {(["add", "deduct"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold capitalize transition-colors ${mode === m ? "bg-[#5D5FEF] text-white" : "border border-slate-200 text-slate-600 hover:bg-gray-50"}`}>
            {m === "add" ? "Add credit" : "Deduct"}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-2">
        <input type="number" min="0.01" step="0.01" placeholder="Amount ($)"
          value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }}
          className="w-full rounded border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-[#5D5FEF]" />
        <input type="text" placeholder="Reason (required)"
          value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }}
          className="w-full rounded border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-[#5D5FEF]" />
        {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        <button type="button" disabled={adjusting || !amount || !reason} onClick={() => void handleAdjust()}
          className="w-full rounded-md bg-[#5D5FEF] py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0] disabled:opacity-40">
          {adjusting ? "Applying…" : mode === "add" ? "Add Credit" : "Deduct Credit"}
        </button>
      </div>
    </div>
  );
}

function AccountTab({ customer }: { customer: CustomerView }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md bg-white/5 p-4">
          <p className="text-xs font-medium uppercase text-white/40">Lifetime spend</p>
          <p className="mt-1 text-2xl font-bold text-white">{formatMoney(customer.spendCents)}</p>
          <p className="mt-0.5 text-xs text-white/40">{customer.visits} visits</p>
        </div>
        <div className="rounded-md bg-white/5 p-4">
          <p className="text-xs font-medium uppercase text-white/40">Average order</p>
          <p className="mt-1 text-2xl font-bold text-white">{formatMoney(customer.avgOrderCents)}</p>
        </div>
      </div>
      <div className="rounded-md bg-white p-1">
        <StoreCreditPanel customerId={customer.id} />
      </div>
    </div>
  );
}

function NotesTab({ customer }: { customer: CustomerView }) {
  return <p className="max-w-2xl text-sm leading-relaxed text-white/70">{customer.notes}</p>;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function CustomerDetailPanel({ customer }: { customer: CustomerView }) {
  const [tab, setTab] = useState<DetailTab>("details");

  return (
    <div className="bg-[#1a1a1a] text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-6">
        <div className="flex">
          {(["details", "loyalty", "account", "notes"] as DetailTab[]).map((t) => (
            <button key={t} type="button" onClick={(e) => { e.stopPropagation(); setTab(t); }}
              className={`px-4 py-3 text-sm font-medium capitalize transition-colors ${tab === t ? "border-b-2 border-[#5D5FEF] text-white" : "text-white/50 hover:text-white/75"}`}>
              {t}
            </button>
          ))}
        </div>
        <button type="button" onClick={(e) => e.stopPropagation()}
          className="my-2 rounded-md bg-[#5D5FEF] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0]">
          Edit customer
        </button>
      </div>
      <div className="px-6 py-5" onClick={(e) => e.stopPropagation()}>
        {tab === "details" && <DetailsTab customer={customer} />}
        {tab === "loyalty" && <LoyaltyTab customer={customer} />}
        {tab === "account" && <AccountTab customer={customer} />}
        {tab === "notes" && <NotesTab customer={customer} />}
      </div>
    </div>
  );
}
