"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Button } from "@/components/Button";
import { apiGet, apiPost, apiPatch } from "@/api-client/client";
import { fmtDate } from "@/lib/date";
import type { SerialNumber, SerialStatus, SerialsResponse } from "@/api-client/types";
import { clsx } from "clsx";

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<SerialStatus, string> = {
  in_stock: "In Stock",
  sold: "Sold",
  returned: "Returned",
  service: "In Service",
};

const STATUS_COLORS: Record<SerialStatus, string> = {
  in_stock: "bg-emerald-100 text-emerald-800",
  sold: "bg-slate-100 text-slate-600",
  returned: "bg-amber-100 text-amber-800",
  service: "bg-blue-100 text-blue-800",
};

const ALL_STATUSES: SerialStatus[] = ["in_stock", "sold", "returned", "service"];

function StatusBadge({ status }: { status: SerialStatus }) {
  return (
    <span className={clsx("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", STATUS_COLORS[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}


// ─── Receive Modal ────────────────────────────────────────────────────────────

interface ReceiveModalProps {
  onClose: () => void;
  onSaved: (sn: SerialNumber) => void;
}

function ReceiveModal({ onClose, onSaved }: ReceiveModalProps) {
  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [productSku, setProductSku] = useState("");
  const [serial, setSerial] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId.trim() || !serial.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const sn = await apiPost<SerialNumber>("/api/v1/inventory/serials", {
        product_id: productId.trim(),
        product_name: productName.trim() || null,
        product_sku: productSku.trim() || null,
        serial: serial.trim(),
        notes: notes.trim() || null,
      });
      onSaved(sn);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("duplicate") ? "Serial number already exists." : "Failed to save. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">Receive Serial Number</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Product ID <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              placeholder="e.g. prod_001"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Product Name</label>
              <input
                type="text"
                value={productName}
                onChange={e => setProductName(e.target.value)}
                placeholder="Optional"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SKU</label>
              <input
                type="text"
                value={productSku}
                onChange={e => setProductSku(e.target.value)}
                placeholder="Optional"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Serial Number <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={serial}
              onChange={e => setSerial(e.target.value)}
              placeholder="e.g. DMPXQ123ABC1"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional condition notes…"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose} type="button" disabled={saving}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving || !productId.trim() || !serial.trim()}>
              {saving ? "Saving…" : "Receive"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

interface DetailModalProps {
  sn: SerialNumber;
  onClose: () => void;
  onUpdated: (sn: SerialNumber) => void;
}

const NEXT_STATUSES: Partial<Record<SerialStatus, SerialStatus[]>> = {
  in_stock: ["sold", "service"],
  returned: ["in_stock", "service"],
  service: ["in_stock", "returned"],
};

function DetailModal({ sn, onClose, onUpdated }: DetailModalProps) {
  const [saving, setSaving] = useState(false);
  const [serviceOrderId, setServiceOrderId] = useState(sn.service_order_id ?? "");

  async function changeStatus(toStatus: SerialStatus) {
    setSaving(true);
    try {
      const updated = await apiPatch<SerialNumber>(`/api/v1/inventory/serials/${sn.id}`, {
        status: toStatus,
        service_order_id: toStatus === "service" ? (serviceOrderId.trim() || null) : null,
      });
      onUpdated(updated);
    } finally {
      setSaving(false);
    }
  }

  const nextOpts = NEXT_STATUSES[sn.status] ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 font-mono">{sn.serial}</h2>
            <p className="text-sm text-slate-500">{sn.product_name ?? sn.product_id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Status</p>
              <StatusBadge status={sn.status} />
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">SKU</p>
              <p className="font-mono text-slate-800">{sn.product_sku ?? "—"}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Received</p>
              <p className="text-slate-800">{fmtDate(sn.received_at)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Sold At</p>
              <p className="text-slate-800">{fmtDate(sn.sold_at)}</p>
            </div>
            {sn.service_order_id && (
              <div className="col-span-2">
                <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Service Order</p>
                <p className="font-mono text-slate-800">{sn.service_order_id}</p>
              </div>
            )}
            {sn.notes && (
              <div className="col-span-2">
                <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Notes</p>
                <p className="text-slate-800">{sn.notes}</p>
              </div>
            )}
          </div>

          {nextOpts.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm font-medium text-slate-700 mb-3">Update Status</p>
              {nextOpts.includes("service") && (
                <div className="mb-3">
                  <label className="block text-xs text-slate-500 mb-1">Service Order ID (optional)</label>
                  <input
                    type="text"
                    value={serviceOrderId}
                    onChange={e => setServiceOrderId(e.target.value)}
                    placeholder="svo_…"
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                {nextOpts.map(s => (
                  <Button
                    key={s}
                    variant={s === "sold" ? "primary" : "secondary"}
                    onClick={() => changeStatus(s)}
                    disabled={saving}
                    size="sm"
                  >
                    {saving ? "…" : `Mark ${STATUS_LABELS[s]}`}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 pb-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const STATUS_TABS: Array<{ label: string; value: SerialStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "In Stock", value: "in_stock" },
  { label: "Sold", value: "sold" },
  { label: "Returned", value: "returned" },
  { label: "In Service", value: "service" },
];

export default function SerialsPage() {
  const [serials, setSerials] = useState<SerialNumber[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<SerialStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [showReceive, setShowReceive] = useState(false);
  const [selected, setSelected] = useState<SerialNumber | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100", offset: "0" });
      if (tab !== "all") params.set("status", tab);
      if (search) params.set("q", search);
      const data = await apiGet<SerialsResponse>(`/api/v1/inventory/serials?${params}`);
      setSerials(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => { load(); }, [load]);

  const counts = serials.reduce(
    (acc, s) => { acc[s.status] = (acc[s.status] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearch(query);
  }

  function handleReceived(sn: SerialNumber) {
    setSerials(prev => [sn, ...prev]);
    setTotal(t => t + 1);
    setShowReceive(false);
  }

  function handleUpdated(updated: SerialNumber) {
    setSerials(prev => prev.map(s => s.id === updated.id ? updated : s));
    setSelected(null);
  }

  const statCards = [
    { label: "Total Units", value: total, color: "border-slate-200" },
    { label: "In Stock", value: counts["in_stock"] ?? 0, color: "border-emerald-400" },
    { label: "Sold", value: counts["sold"] ?? 0, color: "border-slate-400" },
    { label: "In Service", value: counts["service"] ?? 0, color: "border-blue-400" },
  ];

  return (
    <EnterpriseShell
      active="inventory-serials"
      title="Serialized Inventory"
      subtitle="Track individual units by serial number"
    >
      <div className="p-6 space-y-6">

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {statCards.map(c => (
            <div key={c.label} className={clsx("bg-white rounded-xl border-l-4 p-4 shadow-sm", c.color)}>
              <p className="text-xs text-slate-500 uppercase tracking-wide">{c.label}</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{c.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search serial, product name, or SKU…"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button variant="secondary" type="submit" size="sm">Search</Button>
            {search && (
              <Button variant="secondary" type="button" size="sm" onClick={() => { setQuery(""); setSearch(""); }}>
                Clear
              </Button>
            )}
          </form>
          <Button variant="primary" onClick={() => setShowReceive(true)}>+ Receive Serial</Button>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
          {STATUS_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={clsx(
                "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                tab === t.value
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading…</div>
          ) : serials.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-400">
              <p className="text-sm">No serial numbers found.</p>
              <button onClick={() => setShowReceive(true)} className="mt-2 text-sm text-blue-600 hover:underline">
                Receive the first one
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Serial</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Product</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">SKU</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Received</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Sold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {serials.map(sn => (
                  <tr
                    key={sn.id}
                    onClick={() => setSelected(sn)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-slate-800 text-xs">{sn.serial}</td>
                    <td className="px-4 py-3 text-slate-700 max-w-[200px] truncate">
                      {sn.product_name ?? sn.product_id}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500 text-xs">{sn.product_sku ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={sn.status} /></td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(sn.received_at)}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(sn.sold_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showReceive && <ReceiveModal onClose={() => setShowReceive(false)} onSaved={handleReceived} />}
      {selected && <DetailModal sn={selected} onClose={() => setSelected(null)} onUpdated={handleUpdated} />}
    </EnterpriseShell>
  );
}
