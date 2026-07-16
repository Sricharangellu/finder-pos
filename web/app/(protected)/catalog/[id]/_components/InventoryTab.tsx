"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { CatalogProduct } from "@/api-client/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocationStock {
  location_id: string;
  location_code: string;
  location_name: string;
  quantity_on_hand: number;
  quantity_committed: number;
  quantity_available: number;
  average_cost_cents: number | null;
}

interface StockResponse {
  product_id: string;
  locations: LocationStock[];
}

interface Movement {
  id: string;
  type: string;
  delta: number;
  location: string;
  actor: string;
  note: string | null;
  created_at: number;
}

// ── Shared primitives ─────────────────────────────────────────────────────────

const FLD = "w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600";

function Lbl({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-slate-500">{children}</label>;
}

function Card({
  title, sub, action, children,
}: {
  title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between border-b border-slate-100 px-5 py-3.5">
        <div>
          <h3 className="text-sm font-semibold text-[#111]">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Movement type badge ───────────────────────────────────────────────────────

const MOVEMENT_STYLE: Record<string, string> = {
  sale:       "bg-blue-50 text-blue-700",
  receive:    "bg-emerald-50 text-emerald-700",
  return:     "bg-purple-50 text-purple-700",
  adjustment: "bg-amber-50 text-amber-700",
  transfer:   "bg-slate-100 text-slate-600",
  damage:     "bg-red-50 text-red-700",
};

function MovementBadge({ type }: { type: string }) {
  const cls = MOVEMENT_STYLE[type] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${cls}`}>
      {type}
    </span>
  );
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Stock by Location ─────────────────────────────────────────────────────────

function StockByLocation({ productId, refreshKey }: { productId: string; refreshKey: number }) {
  const [locations, setLocations] = useState<LocationStock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiGet<StockResponse>(`/api/v1/catalog/${productId}/stock`)
      .then((r) => setLocations(r.locations ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [productId, refreshKey]);

  const totals = locations.reduce(
    (acc, l) => ({ on_hand: acc.on_hand + l.quantity_on_hand, committed: acc.committed + l.quantity_committed, available: acc.available + l.quantity_available }),
    { on_hand: 0, committed: 0, available: 0 },
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <div>
          <h3 className="text-sm font-semibold text-[#111]">Stock by Location</h3>
          <p className="mt-0.5 text-xs text-slate-400">On-hand, committed (reserved), and available-to-sell per location</p>
        </div>
        {!loading && (
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[11px] text-slate-400">Total on hand</p>
              <p className="text-lg font-bold text-slate-900">{totals.on_hand}</p>
            </div>
            <div className={`rounded-full px-3 py-1 text-xs font-semibold ${totals.available > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {totals.available} available
            </div>
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        {loading ? (
          <div className="space-y-2 p-5">{[1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}</div>
        ) : locations.length === 0 ? (
          <p className="p-5 text-sm text-slate-400">No location data.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2.5">Location</th>
                <th className="px-4 py-2.5 text-right">On Hand</th>
                <th className="px-4 py-2.5 text-right">Committed</th>
                <th className="px-4 py-2.5 text-right">Available</th>
                <th className="px-4 py-2.5 text-right hidden sm:table-cell">Avg Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {locations.map((l) => (
                <tr key={l.location_id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3">
                    <p className="font-medium text-[#111]">{l.location_name}</p>
                    <p className="text-[11px] font-mono text-slate-400">{l.location_code}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[#111] tabular-nums">{l.quantity_on_hand}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={l.quantity_committed > 0 ? "font-medium text-amber-600" : "text-slate-400"}>{l.quantity_committed}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={l.quantity_available > 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-500"}>{l.quantity_available}</span>
                  </td>
                  <td className="hidden px-4 py-3 text-right text-slate-500 tabular-nums sm:table-cell">
                    {l.average_cost_cents != null ? formatMoney(l.average_cost_cents) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-[#111]">
                <td className="px-5 py-3 text-xs uppercase tracking-wide text-slate-500">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{totals.on_hand}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <span className={totals.committed > 0 ? "text-amber-600" : "text-slate-400"}>{totals.committed}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <span className={totals.available > 0 ? "text-emerald-600" : "text-red-500"}>{totals.available}</span>
                </td>
                <td className="hidden px-4 py-3 sm:table-cell" />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Quick Adjust ──────────────────────────────────────────────────────────────

const ADJUST_REASONS = [
  "Cycle Count / Correction",
  "Received Stock",
  "Customer Return",
  "Damage / Write-off",
  "Theft / Shrinkage",
  "Expiry Removal",
  "Inter-location Transfer",
  "Promotional Use",
  "Other",
];

function QuickAdjust({
  productId,
  locations,
  onAdjusted,
}: {
  productId: string;
  locations: { id: string; name: string }[];
  onAdjusted: () => void;
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "loc_1");
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(ADJUST_REASONS[0]!);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(qty);
    if (!qty || isNaN(n) || n < 0) { setError("Enter a valid quantity."); return; }
    setSaving(true); setError(null);
    try {
      await apiPost(`/api/v1/inventory/adjustments`, {
        product_id: productId,
        location_id: locationId,
        delta: Math.round(n),
        mode,
        reason,
        note: note.trim() || null,
      });
      setQty(""); setNote("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      onAdjusted();
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Adjustment failed.");
    } finally { setSaving(false); }
  };

  return (
    <Card title="Quick Stock Adjust" sub="Manually add, remove, or set stock quantity">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Location */}
          <div>
            <Lbl>Location</Lbl>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={FLD}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          {/* Reason */}
          <div>
            <Lbl>Reason</Lbl>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={FLD}>
              {ADJUST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {/* Mode + Qty */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Lbl>Adjustment type</Lbl>
            <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {(["add", "remove", "set"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md py-2 text-xs font-semibold capitalize transition-colors ${
                    mode === m ? "bg-brand-600 text-white shadow-sm" : "text-slate-500 hover:text-[#111]"
                  }`}
                >
                  {m === "add" ? "+ Add" : m === "remove" ? "− Remove" : "= Set to"}
                </button>
              ))}
            </div>
          </div>
          <div className="w-32">
            <Lbl>Quantity</Lbl>
            <input
              type="number"
              min="0"
              step="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              className={FLD + " text-center text-lg font-bold"}
            />
          </div>
        </div>

        {/* Note */}
        <div>
          <Lbl>Note (optional)</Lbl>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Stocktake Jan 2025"
            className={FLD}
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-sm font-medium text-emerald-600">✓ Adjustment recorded</span>}
          <button
            type="submit"
            disabled={saving || !qty}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40 transition-colors"
          >
            {saving ? "Adjusting…" : "Apply Adjustment"}
          </button>
        </div>
      </form>
    </Card>
  );
}

// ── Movement History ──────────────────────────────────────────────────────────

function MovementHistory({ productId, refreshKey }: { productId: string; refreshKey: number }) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiGet<{ items: Movement[] }>(`/api/v1/inventory/movements?product_id=${productId}&limit=25`)
      .then((r) => setMovements(r.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [productId, refreshKey]);

  return (
    <Card title="Movement History" sub="All stock changes for this product — newest first">
      {loading ? (
        <div className="space-y-2">{[1,2,3,4,5].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}</div>
      ) : movements.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">No movements recorded yet. Adjustments will appear here.</p>
      ) : (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2.5">Type</th>
                <th className="px-4 py-2.5">Location</th>
                <th className="px-4 py-2.5 text-center">Change</th>
                <th className="px-4 py-2.5">Reference / Note</th>
                <th className="px-4 py-2.5">By</th>
                <th className="px-4 py-2.5 text-right">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {movements.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3"><MovementBadge type={m.type} /></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{m.location}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-bold tabular-nums ${m.delta > 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {m.delta > 0 ? `+${m.delta}` : m.delta}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">
                    <p className="truncate text-xs text-slate-500">{m.note ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-slate-500">{m.actor}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400 whitespace-nowrap">
                    {timeAgo(m.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Physical Attributes ───────────────────────────────────────────────────────

function PhysicalAttributes({ product, onSaved }: { product: CatalogProduct; onSaved: (p: CatalogProduct) => void }) {
  const [weight, setWeight] = useState(product.weight_grams != null ? (product.weight_grams / 453.592).toFixed(2) : "");
  const [length, setLength] = useState(product.length_mm  != null ? (product.length_mm  / 25.4).toFixed(2) : "");
  const [width,  setWidth]  = useState(product.width_mm   != null ? (product.width_mm   / 25.4).toFixed(2) : "");
  const [height, setHeight] = useState(product.height_mm  != null ? (product.height_mm  / 25.4).toFixed(2) : "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      const patch: Partial<CatalogProduct> = {
        weight_grams: weight ? Math.round(parseFloat(weight) * 453.592) : undefined,
        length_mm:    length ? Math.round(parseFloat(length) * 25.4)    : undefined,
        width_mm:     width  ? Math.round(parseFloat(width)  * 25.4)    : undefined,
        height_mm:    height ? Math.round(parseFloat(height) * 25.4)    : undefined,
      };
      const updated = await apiPatch<CatalogProduct>(`/api/v1/catalog/${product.id}`, patch);
      onSaved(updated);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Save failed.");
    } finally { setSaving(false); }
  };

  return (
    <Card title="Physical Attributes" sub="Weight and dimensions used for shipping calculations">
      {error && <p className="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ["Weight (lb)", weight, setWeight],
          ["Length (in)", length, setLength],
          ["Width (in)",  width,  setWidth],
          ["Height (in)", height, setHeight],
        ] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
          <div key={label}>
            <Lbl>{label}</Lbl>
            <input
              type="number" step="0.01" min="0"
              className={FLD}
              value={val}
              onChange={(e) => setter(e.target.value)}
              placeholder="0.00"
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {saved && <span className="text-sm font-medium text-emerald-600">Saved</span>}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Save dimensions"}
        </button>
      </div>
    </Card>
  );
}

// ── Supplier & Replenishment ──────────────────────────────────────────────────

function SupplierSection({ product, onSaved }: { product: CatalogProduct; onSaved: (p: CatalogProduct) => void }) {
  const [rows, setRows] = useState([{
    id: "1",
    name: product.preferred_vendor_name ?? "",
    code: product.vendor_upc ?? "",
    price: product.wholesale_price_cents != null ? String((product.wholesale_price_cents / 100).toFixed(2)) : "",
  }]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [saved, setSaved]   = useState(false);

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      const primary = rows[0];
      const updated = await apiPatch<CatalogProduct>(`/api/v1/catalog/${product.id}`, {
        vendor_upc: primary?.code.trim() || undefined,
        wholesale_price_cents: primary?.price ? Math.round(parseFloat(primary.price) * 100) : undefined,
      });
      onSaved(updated);
      setSaved(true); window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Save failed.");
    } finally { setSaving(false); }
  };

  return (
    <Card
      title="Supplier Information"
      action={
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { id: String(Date.now()), name: "", code: "", price: "" }])}
          className="text-xs font-medium text-brand-600 hover:underline"
        >
          + Add supplier
        </button>
      }
    >
      {error && <p className="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}
      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div key={row.id} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              {idx === 0 && <Lbl>Supplier name</Lbl>}
              <input className={FLD} value={row.name}
                onChange={(e) => setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, name: e.target.value } : r))}
                placeholder="Supplier name…" />
            </div>
            <div>
              {idx === 0 && <Lbl>Supplier code / UPC</Lbl>}
              <input className={FLD} value={row.code}
                onChange={(e) => setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, code: e.target.value } : r))}
                placeholder="e.g. 012345678901" />
            </div>
            <div>
              {idx === 0 && <Lbl>Supplier price ($)</Lbl>}
              <input type="number" step="0.01" min="0" className={FLD} value={row.price}
                onChange={(e) => setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, price: e.target.value } : r))}
                placeholder="0.00" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {saved && <span className="text-sm font-medium text-emerald-600">Saved</span>}
        <button type="button" onClick={() => void handleSave()} disabled={saving}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40 transition-colors">
          {saving ? "Saving…" : "Save supplier"}
        </button>
      </div>
    </Card>
  );
}

function ReplenishmentSection({ product, onSaved }: { product: CatalogProduct; onSaved: (p: CatalogProduct) => void }) {
  const [track, setTrack] = useState(!!(product.track_inventory ?? 1));
  const [method, setMethod] = useState<"min_max" | "reorder_point">("min_max");
  const [form, setForm] = useState({
    min_qty:       product.min_qty_to_sell != null ? String(product.min_qty_to_sell) : "",
    max_qty:       product.max_qty_to_sell != null ? String(product.max_qty_to_sell) : "",
    reorder_point: "",
    reorder_qty:   product.qty_increment   != null ? String(product.qty_increment)   : "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      const patch: Record<string, unknown> = { track_inventory: track ? 1 : 0 };
      if (track) {
        if (method === "min_max") {
          patch.min_qty_to_sell = form.min_qty ? Number(form.min_qty) : null;
          patch.max_qty_to_sell = form.max_qty ? Number(form.max_qty) : null;
        } else {
          patch.qty_increment = form.reorder_qty ? Number(form.reorder_qty) : null;
        }
      }
      const updated = await apiPatch<CatalogProduct>(`/api/v1/catalog/${product.id}`, patch);
      onSaved(updated);
      setSaved(true); window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Save failed.");
    } finally { setSaving(false); }
  };

  return (
    <Card title="Replenishment Settings" sub="Configure inventory tracking and reorder thresholds">
      {error && <p className="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}

      <label className="mb-4 flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
          checked={track}
          onChange={(e) => setTrack(e.target.checked)}
        />
        <span className="text-sm font-medium text-[#111]">Track inventory for this product</span>
      </label>

      {track && (
        <div className="space-y-4">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Replenishment method</p>

            <label className="flex cursor-pointer items-start gap-3">
              <input type="radio" className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600"
                checked={method === "min_max"} onChange={() => setMethod("min_max")} />
              <div className="flex-1">
                <p className="text-sm font-medium text-[#111]">Min / Max quantity</p>
                <p className="text-xs text-slate-400">Min triggers replenishment; Max is the refill target</p>
                {method === "min_max" && (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div><Lbl>Min quantity</Lbl>
                      <input type="number" min="0" className={FLD} value={form.min_qty}
                        onChange={(e) => setForm((f) => ({ ...f, min_qty: e.target.value }))} placeholder="0" /></div>
                    <div><Lbl>Max quantity</Lbl>
                      <input type="number" min="0" className={FLD} value={form.max_qty}
                        onChange={(e) => setForm((f) => ({ ...f, max_qty: e.target.value }))} placeholder="0" /></div>
                  </div>
                )}
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-3">
              <input type="radio" className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600"
                checked={method === "reorder_point"} onChange={() => setMethod("reorder_point")} />
              <div className="flex-1">
                <p className="text-sm font-medium text-[#111]">Reorder point + quantity</p>
                <p className="text-xs text-slate-400">Triggers when stock drops to the reorder point</p>
                {method === "reorder_point" && (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div><Lbl>Reorder point</Lbl>
                      <input type="number" min="0" className={FLD} value={form.reorder_point}
                        onChange={(e) => setForm((f) => ({ ...f, reorder_point: e.target.value }))} placeholder="0" /></div>
                    <div><Lbl>Reorder quantity</Lbl>
                      <input type="number" min="0" className={FLD} value={form.reorder_qty}
                        onChange={(e) => setForm((f) => ({ ...f, reorder_qty: e.target.value }))} placeholder="0" /></div>
                  </div>
                )}
              </div>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm font-medium text-emerald-600">Saved</span>}
            <button type="button" onClick={() => void handleSave()} disabled={saving}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40 transition-colors">
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── InventoryTab ──────────────────────────────────────────────────────────────

// ── Availability breakdown ────────────────────────────────────────────────────
// Read-model over existing state: on-hand (inventory), reserved (approved
// unshipped sales orders), incoming (open approved PO remainder), available.

function AvailabilityCard({ productId, refreshKey }: { productId: string; refreshKey: number }) {
  const [avail, setAvail] = useState<{ on_hand: number; reserved: number; incoming: number; available: number } | null>(null);

  useEffect(() => {
    apiGet<{ on_hand: number; reserved: number; incoming: number; available: number }>(`/api/v1/inventory/${productId}/availability`)
      .then(setAvail)
      .catch(() => setAvail(null));
  }, [productId, refreshKey]);

  if (!avail) return null;
  const tiles = [
    { label: "On Hand", value: avail.on_hand, cls: "text-slate-900" },
    { label: "Reserved", value: avail.reserved, cls: avail.reserved > 0 ? "text-amber-600" : "text-slate-400", hint: "On approved orders awaiting fulfillment" },
    { label: "Incoming", value: avail.incoming, cls: avail.incoming > 0 ? "text-[#5D5FEF]" : "text-slate-400", hint: "On open purchase orders" },
    { label: "Available", value: avail.available, cls: avail.available > 0 ? "text-emerald-600" : "text-red-600", hint: "On hand minus reserved" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="bg-white px-4 py-3" title={t.hint}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t.label}</p>
          <p className={`mt-0.5 text-xl font-semibold tabular-nums ${t.cls}`}>{t.value}</p>
        </div>
      ))}
    </div>
  );
}

export function InventoryTab({
  product,
  onSaved,
}: {
  product: CatalogProduct;
  onSaved: (p: CatalogProduct) => void;
}) {
  const [stockRefreshKey, setStockRefreshKey] = useState(0);

  // Load locations from stock endpoint (needed for QuickAdjust dropdown)
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [totalOnHand, setTotalOnHand] = useState<number | null>(null);
  const [reorderPt, setReorderPt] = useState<number>(product.min_qty_to_sell ?? 0);

  useEffect(() => {
    apiGet<StockResponse>(`/api/v1/catalog/${product.id}/stock`)
      .then((r) => {
        setLocations((r.locations ?? []).map((l) => ({ id: l.location_id, name: l.location_name })));
        setTotalOnHand((r.locations ?? []).reduce((s, l) => s + l.quantity_on_hand, 0));
      })
      .catch(() => {});
  }, [product.id, stockRefreshKey]);

  const handleAdjusted = useCallback(() => {
    setStockRefreshKey((k) => k + 1);
  }, []);

  // Low stock: total on-hand at or below reorder point
  const isLowStock = totalOnHand !== null && reorderPt > 0 && totalOnHand <= reorderPt;

  return (
    <div className="space-y-4">

      {/* Low stock banner */}
      {isLowStock && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="h-5 w-5 shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">Low stock — {totalOnHand} units remaining</p>
            <p className="text-xs text-amber-600">Reorder point is {reorderPt} units. Consider placing a purchase order.</p>
          </div>
        </div>
      )}

      {/* Availability breakdown */}
      <AvailabilityCard productId={product.id} refreshKey={stockRefreshKey} />

      {/* Stock by location */}
      <StockByLocation productId={product.id} refreshKey={stockRefreshKey} />

      {/* Quick adjust */}
      {locations.length > 0 && (
        <QuickAdjust
          productId={product.id}
          locations={locations}
          onAdjusted={handleAdjusted}
        />
      )}

      {/* Movement history */}
      <MovementHistory productId={product.id} refreshKey={stockRefreshKey} />

      {/* Supplier */}
      <SupplierSection product={product} onSaved={onSaved} />

      {/* Replenishment */}
      <ReplenishmentSection
        product={product}
        onSaved={(p) => {
          onSaved(p);
          setReorderPt(p.min_qty_to_sell ?? 0);
        }}
      />

      {/* Physical attributes */}
      <PhysicalAttributes product={product} onSaved={onSaved} />

    </div>
  );
}
