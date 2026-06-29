"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { RentalContractStatus, RentalContract, RentalContractsResponse, RentalAsset, RentalAssetsResponse } from "@/api-client/types";
import { clsx } from "clsx";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STATUS_BADGE: Record<RentalContractStatus, BadgeVariant> = {
  draft:     "gray",
  active:    "blue",
  returned:  "green",
  cancelled: "red",
};

const STATUS_LABEL: Record<RentalContractStatus, string> = {
  draft:     "Draft",
  active:    "Active",
  returned:  "Returned",
  cancelled: "Cancelled",
};

const ALL_STATUSES: RentalContractStatus[] = ["draft", "active", "returned", "cancelled"];

interface CreateContractForm { assetId: string; customerName: string; startDate: string; endDate: string; }
const EMPTY_FORM: CreateContractForm = { assetId: "", customerName: "", startDate: "", endDate: "" };

export default function RentalContractsPage() {
  const [contracts, setContracts] = useState<RentalContract[]>([]);
  const [assets, setAssets] = useState<RentalAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RentalContractStatus | "all">("all");
  const [selected, setSelected] = useState<RentalContract | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateContractForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [cData, aData] = await Promise.all([
        apiGet<RentalContractsResponse>("/api/v1/rental/contracts"),
        apiGet<RentalAssetsResponse>("/api/v1/rental/assets"),
      ]);
      setContracts(cData.items ?? []);
      setAssets(aData.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = statusFilter === "all" ? contracts : contracts.filter(c => c.status === statusFilter);
  const counts = ALL_STATUSES.reduce<Record<string, number>>((a, s) => { a[s] = contracts.filter(c => c.status === s).length; return a; }, {});

  async function createContract() {
    if (!form.assetId || !form.customerName.trim() || !form.startDate || !form.endDate) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/rental/contracts", {
        assetId: form.assetId,
        customerName: form.customerName.trim(),
        startsAt: new Date(form.startDate).getTime(),
        endsAt: new Date(form.endDate).getTime(),
      });
      setShowCreate(false); setForm(EMPTY_FORM); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  async function returnAsset(contractId: string) {
    if (!confirm("Mark this contract as returned?")) return;
    try {
      await apiPatch(`/api/v1/rental/contracts/${contractId}/return`, {});
      setSelected(null); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  function formatDate(ts: number) { return new Date(ts).toLocaleDateString(); }

  function durationDays(c: RentalContract) {
    return Math.max(1, Math.round((c.ends_at - c.starts_at) / 86400000));
  }

  const availableAssets = assets.filter(a => a.status === "available");

  return (
    <EnterpriseShell active="rental-contracts" title="Rental Contracts" subtitle="Active rentals & return tracking">
      <div className="flex flex-col gap-6 p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ALL_STATUSES.map(s => (
            <Card key={s} className={clsx("p-4 cursor-pointer hover:shadow-md transition-shadow", statusFilter === s && "ring-2 ring-brand-500")}
              onClick={() => setStatusFilter(f => f === s ? "all" : s)}>
              <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">{STATUS_LABEL[s]}</p>
              <p className={clsx("mt-1 text-2xl font-bold", s === "active" && "text-blue-600")}>{counts[s] ?? 0}</p>
            </Card>
          ))}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowCreate(true)}>+ New Contract</Button>
        </div>

        {loading && <TableSkeleton rows={5} cols={6} />}
        {error && <p className="text-red-600 text-sm py-4">{error}</p>}

        {!loading && (
          <div className="overflow-hidden rounded-lg border border-[#E8E8E8] bg-white">
            {visible.length === 0 ? (
              <div className="p-12 text-center text-sm text-[rgba(0,0,0,0.45)]">No contracts found.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Asset</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Start</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">End</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Deposit</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(c => (
                    <tr key={c.id} className="border-b border-[#F0F0F0] cursor-pointer hover:bg-[#FAFAFA]" onClick={() => setSelected(c)}>
                      <td className="px-4 py-3 font-medium text-[rgba(0,0,0,0.88)]">{c.customer_name ?? "—"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{c.asset_name ?? "—"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{formatDate(c.starts_at)}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{formatDate(c.ends_at)}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{formatMoney(c.deposit_cents)}</td>
                      <td className="px-4 py-3"><Badge variant={STATUS_BADGE[c.status]} size="sm">{STATUS_LABEL[c.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Detail modal */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">{selected.customer_name ?? "—"}</h3>
                  <p className="text-xs text-[rgba(0,0,0,0.45)]">{selected.asset_name ?? "No asset"}</p>
                </div>
                <Badge variant={STATUS_BADGE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
              </div>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">Period</span><span>{formatDate(selected.starts_at)} – {formatDate(selected.ends_at)}</span></div>
                <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">Duration</span><span>{durationDays(selected)} day{durationDays(selected) !== 1 ? "s" : ""}</span></div>
                <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">Daily Rate</span><span>{formatMoney(selected.daily_rate_cents)}/day</span></div>
                <div className="flex justify-between font-semibold border-t border-[#F0F0F0] pt-2"><span>Deposit</span><span>{formatMoney(selected.deposit_cents)}</span></div>
              </div>
              {selected.status === "active" && (
                <Button className="w-full mb-2" onClick={() => void returnAsset(selected.id)}>Mark Returned</Button>
              )}
              <button type="button" onClick={() => setSelected(null)} className="w-full rounded border border-[#D9D9D9] py-1.5 text-xs text-[rgba(0,0,0,0.45)] hover:bg-[#F5F5F5]">Close</button>
            </div>
          </div>
        )}

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">New Rental Contract</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Asset *</label>
                  <select value={form.assetId} onChange={e => setForm(f => ({ ...f, assetId: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" autoFocus>
                    <option value="">Select available asset…</option>
                    {availableAssets.map(a => <option key={a.id} value={a.id}>{a.name} — {formatMoney(a.daily_rate_cents)}/day</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Customer Name *</label>
                  <input type="text" placeholder="Jane Smith" value={form.customerName}
                    onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">Start Date *</label>
                    <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                      className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">End Date *</label>
                    <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                      className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                  </div>
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void createContract()} loading={saving}>Create</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
