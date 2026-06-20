"use client";

/**
 * /quotes — Quotations management page.
 *
 * Create, filter, view, send, convert, and delete sales quotes.
 */

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { getUser } from "@/lib/auth";
import { useToast } from "@/components/Toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

interface Quote {
  id: string;
  quote_number: string;
  status: QuoteStatus;
  customer_id: string | null;
  total_cents: number;
  currency: string;
  valid_until: number;
  created_at: number;
}

interface QuoteLine {
  id: string;
  product_id?: string;
  name: string;
  quantity: number;
  unit_cents: number;
  sku?: string;
}

interface QuoteDetail extends Quote {
  lines: QuoteLine[];
}

interface NewLine {
  name: string;
  qty: string;
  unitPrice: string;
  sku: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_FILTERS = ["all", "draft", "sent", "accepted", "rejected", "expired"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_BADGE: Record<QuoteStatus, "gray" | "blue" | "green" | "red" | "yellow"> = {
  draft: "gray",
  sent: "blue",
  accepted: "green",
  rejected: "red",
  expired: "yellow",
};

const CURRENCIES = ["USD", "EUR", "GBP", "CAD"];

const EMPTY_LINE: NewLine = { name: "", qty: "1", unitPrice: "", sku: "" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCents(value: string): number {
  const n = parseFloat(value.replace(/,/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

// ─── New Quote Modal ──────────────────────────────────────────────────────────

function NewQuoteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (q: Quote) => void;
}) {
  const { addToast } = useToast();
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [validUntil, setValidUntil] = useState("");
  const [lines, setLines] = useState<NewLine[]>([{ ...EMPTY_LINE }]);
  const [submitting, setSubmitting] = useState(false);

  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (i: number) =>
    setLines((prev) => prev.filter((_, idx) => idx !== i));

  const updateLine = (i: number, field: keyof NewLine, val: string) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: val } : l)));

  const handleSubmit = async () => {
    if (!lines.some((l) => l.name.trim())) {
      addToast({ title: "Add at least one line item", variant: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        customerId: customerName.trim() || undefined,
        notes: notes.trim() || undefined,
        currency,
        validUntil: validUntil ? new Date(validUntil).getTime() : undefined,
        lines: lines
          .filter((l) => l.name.trim())
          .map((l) => ({
            name: l.name.trim(),
            productId: undefined,
            quantity: Math.max(1, parseInt(l.qty, 10) || 1),
            unitCents: parseCents(l.unitPrice),
            sku: l.sku.trim() || undefined,
          })),
      };
      const quote = await apiPost<Quote>("/api/v1/quotes", payload);
      addToast({ title: `Quote ${quote.quote_number} created`, variant: "success" });
      onCreated(quote);
      onClose();
    } catch (e) {
      addToast({
        title: "Failed to create quote",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">New Quotation</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Valid Until</label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Line Items</p>
              <button
                type="button"
                onClick={addLine}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                Add line
              </button>
            </div>

            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-start">
                  <input
                    type="text"
                    value={line.name}
                    onChange={(e) => updateLine(i, "name", e.target.value)}
                    placeholder="Product name"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                  />
                  <input
                    type="number"
                    value={line.qty}
                    min="1"
                    onChange={(e) => updateLine(i, "qty", e.target.value)}
                    placeholder="Qty"
                    className="w-16 rounded-md border border-slate-300 px-2 py-2 text-sm text-center focus:border-brand-500 focus:outline-none"
                  />
                  <input
                    type="number"
                    value={line.unitPrice}
                    min="0"
                    step="0.01"
                    onChange={(e) => updateLine(i, "unitPrice", e.target.value)}
                    placeholder="Unit $"
                    className="w-24 rounded-md border border-slate-300 px-2 py-2 text-sm text-right focus:border-brand-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    disabled={lines.length === 1}
                    className="mt-0.5 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={submitting} onClick={() => void handleSubmit()}>
            Create Quote
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Expanded detail row ──────────────────────────────────────────────────────

function QuoteDetailRow({ quoteId, onClose }: { quoteId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<QuoteDetail>(`/api/v1/quotes/${quoteId}`)
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [quoteId]);

  return (
    <tr>
      <td colSpan={8} className="bg-slate-50 px-5 py-4 text-sm">
        <div className="flex items-start justify-between mb-3">
          <p className="font-semibold text-slate-800">Quote Details</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        {loading ? (
          <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-6 animate-pulse rounded bg-slate-200 w-3/4" />)}</div>
        ) : !detail ? (
          <p className="text-slate-400">Failed to load details.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 font-medium text-right">Qty</th>
                <th className="pb-2 font-medium text-right">Unit Price</th>
                <th className="pb-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-1.5 text-slate-700">
                    {line.name}
                    {line.sku && <span className="ml-1.5 text-slate-400">[{line.sku}]</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">{line.quantity}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">{formatMoney(line.unit_cents)}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium text-slate-800">
                    {formatMoney(line.unit_cents * line.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuotesPage() {
  const user = getUser();
  const canManage = user?.role === "owner" || user?.role === "manager";
  const { addToast } = useToast();

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: Quote[]; total: number }>("/api/v1/quotes")
      .then((r) => { setQuotes(r.items ?? []); setTotal(r.total ?? 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const visibleQuotes = filter === "all" ? quotes : quotes.filter((q) => q.status === filter);

  const handleStatusChange = async (id: string, status: QuoteStatus) => {
    setActioning(id);
    try {
      await apiPatch(`/api/v1/quotes/${id}/status`, { status });
      setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, status } : q)));
      addToast({ title: `Quote marked as ${status}`, variant: "success" });
    } catch (e) {
      addToast({
        title: "Failed to update status",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setActioning(null);
    }
  };

  const handleConvert = async (id: string, quoteNumber: string) => {
    setActioning(id);
    try {
      await apiPost(`/api/v1/quotes/${id}/convert`, {});
      addToast({ title: `${quoteNumber} converted to order`, variant: "success" });
      load();
    } catch (e) {
      addToast({
        title: "Failed to convert quote",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setActioning(null);
    }
  };

  const handleDelete = async (id: string, quoteNumber: string) => {
    if (!confirm(`Delete ${quoteNumber}? This cannot be undone.`)) return;
    setActioning(id);
    try {
      await apiDelete(`/api/v1/quotes/${id}`);
      setQuotes((prev) => prev.filter((q) => q.id !== id));
      addToast({ title: `${quoteNumber} deleted`, variant: "success" });
    } catch (e) {
      addToast({
        title: "Failed to delete quote",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setActioning(null);
    }
  };

  return (
    <EnterpriseShell active="quotes" title="Quotations" subtitle="Create and manage sales quotes">
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-950">Quotations</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {total > 0 ? `${total} quote${total !== 1 ? "s" : ""} total` : "No quotes yet"}
            </p>
          </div>
          {canManage && (
            <Button variant="primary" onClick={() => setShowModal(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5"><path d="M12 5v14M5 12h14" /></svg>
              New Quote
            </Button>
          )}
        </div>

        {/* ── Filter bar ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors ${
                filter === s
                  ? "bg-slate-950 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* ── Table ──────────────────────────────────────────────────────── */}
        <Card noPadding>
          {loading ? (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />)}
            </div>
          ) : visibleQuotes.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-400">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <path d="M12 18v-6" /><path d="M9 15h6" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700">No quotes found</p>
              <p className="mt-1 text-xs text-slate-400">
                {filter === "all"
                  ? "Create your first quote to get started."
                  : `No ${filter} quotes at the moment.`}
              </p>
              {canManage && filter === "all" && (
                <Button variant="primary" size="sm" className="mt-4" onClick={() => setShowModal(true)}>
                  Create Quote
                </Button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  <th className="px-4 py-3">Quote #</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Customer</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 hidden md:table-cell">Currency</th>
                  <th className="px-4 py-3 hidden lg:table-cell">Valid Until</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleQuotes.flatMap((quote) => {
                  const rows = [
                    <tr key={quote.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900 text-xs tracking-wide">
                        {quote.quote_number}
                      </td>
                      <td className="px-4 py-3 text-slate-700 hidden sm:table-cell">
                        {quote.customer_id || <span className="text-slate-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                        {formatMoney(quote.total_cents)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                        {quote.currency}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs hidden lg:table-cell">
                        {fmtDate(quote.valid_until)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_BADGE[quote.status] ?? "gray"}>
                          {quote.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedId((prev) => (prev === quote.id ? null : quote.id))}
                            className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                          >
                            {expandedId === quote.id ? "Close" : "View"}
                          </button>

                          {canManage && (
                            <>
                              {quote.status === "draft" && (
                                <button
                                  type="button"
                                  disabled={actioning === quote.id}
                                  onClick={() => void handleStatusChange(quote.id, "sent")}
                                  className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                                >
                                  Send
                                </button>
                              )}

                              {(quote.status === "sent" || quote.status === "accepted") && (
                                <button
                                  type="button"
                                  disabled={actioning === quote.id}
                                  onClick={() => void handleConvert(quote.id, quote.quote_number)}
                                  className="text-xs text-emerald-600 hover:text-emerald-800 font-medium disabled:opacity-50"
                                >
                                  Convert
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={actioning === quote.id}
                                onClick={() => void handleDelete(quote.id, quote.quote_number)}
                                className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>,
                  ];

                  if (expandedId === quote.id) {
                    rows.push(
                      <QuoteDetailRow
                        key={`detail-${quote.id}`}
                        quoteId={quote.id}
                        onClose={() => setExpandedId(null)}
                      />
                    );
                  }

                  return rows;
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {showModal && (
        <NewQuoteModal
          onClose={() => setShowModal(false)}
          onCreated={() => load()}
        />
      )}
    </EnterpriseShell>
  );
}
