"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { RentalAssetStatus, RentalAsset, RentalAssetsResponse } from "@/api-client/types";
import { clsx } from "clsx";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STATUS_BADGE: Record<RentalAssetStatus, BadgeVariant> = {
  available:   "green",
  rented:      "blue",
  maintenance: "yellow",
  retired:     "gray",
};

const STATUS_LABEL: Record<RentalAssetStatus, string> = {
  available:   "Available",
  rented:      "Rented",
  maintenance: "Maintenance",
  retired:     "Retired",
};

const ALL_STATUSES: RentalAssetStatus[] = ["available", "rented", "maintenance", "retired"];

interface CreateAssetForm { name: string; category: string; dailyRateCents: string; serialNumber: string; }
const EMPTY_FORM: CreateAssetForm = { name: "", category: "", dailyRateCents: "5000", serialNumber: "" };

export default function RentalAssetsPage() {
  const [assets, setAssets] = useState<RentalAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RentalAssetStatus | "all">("all");
  const [selected, setSelected] = useState<RentalAsset | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateAssetForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<RentalAssetsResponse>("/api/v1/rental/assets");
      setAssets(data.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load assets"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = statusFilter === "all" ? assets : assets.filter(a => a.status === statusFilter);
  const counts = ALL_STATUSES.reduce<Record<string, number>>((a, s) => { a[s] = assets.filter(r => r.status === s).length; return a; }, {});

  async function createAsset() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/rental/assets", {
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        dailyRateCents: Math.round(parseFloat(form.dailyRateCents) * 100) || 0,
        serialNumber: form.serialNumber.trim() || undefined,
      });
      setShowCreate(false); setForm(EMPTY_FORM); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  return (
    <EnterpriseShell active="rental-assets" title="Rental Assets" subtitle="Equipment & asset inventory management">
      <div className="flex flex-col gap-6 p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ALL_STATUSES.map(s => (
            <Card key={s} className={clsx("p-4 cursor-pointer hover:shadow-md transition-shadow", statusFilter === s && "ring-2 ring-brand-500")}
              onClick={() => setStatusFilter(f => f === s ? "all" : s)}>
              <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">{STATUS_LABEL[s]}</p>
              <p className={clsx("mt-1 text-2xl font-bold", s === "available" && "text-green-600", s === "rented" && "text-blue-600")}>{counts[s] ?? 0}</p>
            </Card>
          ))}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowCreate(true)}>+ Add Asset</Button>
        </div>

        {loading && <TableSkeleton rows={5} cols={5} />}
        {error && <p className="text-red-600 text-sm py-4">{error}</p>}

        {!loading && (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {visible.map(asset => (
              <button key={asset.id} type="button" onClick={() => setSelected(asset)}
                className={clsx("rounded-lg border-2 p-4 text-left transition-all hover:shadow-md",
                  asset.status === "available" && "border-emerald-300 bg-emerald-50",
                  asset.status === "rented" && "border-blue-300 bg-blue-50",
                  asset.status === "maintenance" && "border-amber-300 bg-amber-50",
                  asset.status === "retired" && "border-gray-200 bg-gray-50",
                )}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-[rgba(0,0,0,0.88)] truncate">{asset.name}</span>
                  <Badge variant={STATUS_BADGE[asset.status]} size="sm">{STATUS_LABEL[asset.status]}</Badge>
                </div>
                {asset.category && <p className="text-xs text-[rgba(0,0,0,0.45)] capitalize">{asset.category}</p>}
                <p className="mt-1 text-xs font-medium">{formatMoney(asset.daily_rate_cents)}/day</p>
                {asset.serial && <p className="text-xs text-[rgba(0,0,0,0.35)] font-mono mt-0.5">{asset.serial}</p>}
              </button>
            ))}
            {visible.length === 0 && (
              <div className="col-span-full p-12 text-center text-sm text-[rgba(0,0,0,0.45)]">No assets found. Add your first rental asset.</div>
            )}
          </div>
        )}

        {/* Detail modal */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">{selected.name}</h3>
                  {selected.category && <p className="text-xs text-[rgba(0,0,0,0.45)] capitalize">{selected.category}</p>}
                </div>
                <Badge variant={STATUS_BADGE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
              </div>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">Daily Rate</span><span>{formatMoney(selected.daily_rate_cents)}</span></div>
                {selected.serial && <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">Serial #</span><span className="font-mono text-xs">{selected.serial}</span></div>}
              </div>
              <button type="button" onClick={() => setSelected(null)} className="w-full rounded border border-[#D9D9D9] py-1.5 text-xs text-[rgba(0,0,0,0.45)] hover:bg-[#F5F5F5]">Close</button>
            </div>
          </div>
        )}

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Add Rental Asset</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Asset Name *</label>
                  <input type="text" placeholder="Canon EOS R5, 2023 Ford Transit…" value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Category</label>
                  <input type="text" placeholder="Camera, Vehicle, Tool…" value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Daily Rate ($)</label>
                  <input type="number" min="0" step="0.01" value={(parseInt(form.dailyRateCents) / 100).toFixed(2)}
                    onChange={e => setForm(f => ({ ...f, dailyRateCents: String(Math.round(parseFloat(e.target.value) * 100)) }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Serial Number</label>
                  <input type="text" placeholder="SN-12345" value={form.serialNumber}
                    onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm font-mono" />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void createAsset()} loading={saving}>Add</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
