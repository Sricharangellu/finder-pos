"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/api-client/client";
import { useToast } from "@/components/Toast";
import { getUser } from "@/lib/auth";
import { NewQuoteModal } from "./_components/NewQuoteModal";
import { QuoteTableRow } from "./_components/QuoteTableRow";
import type { Quote, QuoteStatus } from "./_components/quotesTypes";

export default function QuotesPage() {
  const user = getUser();
  const canManage = user?.role === "owner" || user?.role === "manager";
  const { addToast } = useToast();

  const [quotes, setQuotes]   = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actioning, setActioning]   = useState<string | null>(null);
  const [showModal, setShowModal]   = useState(false);

  const [filterStatus, setFilterStatus]     = useState<string>("all");
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterQuoteNo, setFilterQuoteNo]   = useState("");
  const [moreFilters, setMoreFilters]       = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: Quote[] }>("/api/v1/quotes")
      .then((r) => setQuotes(r.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function clearFilters() { setFilterStatus("all"); setFilterCustomer(""); setFilterQuoteNo(""); }

  const visible = quotes.filter((q) => {
    if (filterStatus !== "all" && q.status !== filterStatus) return false;
    if (filterCustomer && !(q.customer_id ?? q.customer_name ?? "").toLowerCase().includes(filterCustomer.toLowerCase())) return false;
    if (filterQuoteNo && !q.quote_number.toLowerCase().includes(filterQuoteNo.toLowerCase())) return false;
    return true;
  });

  async function handleSend(id: string) {
    setActioning(id);
    try {
      await apiPatch(`/api/v1/quotes/${id}/status`, { status: "sent" });
      setQuotes((prev) => prev.map((q) => q.id === id ? { ...q, status: "sent" as QuoteStatus } : q));
      addToast({ title: "Quote sent", variant: "success" });
    } catch { addToast({ title: "Failed to send", variant: "error" }); }
    finally { setActioning(null); }
  }

  async function handleConvert(id: string, quoteNumber: string) {
    setActioning(id);
    try {
      await apiPost(`/api/v1/quotes/${id}/convert`, {});
      addToast({ title: `${quoteNumber} converted to sale`, variant: "success" });
      load();
    } catch { addToast({ title: "Failed to convert", variant: "error" }); }
    finally { setActioning(null); }
  }

  async function handleDelete(id: string, quoteNumber: string) {
    if (!confirm(`Delete ${quoteNumber}? This cannot be undone.`)) return;
    setActioning(id);
    try {
      await apiDelete(`/api/v1/quotes/${id}`);
      setQuotes((prev) => prev.filter((q) => q.id !== id));
      addToast({ title: `${quoteNumber} deleted`, variant: "success" });
    } catch { addToast({ title: "Failed to delete", variant: "error" }); }
    finally { setActioning(null); }
  }

  return (
    <EnterpriseShell active="quotes" title="Quotes" subtitle="Create and manage sales quotations">

      {/* Page header */}
      <div className="bg-white border-b border-[#E8E8E8] px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[#111]">Quotes</h1>
        {canManage && (
          <button type="button" onClick={() => setShowModal(true)}
            className="rounded bg-[#5D5FEF] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4849d0] transition-colors">
            + New quote
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="bg-white border-b border-[#E8E8E8] px-6 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#555]">Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none">
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#555]">Customer</label>
            <input type="text" value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)} placeholder="Customer…"
              className="h-8 w-36 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#555]">Quote #</label>
            <input type="text" value={filterQuoteNo} onChange={(e) => setFilterQuoteNo(e.target.value)} placeholder="QT-00001"
              className="h-8 w-28 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none" />
          </div>
          {moreFilters && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#555]">Valid after</label>
              <input type="date"
                className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none" />
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button type="button" onClick={clearFilters} className="text-sm text-[#5D5FEF] hover:underline">Clear filters</button>
            <button type="button" onClick={() => setMoreFilters((m) => !m)} className="text-sm text-[#5D5FEF] hover:underline">
              {moreFilters ? "Fewer filters" : "More filters"}
            </button>
            <button type="button" onClick={load}
              className="h-8 rounded bg-[#5D5FEF] px-4 text-sm font-medium text-white hover:bg-[#4849d0] transition-colors">
              Search
            </button>
          </div>
        </div>
        {!loading && (
          <p className="mt-2 text-xs text-[#666]">
            Showing <strong>{visible.length}</strong> quote{visible.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA] text-left text-xs font-semibold text-[#888] uppercase tracking-wider">
              <th className="w-6 px-4 py-3" />
              <th className="px-4 py-3">Quote # / Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Served by</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-[#888]">
                <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#5D5FEF] border-t-transparent" />
              </td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-[#888]">
                No quotes found.
                {(filterStatus !== "all" || filterCustomer || filterQuoteNo) && (
                  <button type="button" onClick={clearFilters} className="ml-2 text-[#5D5FEF] hover:underline">Clear filters</button>
                )}
              </td></tr>
            )}
            {visible.map((quote) => (
              <QuoteTableRow
                key={quote.id}
                quote={quote}
                isExpanded={expandedId === quote.id}
                canManage={canManage}
                actioning={actioning}
                onToggleExpand={() => setExpandedId(expandedId === quote.id ? null : quote.id)}
                onSend={(id) => void handleSend(id)}
                onConvert={(id, num) => void handleConvert(id, num)}
                onDelete={(id, num) => void handleDelete(id, num)}
                onClosePanel={() => setExpandedId(null)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {showModal && <NewQuoteModal onClose={() => setShowModal(false)} onCreated={load} />}
    </EnterpriseShell>
  );
}
