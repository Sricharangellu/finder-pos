"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/date";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { Can } from "@/components/rbac";

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderStatus = "open" | "completed" | "refunded" | "voided";

interface OrderLine {
  id: string; orderId: string; productId: string; name: string;
  quantity: number; unitCents: number; taxCents: number; lineCents: number; taxable: boolean;
}

interface OrderPayment {
  id: string; method: string; amountCents: number;
  cardLast4?: string; authCode?: string; status: string; createdAt: number;
}

interface TimelineEvent {
  id: string; type: string; label: string; actor: string; ts: number;
  meta?: Record<string, unknown>;
}

interface Order {
  id: string; orderNumber: string; stateCode: string; status: OrderStatus;
  subtotalCents: number; discountCents: number; taxCents: number; totalCents: number;
  customerId?: string; customer_name?: string; outlet_name?: string;
  cashier_name?: string; channel?: string; notes?: string;
  lines: OrderLine[];
  payments?: OrderPayment[];
  createdAt: number; updatedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<OrderStatus, { bg: string; text: string; label: string }> = {
  open:      { bg: "bg-blue-100",    text: "text-blue-700",    label: "Open" },
  completed: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Completed" },
  refunded:  { bg: "bg-amber-100",   text: "text-amber-700",   label: "Refunded" },
  voided:    { bg: "bg-red-100",     text: "text-red-600",     label: "Voided" },
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash", card: "Credit / Debit", split: "Split tender",
  store_credit: "Store credit", gift_card: "Gift card",
};

const TIMELINE_ICONS: Record<string, string> = {
  created:   "M12 2a10 10 0 100 20A10 10 0 0012 2zm1 5H11v6l5 3-1 1.7-6-3.7V7z",
  payment:   "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1 7v4.4l3.7 2.2-.7 1.2-4-2.4V9h1z",
  completed: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  refunded:  "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6",
  voided:    "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
};

const TIMELINE_COLORS: Record<string, string> = {
  created: "bg-slate-100 text-slate-500", payment: "bg-blue-100 text-blue-600",
  completed: "bg-emerald-100 text-emerald-600", refunded: "bg-amber-100 text-amber-600",
  voided: "bg-red-100 text-red-600",
};

type Tab = "lines" | "payments" | "returns" | "activity";
const TABS: { key: Tab; label: string }[] = [
  { key: "lines",    label: "Order Lines" },
  { key: "payments", label: "Payments" },
  { key: "returns",  label: "Returns" },
  { key: "activity", label: "Activity" },
];

// ── Confirmation modal ────────────────────────────────────────────────────────

function ConfirmModal({
  open, title, description, confirmLabel, confirmClass, onConfirm, onClose, loading,
}: {
  open: boolean; title: string; description: string; confirmLabel: string;
  confirmClass?: string; onConfirm: () => void; onClose: () => void; loading: boolean;
}) {
  if (!open) return null;
  return (
    <Modal open title={title} onClose={onClose}>
      <p className="text-sm text-slate-600">{description}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={loading}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={loading}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${confirmClass ?? "bg-brand-600 hover:bg-indigo-600"}`}>
          {loading ? "Processing…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [order, setOrder]           = useState<Order | null>(null);
  const [timeline, setTimeline]     = useState<TimelineEvent[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [activeTab, setActiveTab]   = useState<Tab>("lines");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Confirmation states
  const [showVoid, setShowVoid]         = useState(false);
  const [showRefund, setShowRefund]     = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError]   = useState<string | null>(null);

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ord, tl] = await Promise.all([
        apiGet<Order>(`/api/v1/orders/${id}`),
        apiGet<{ items: TimelineEvent[] }>(`/api/v1/orders/${id}/timeline`).then((r) => r.items).catch(() => []),
      ]);
      setOrder(ord);
      setTimeline(tl);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load order.");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const doVoid = async () => {
    setActionLoading(true); setActionError(null);
    try {
      const updated = await apiPost<Order>(`/api/v1/orders/${id}/void`, {});
      setOrder(updated);
      setShowVoid(false);
      flash("Order voided.");
      void load();
    } catch (e) {
      setActionError(e instanceof ApiResponseError ? e.message : "Could not void order.");
    } finally { setActionLoading(false); }
  };

  const doRefund = async () => {
    setActionLoading(true); setActionError(null);
    try {
      const updated = await apiPost<Order>(`/api/v1/orders/${id}/refund`, {});
      setOrder(updated);
      setShowRefund(false);
      flash("Refund issued.");
      void load();
    } catch (e) {
      setActionError(e instanceof ApiResponseError ? e.message : "Could not refund order.");
    } finally { setActionLoading(false); }
  };

  const doEmailReceipt = async () => {
    try {
      await apiPost(`/api/v1/orders/${id}/email-receipt`, {});
      flash("Receipt emailed to customer.");
    } catch { /* silent */ }
  };

  if (loading) {
    return (
      <EnterpriseShell active="sales" title="Order" subtitle="Loading…" contentClassName="overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      </EnterpriseShell>
    );
  }

  if (error || !order) {
    return (
      <EnterpriseShell active="sales" title="Order" subtitle="Not found" contentClassName="overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? "Order not found."}</p>
          <button type="button" onClick={() => router.push("/orders")}
            className="mt-3 text-sm text-brand-600 hover:underline">
            ← Back to Orders
          </button>
        </div>
      </EnterpriseShell>
    );
  }

  const st = STATUS_STYLES[order.status] ?? STATUS_STYLES.open;
  const canVoid    = order.status === "open";
  const canRefund  = order.status === "completed";

  return (
    <EnterpriseShell active="sales" title={`Order ${order.orderNumber}`} subtitle={fmtDateTime(order.createdAt)} contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">

        {/* ── Back ──────────────────────────────────────────────────────────── */}
        <button type="button" onClick={() => router.push("/orders")}
          className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19l-7-7 7-7"/>
          </svg>
          Orders
        </button>

        {/* ── Success banner ────────────────────────────────────────────────── */}
        {successMsg && (
          <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
            <svg className="h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
            </svg>
            {successMsg}
          </div>
        )}

        {/* ── Error banner ──────────────────────────────────────────────────── */}
        {actionError && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{actionError}</div>
        )}

        {/* ── Header card ───────────────────────────────────────────────────── */}
        <div className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5">
            {/* Order info */}
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900">{order.orderNumber}</h1>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.bg} ${st.text}`}>
                  {st.label}
                </span>
                {order.channel && order.channel !== "in-store" && (
                  <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700 capitalize">
                    {order.channel}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                <span>{fmtDateTime(order.createdAt)}</span>
                {order.outlet_name && <span>📍 {order.outlet_name}</span>}
                {order.cashier_name && <span>👤 {order.cashier_name}</span>}
                <span>🌎 {order.stateCode}</span>
              </div>
              {order.notes && (
                <p className="mt-1 max-w-md rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 border border-amber-200">
                  {order.notes}
                </p>
              )}
            </div>

            {/* Totals */}
            <div className="text-right">
              <p className="text-2xl font-black text-slate-900">{formatMoney(order.totalCents)}</p>
              <div className="mt-0.5 flex flex-col gap-0.5 text-xs text-slate-400">
                <span>Subtotal: {formatMoney(order.subtotalCents)}</span>
                {order.discountCents > 0 && <span className="text-red-500">Discount: −{formatMoney(order.discountCents)}</span>}
                <span>Tax: {formatMoney(order.taxCents)}</span>
              </div>
            </div>
          </div>

          {/* Customer strip */}
          {(order.customer_name || order.customerId) && (
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-6 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-brand-600">
                  {(order.customer_name ?? "?")[0]!.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">{order.customer_name ?? "Guest"}</p>
                  {order.customerId && <p className="text-[11px] text-slate-400">Customer ID: {order.customerId}</p>}
                </div>
              </div>
              {order.customerId && (
                <button type="button" onClick={() => router.push(`/customers/${order.customerId}`)}
                  className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                  View customer
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-6 py-3">
            <button type="button" onClick={doEmailReceipt}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
              Email Receipt
            </button>
            <button type="button" onClick={() => router.push(`/returns?order=${order.id}`)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
              </svg>
              Create Return
            </button>
            <Can permission="payments.refund">
              {canRefund && (
                <button type="button" onClick={() => setShowRefund(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
                  </svg>
                  Refund
                </button>
              )}
            </Can>
            <Can permission="payments.void">
              {canVoid && (
                <button type="button" onClick={() => setShowVoid(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
                  </svg>
                  Void
                </button>
              )}
            </Can>
          </div>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        <div className="-mx-1 mb-4 overflow-x-auto">
          <div className="flex min-w-max gap-0 border-b border-slate-200 px-1">
            {TABS.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setActiveTab(key)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === key
                    ? "border-b-2 border-brand-600 text-brand-600"
                    : "border-b-2 border-transparent text-slate-500 hover:text-slate-800"
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Order Lines ───────────────────────────────────────────────────── */}
        {activeTab === "lines" && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr className="text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500">Product</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 text-right">Qty</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 text-right">Unit Price</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 text-right">Tax</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.lines.map((line) => (
                  <tr key={line.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <button type="button" onClick={() => router.push(`/catalog/${line.productId}`)}
                        className="text-sm font-medium text-brand-600 hover:underline text-left">
                        {line.name}
                      </button>
                      <div className="flex gap-2 mt-0.5">
                        <span className="text-[11px] text-slate-400">{line.productId}</span>
                        {!line.taxable && <span className="text-[10px] text-slate-400 bg-slate-100 px-1 rounded">Tax exempt</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold text-slate-900">{line.quantity}</td>
                    <td className="px-5 py-3.5 text-right text-slate-700">{formatMoney(line.unitCents)}</td>
                    <td className="px-5 py-3.5 text-right text-slate-500">{line.taxable ? formatMoney(line.taxCents) : "—"}</td>
                    <td className="px-5 py-3.5 text-right font-bold text-slate-900">{formatMoney(line.lineCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={3} className="px-5 py-3 text-xs text-slate-400">{order.lines.length} line{order.lines.length !== 1 ? "s" : ""}</td>
                  <td className="px-5 py-3 text-right text-xs text-slate-500">Tax: {formatMoney(order.taxCents)}</td>
                  <td className="px-5 py-3 text-right text-sm font-bold text-slate-900">{formatMoney(order.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
            {order.discountCents > 0 && (
              <div className="border-t border-slate-100 bg-emerald-50 px-5 py-2.5 text-xs text-emerald-700">
                Discount applied: −{formatMoney(order.discountCents)}
              </div>
            )}
          </div>
        )}

        {/* ── Payments ──────────────────────────────────────────────────────── */}
        {activeTab === "payments" && (
          <div className="space-y-3">
            {(!order.payments || order.payments.length === 0) ? (
              <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
                {order.status === "open" ? "No payment collected yet." : "No payment records."}
              </div>
            ) : (
              order.payments.map((p) => (
                <div key={p.id} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{METHOD_LABELS[p.method] ?? p.method}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          p.status === "captured" ? "bg-emerald-100 text-emerald-700"
                          : p.status === "refunded" ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-600"
                        }`}>{p.status}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-400">
                        {p.cardLast4 && <span>Card ending {p.cardLast4}</span>}
                        {p.authCode && <span>Auth: {p.authCode}</span>}
                        <span>{fmtDateTime(p.createdAt)}</span>
                      </div>
                    </div>
                    <p className="text-base font-black text-slate-900">{formatMoney(p.amountCents)}</p>
                  </div>
                </div>
              ))
            )}

            {/* Payment summary */}
            {order.payments && order.payments.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Total collected</span>
                  <span className="font-bold text-slate-900">
                    {formatMoney(order.payments.reduce((s, p) => s + p.amountCents, 0))}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Order total</span>
                  <span className="text-slate-600">{formatMoney(order.totalCents)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Returns ───────────────────────────────────────────────────────── */}
        {activeTab === "returns" && (
          <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center">
            <svg className="mx-auto h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
            </svg>
            <p className="mt-2 text-sm text-slate-400">No returns for this order.</p>
            <button type="button" onClick={() => router.push(`/returns?order=${order.id}`)}
              className="mt-2 text-sm text-brand-600 hover:underline">
              Create return
            </button>
          </div>
        )}

        {/* ── Activity ──────────────────────────────────────────────────────── */}
        {activeTab === "activity" && (
          <div className="relative pl-4">
            <div className="absolute left-7 top-0 h-full w-px bg-slate-200" />
            <ul className="space-y-4">
              {[...timeline].reverse().map((ev, i) => {
                const colorClass = TIMELINE_COLORS[ev.type] ?? "bg-slate-100 text-slate-500";
                const iconPath = TIMELINE_ICONS[ev.type] ?? TIMELINE_ICONS.created;
                return (
                  <li key={ev.id} className="relative flex items-start gap-4">
                    <div className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${colorClass}`}>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={iconPath}/>
                      </svg>
                    </div>
                    <div className="pb-1 pt-0.5">
                      <p className="text-sm font-medium text-slate-900">{ev.label}</p>
                      <p className="text-xs text-slate-400">{ev.actor} · {fmtDateTime(ev.ts)}</p>
                    </div>
                  </li>
                );
              })}
              {timeline.length === 0 && (
                <li className="text-sm text-slate-400">No activity recorded.</li>
              )}
            </ul>
          </div>
        )}

      </div>

      {/* ── Modals ────────────────────────────────────────────────────────────── */}
      <ConfirmModal
        open={showVoid}
        title="Void order"
        description={`Void ${order.orderNumber} for ${formatMoney(order.totalCents)}? This action cannot be undone.`}
        confirmLabel="Void order"
        confirmClass="bg-red-600 hover:bg-red-700"
        onConfirm={doVoid}
        onClose={() => setShowVoid(false)}
        loading={actionLoading}
      />
      <ConfirmModal
        open={showRefund}
        title="Issue refund"
        description={`Refund ${formatMoney(order.totalCents)} for ${order.orderNumber}? The payment will be reversed.`}
        confirmLabel="Issue refund"
        confirmClass="bg-amber-600 hover:bg-amber-700"
        onConfirm={doRefund}
        onClose={() => setShowRefund(false)}
        loading={actionLoading}
      />
    </EnterpriseShell>
  );
}
