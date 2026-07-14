"use client";

/**
 * /inventory — Stock movement management.
 *
 * Spec:
 *   Tabs: Orders | Transfers | Returns
 *   Filter: Show dropdown | Search | Outlet | More filters
 *   Summary: "Displaying X total qty and $Y total cost"
 *   Table: Order # + due date | From | To | Status | Created (sortable) | Total qty | Total cost
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateShort } from "@/lib/date";
import { useToast } from "@/components/Toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type TabKey = "orders" | "transfers" | "returns";

interface StockMovement {
  id: string;
  number: string;
  due_date?: number | null;
  from_location: string;
  to_location: string;
  status: string;
  created_at: number;
  total_qty: number;
  total_cost_cents: number;
  note?: string | null;
}

// Raw shapes returned from each endpoint — normalised into StockMovement
interface RawOrder {
  id: string; po_number: number; supplier_id: string; status: string;
  total_cost_cents: number; created_at: number; received_at: number | null;
}
interface RawTransfer {
  id: string; transfer_number: string; from_location: string; to_location: string;
  status: string; qty: number; created_at: number; due_date: number | null; note?: string | null;
}
interface RawReturn {
  id: string; number: string; from_location: string; to_location: string;
  status: string; total_qty: number; total_cost_cents: number; created_at: number;
  due_date?: number | null; note?: string | null;
}

// ── Status styles ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  pending:    "bg-amber-50 text-amber-700",
  ordered:    "bg-blue-50 text-blue-700",
  in_transit: "bg-blue-50 text-blue-700",
  received:   "bg-emerald-50 text-emerald-700",
  completed:  "bg-emerald-50 text-emerald-700",
  credited:   "bg-emerald-50 text-emerald-700",
  partial:    "bg-purple-50 text-purple-700",
  sent:       "bg-indigo-50 text-indigo-700",
  draft:      "bg-gray-100 text-gray-500",
  cancelled:  "bg-gray-100 text-gray-400",
};

const SUPPLIER_NAME: Record<string, string> = {
  "sup_acme": "Acme Coffee Co",
  "sup_tea":  "Tea Traders",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Normalise raw API shapes → StockMovement ──────────────────────────────────

function normOrders(items: RawOrder[]): StockMovement[] {
  return items.map(o => ({
    id:               o.id,
    number:           `PO-${o.po_number}`,
    due_date:         o.received_at,
    from_location:    SUPPLIER_NAME[o.supplier_id] ?? o.supplier_id,
    to_location:      "Main Store",
    status:           o.status,
    created_at:       o.created_at,
    total_qty:        0,
    total_cost_cents: o.total_cost_cents,
  }));
}

function normTransfers(items: RawTransfer[]): StockMovement[] {
  return items.map(t => ({
    id:               t.id,
    number:           t.transfer_number,
    due_date:         t.due_date,
    from_location:    t.from_location,
    to_location:      t.to_location,
    status:           t.status,
    created_at:       t.created_at,
    total_qty:        t.qty,
    total_cost_cents: 0,
    note:             t.note,
  }));
}

function normReturns(items: RawReturn[]): StockMovement[] {
  return items.map(r => ({
    id:               r.id,
    number:           r.number,
    due_date:         r.due_date ?? null,
    from_location:    r.from_location,
    to_location:      r.to_location,
    status:           r.status,
    created_at:       r.created_at,
    total_qty:        r.total_qty,
    total_cost_cents: r.total_cost_cents,
    note:             r.note,
  }));
}

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string }[] = [
  { key: "orders",    label: "Orders"    },
  { key: "transfers", label: "Transfers" },
  { key: "returns",   label: "Returns"   },
];

const TAB_ENDPOINT: Record<TabKey, string> = {
  orders:    "/api/v1/purchasing/orders",
  transfers: "/api/v1/inventory/transfers",
  returns:   "/api/v1/inventory/returns",
};

const TAB_PREFIX: Record<TabKey, string> = {
  orders:    "PO",
  transfers: "TRF",
  returns:   "RET",
};

// ── New movement modal ────────────────────────────────────────────────────────

function NewMovementModal({ tab, onClose, onCreated }: { tab: TabKey; onClose: () => void; onCreated: () => void }) {
  const { addToast } = useToast();
  const [from, setFrom]   = useState("");
  const [to, setTo]       = useState("");
  const [qty, setQty]     = useState("1");
  const [cost, setCost]   = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cfg = {
    orders:    { title: "New purchase order",  fromLabel: "Supplier",    toLabel: "Outlet"   },
    transfers: { title: "New transfer",        fromLabel: "From outlet", toLabel: "To outlet" },
    returns:   { title: "New return",          fromLabel: "From outlet", toLabel: "Supplier" },
  }[tab];

  const handleSubmit = async () => {
    if (!from.trim() || !to.trim()) { addToast({ title: "Fill in all required fields", variant: "error" }); return; }
    setSubmitting(true);
    try {
      await apiPost(TAB_ENDPOINT[tab], {
        from_location: from.trim(), to_location: to.trim(),
        total_qty: Math.max(1, parseInt(qty, 10) || 1),
        total_cost_cents: Math.round(parseFloat(cost.replace(/,/g, "")) * 100 || 0),
        notes: notes.trim() || undefined,
      });
      addToast({ title: "Created successfully", variant: "success" });
      onCreated(); onClose();
    } catch (e) {
      addToast({ title: "Failed to create", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#F0F0F0] px-5 py-4">
          <h2 className="text-base font-semibold text-[#111]">{cfg.title}</h2>
          <button type="button" onClick={onClose} className="text-[#888] hover:text-[#555]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#555] mb-1">{cfg.fromLabel}</label>
              <input type="text" value={from} onChange={e => setFrom(e.target.value)} placeholder="Name…"
                className="w-full h-8 rounded border border-[#D9D9D9] px-2 text-sm focus:border-brand-600 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#555] mb-1">{cfg.toLabel}</label>
              <input type="text" value={to} onChange={e => setTo(e.target.value)} placeholder="Name…"
                className="w-full h-8 rounded border border-[#D9D9D9] px-2 text-sm focus:border-brand-600 focus:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#555] mb-1">Total qty</label>
              <input type="number" value={qty} min="1" onChange={e => setQty(e.target.value)}
                className="w-full h-8 rounded border border-[#D9D9D9] px-2 text-sm focus:border-brand-600 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#555] mb-1">Total cost ($)</label>
              <input type="number" value={cost} min="0" step="0.01" onChange={e => setCost(e.target.value)}
                className="w-full h-8 rounded border border-[#D9D9D9] px-2 text-sm focus:border-brand-600 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#555] mb-1">Notes</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional…"
              className="w-full h-8 rounded border border-[#D9D9D9] px-2 text-sm focus:border-brand-600 focus:outline-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#F0F0F0] px-5 py-4">
          <button type="button" onClick={onClose}
            className="rounded border border-[#D9D9D9] px-3 py-1.5 text-sm text-[#555] hover:bg-[#F5F5F5]">Cancel</button>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting}
            className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4849d0] disabled:opacity-50">
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("orders");
  const [data, setData]           = useState<StockMovement[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("desc");

  // Filter state
  const [filterShow,   setFilterShow]   = useState("all");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterOutlet, setFilterOutlet] = useState("all");
  const [moreFilters,  setMoreFilters]  = useState(false);

  function clearFilters() { setFilterShow("all"); setFilterSearch(""); setFilterOutlet("all"); }

  const load = useCallback(() => {
    setLoading(true);
    const ep = TAB_ENDPOINT[activeTab];
    apiGet<{ items: unknown[] }>(ep).then(r => {
      const raw = r.items ?? [];
      let norm: StockMovement[] = [];
      if (activeTab === "orders")    norm = normOrders(raw as RawOrder[]);
      if (activeTab === "transfers") norm = normTransfers(raw as RawTransfer[]);
      if (activeTab === "returns")   norm = normReturns(raw as RawReturn[]);
      setData(norm);
    }).catch(() => setData([])).finally(() => setLoading(false));
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    let rows = data;
    if (filterShow !== "all") rows = rows.filter(r => r.status === filterShow);
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      rows = rows.filter(r =>
        r.number.toLowerCase().includes(q) ||
        r.from_location.toLowerCase().includes(q) ||
        r.to_location.toLowerCase().includes(q)
      );
    }
    if (filterOutlet !== "all") {
      rows = rows.filter(r =>
        r.to_location.toLowerCase().includes(filterOutlet.toLowerCase()) ||
        r.from_location.toLowerCase().includes(filterOutlet.toLowerCase())
      );
    }
    return [...rows].sort((a, b) =>
      sortDir === "desc" ? b.created_at - a.created_at : a.created_at - b.created_at
    );
  }, [data, filterShow, filterSearch, filterOutlet, sortDir]);

  const totalQty  = visible.reduce((s, r) => s + r.total_qty, 0);
  const totalCost = visible.reduce((s, r) => s + r.total_cost_cents, 0);

  const tabLabel  = activeTab === "orders" ? "orders" : activeTab === "transfers" ? "transfers" : "returns";

  return (
    <EnterpriseShell active="inventory" title="Inventory" subtitle="Stock movements — orders, transfers, and returns">

      {/* ── Spec tab bar ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#E8E8E8] px-6 flex items-end justify-between">
        <div className="flex">
          {TABS.map(t => (
            <button key={t.key} type="button"
              onClick={() => { setActiveTab(t.key); clearFilters(); }}
              className={`px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-[#666] hover:text-[#333]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowModal(true)}
          className="mb-2 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4849d0] transition-colors">
          + New {tabLabel.slice(0, -1)}
        </button>
      </div>

      {/* ── Spec filter bar ───────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#E8E8E8] px-6 py-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Show */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#555]">Show</label>
            <select value={filterShow} onChange={e => setFilterShow(e.target.value)}
              className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-brand-600 focus:outline-none">
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              {activeTab === "orders"    && <option value="ordered">Ordered</option>}
              {activeTab === "orders"    && <option value="received">Received</option>}
              {activeTab === "orders"    && <option value="draft">Draft</option>}
              {activeTab === "transfers" && <option value="in_transit">In transit</option>}
              {activeTab === "transfers" && <option value="completed">Completed</option>}
              {activeTab === "returns"   && <option value="sent">Sent</option>}
              {activeTab === "returns"   && <option value="credited">Credited</option>}
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          {/* Search */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#555]">Search</label>
            <input type="text" value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
              placeholder={`${TAB_PREFIX[activeTab]}-00001 or location…`}
              className="h-8 w-44 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-brand-600 focus:outline-none" />
          </div>
          {/* Outlet */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#555]">Outlet</label>
            <select value={filterOutlet} onChange={e => setFilterOutlet(e.target.value)}
              className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-brand-600 focus:outline-none">
              <option value="all">All outlets</option>
              <option value="Main Store">Main Store</option>
              <option value="Warehouse">Warehouse</option>
              <option value="Downtown">Downtown</option>
            </select>
          </div>
          {/* More filters — date range */}
          {moreFilters && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#555]">From date</label>
              <input type="date"
                className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-brand-600 focus:outline-none" />
            </div>
          )}
          {/* Actions */}
          <div className="flex items-center gap-2 ml-auto">
            <button type="button" onClick={clearFilters} className="text-sm text-brand-600 hover:underline">Clear filters</button>
            <button type="button" onClick={() => setMoreFilters(m => !m)} className="text-sm text-brand-600 hover:underline">
              {moreFilters ? "Fewer filters" : "More filters"}
            </button>
            <button type="button" onClick={load}
              className="h-8 rounded bg-brand-600 px-4 text-sm font-medium text-white hover:bg-[#4849d0] transition-colors">
              Search
            </button>
          </div>
        </div>
        {/* Spec summary line */}
        {!loading && (
          <p className="mt-2 text-xs text-[#666]">
            Displaying <strong>{visible.length}</strong> {tabLabel} —
            total qty <strong>{totalQty.toLocaleString()}</strong> and
            total cost <strong>{formatMoney(totalCost)}</strong>
          </p>
        )}
      </div>

      {/* ── Spec table ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA] text-left text-xs font-semibold text-[#888] uppercase tracking-wider">
              <th className="px-4 py-3">{TAB_PREFIX[activeTab]} # / Due date</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">To</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 cursor-pointer select-none hover:text-[#555]"
                onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}>
                Created {sortDir === "desc" ? "↓" : "↑"}
              </th>
              <th className="px-4 py-3 text-right">Total qty</th>
              <th className="px-4 py-3 text-right">Total cost</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-[#888]">
                <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
              </td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-[#888]">
                No {tabLabel} found.
                {(filterShow !== "all" || filterSearch || filterOutlet !== "all") && (
                  <button type="button" onClick={clearFilters} className="ml-2 text-brand-600 hover:underline">Clear filters</button>
                )}
              </td></tr>
            )}
            {visible.map(row => (
              <tr key={row.id} className="border-b border-[#F5F5F5] hover:bg-[#FAFAFA]">
                {/* # / Due date */}
                <td className="px-4 py-3">
                  <p className="font-semibold text-brand-600 font-mono text-xs">{row.number}</p>
                  {row.due_date
                    ? <p className="text-xs text-[#888]">Due {fmtDateShort(row.due_date)}</p>
                    : <p className="text-xs text-[#ccc]">No due date</p>
                  }
                </td>
                {/* From */}
                <td className="px-4 py-3 text-sm text-[#333]">{row.from_location}</td>
                {/* To */}
                <td className="px-4 py-3 text-sm text-[#333]">{row.to_location}</td>
                {/* Status */}
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLE[row.status] ?? "bg-gray-100 text-gray-500"}`}>
                    {row.status.replace(/_/g, " ")}
                  </span>
                </td>
                {/* Created — sortable */}
                <td className="px-4 py-3 text-xs text-[#666]">{fmtDate(row.created_at)}</td>
                {/* Total qty */}
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#111]">
                  {row.total_qty > 0 ? row.total_qty.toLocaleString() : "—"}
                </td>
                {/* Total cost */}
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#111]">
                  {row.total_cost_cents > 0 ? formatMoney(row.total_cost_cents) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && <NewMovementModal tab={activeTab} onClose={() => setShowModal(false)} onCreated={load} />}
    </EnterpriseShell>
  );
}
