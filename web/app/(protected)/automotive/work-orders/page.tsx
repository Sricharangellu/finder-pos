"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { WorkOrderStatus, WorkOrder, WorkOrdersResponse, Vehicle, VehiclesResponse } from "@/api-client/types";
import { clsx } from "clsx";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STATUS_BADGE: Record<WorkOrderStatus, BadgeVariant> = {
  open:        "blue",
  in_progress: "yellow",
  ready:       "green",
  closed:      "gray",
  cancelled:   "red",
};

const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  open:        "Open",
  in_progress: "In Progress",
  ready:       "Ready",
  closed:      "Closed",
  cancelled:   "Cancelled",
};

const ALL_STATUSES: WorkOrderStatus[] = ["open", "in_progress", "ready", "closed", "cancelled"];

interface CreateWOForm { vehicleId: string; title: string; description: string; estimateCents: string; }
const EMPTY_FORM: CreateWOForm = { vehicleId: "", title: "", description: "", estimateCents: "0" };

export default function WorkOrdersPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | "all">("all");
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateWOForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [woData, vData] = await Promise.all([
        apiGet<WorkOrdersResponse>("/api/v1/automotive/work-orders"),
        apiGet<VehiclesResponse>("/api/v1/automotive/vehicles"),
      ]);
      setOrders(woData.items ?? []);
      setVehicles(vData.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = statusFilter === "all" ? orders : orders.filter(o => o.status === statusFilter);
  const counts = ALL_STATUSES.reduce<Record<string, number>>((a, s) => { a[s] = orders.filter(o => o.status === s).length; return a; }, {});

  async function createWorkOrder() {
    if (!form.vehicleId || !form.title.trim()) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/automotive/work-orders", {
        vehicleId: form.vehicleId,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        estimateCents: Math.round(parseFloat(form.estimateCents) * 100) || 0,
      });
      setShowCreate(false); setForm(EMPTY_FORM); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  async function updateStatus(id: string, status: WorkOrderStatus) {
    try {
      await apiPatch(`/api/v1/automotive/work-orders/${id}/status`, { status });
      setSelected(null); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  function formatDate(ts: number) { return new Date(ts).toLocaleDateString(); }

  function vehicleLabel(vehicleId: string) {
    const v = vehicles.find(v => v.id === vehicleId);
    if (!v) return vehicleId;
    return `${v.year ?? ""} ${v.make} ${v.model}`.trim();
  }

  return (
    <EnterpriseShell active="automotive-work-orders" title="Work Orders" subtitle="Service & repair work order tracking">
      <div className="flex flex-col gap-6 p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {ALL_STATUSES.map(s => (
            <Card key={s} className={clsx("p-4 cursor-pointer hover:shadow-md transition-shadow", statusFilter === s && "ring-2 ring-brand-500")}
              onClick={() => setStatusFilter(f => f === s ? "all" : s)}>
              <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">{STATUS_LABEL[s]}</p>
              <p className={clsx("mt-1 text-2xl font-bold", statusFilter === s && "text-brand-600")}>{counts[s] ?? 0}</p>
            </Card>
          ))}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowCreate(true)}>+ New Work Order</Button>
        </div>

        {loading && <TableSkeleton rows={5} cols={5} />}
        {error && <p className="text-red-600 text-sm py-4">{error}</p>}

        {!loading && (
          <div className="overflow-hidden rounded-lg border border-[#E8E8E8] bg-white">
            {visible.length === 0 ? (
              <div className="p-12 text-center text-sm text-[rgba(0,0,0,0.45)]">No work orders found.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Vehicle</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Labour</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Actual</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(wo => (
                    <tr key={wo.id} className="border-b border-[#F0F0F0] cursor-pointer hover:bg-[#FAFAFA]" onClick={() => setSelected(wo)}>
                      <td className="px-4 py-3 font-medium text-[rgba(0,0,0,0.88)]">{vehicleLabel(wo.vehicle_id)}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)] max-w-xs truncate">{wo.title}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{formatMoney(wo.labour_cents)}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{formatMoney(wo.actual_cents)}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{formatDate(wo.created_at)}</td>
                      <td className="px-4 py-3"><Badge variant={STATUS_BADGE[wo.status]} size="sm">{STATUS_LABEL[wo.status]}</Badge></td>
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
                  <h3 className="text-lg font-bold">{selected.title}</h3>
                  <p className="text-xs text-[rgba(0,0,0,0.45)]">{vehicleLabel(selected.vehicle_id)}</p>
                  {selected.description && <p className="text-xs text-[rgba(0,0,0,0.65)] mt-1">{selected.description}</p>}
                </div>
                <Badge variant={STATUS_BADGE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
              </div>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">Estimate</span><span>{formatMoney(selected.estimate_cents)}</span></div>
                <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">Labour</span><span>{formatMoney(selected.labour_cents)}</span></div>
                <div className="flex justify-between font-semibold border-t border-[#F0F0F0] pt-2">
                  <span>Actual</span><span>{formatMoney(selected.actual_cents)}</span>
                </div>
              </div>
              <div className="space-y-2 mb-4">
                <h4 className="text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Change Status</h4>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_STATUSES.filter(s => s !== selected.status).map(s => (
                    <button key={s} type="button" onClick={() => void updateStatus(selected.id, s)}
                      className="rounded border border-[#D9D9D9] px-3 py-1.5 text-xs text-[rgba(0,0,0,0.65)] hover:bg-[#F5F5F5]">
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="w-full rounded border border-[#D9D9D9] py-1.5 text-xs text-[rgba(0,0,0,0.45)] hover:bg-[#F5F5F5]">Close</button>
            </div>
          </div>
        )}

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">New Work Order</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Vehicle *</label>
                  <select value={form.vehicleId} onChange={e => setForm(f => ({ ...f, vehicleId: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" autoFocus>
                    <option value="">Select vehicle…</option>
                    {vehicles.map(v => <option key={v.id} value={v.id}>{v.year} {v.make} {v.model}{v.license_plate ? ` (${v.license_plate})` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Title *</label>
                  <input type="text" placeholder="Oil change, brake pads…" value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Description</label>
                  <input type="text" placeholder="Additional details…" value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Estimate ($)</label>
                  <input type="number" min="0" step="0.01" value={form.estimateCents}
                    onChange={e => setForm(f => ({ ...f, estimateCents: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void createWorkOrder()} loading={saving}>Create</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
