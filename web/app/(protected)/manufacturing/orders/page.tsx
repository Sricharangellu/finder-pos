"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch } from "@/api-client/client";
import type { ProductionOrderStatus, ProductionOrder, ProductionOrdersResponse } from "@/api-client/types";
import { clsx } from "clsx";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STATUS_BADGE: Record<ProductionOrderStatus, BadgeVariant> = {
  draft:       "gray",
  in_progress: "blue",
  completed:   "green",
  cancelled:   "red",
};

const STATUS_LABEL: Record<ProductionOrderStatus, string> = {
  draft:       "Draft",
  in_progress: "In Progress",
  completed:   "Completed",
  cancelled:   "Cancelled",
};

const ALL_STATUSES: ProductionOrderStatus[] = ["draft", "in_progress", "completed", "cancelled"];

interface CreateOrderForm { productName: string; quantity: string; }
const EMPTY_FORM: CreateOrderForm = { productName: "", quantity: "1" };

export default function ManufacturingOrdersPage() {
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProductionOrderStatus | "all">("all");
  const [selected, setSelected] = useState<ProductionOrder | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateOrderForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<ProductionOrdersResponse>("/api/v1/manufacturing/orders");
      setOrders(data.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load orders"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = statusFilter === "all" ? orders : orders.filter(o => o.status === statusFilter);
  const counts = ALL_STATUSES.reduce<Record<string, number>>((a, s) => { a[s] = orders.filter(o => o.status === s).length; return a; }, {});

  async function createOrder() {
    if (!form.productName.trim()) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/manufacturing/orders", {
        productName: form.productName.trim(),
        quantity: parseInt(form.quantity) || 1,
      });
      setShowCreate(false); setForm(EMPTY_FORM); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  async function updateStatus(orderId: string, status: ProductionOrderStatus) {
    try {
      await apiPatch(`/api/v1/manufacturing/orders/${orderId}/status`, { status });
      setSelected(null); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString();
  }

  return (
    <EnterpriseShell active="manufacturing-orders" title="Production Orders" subtitle="Manufacturing order management & BOM tracking">
      <div className="flex flex-col gap-6 p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ALL_STATUSES.map(s => (
            <Card key={s} className={clsx("p-4 cursor-pointer hover:shadow-md transition-shadow", statusFilter === s && "ring-2 ring-brand-500")}
              onClick={() => setStatusFilter(f => f === s ? "all" : s)}>
              <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">{STATUS_LABEL[s]}</p>
              <p className={clsx("mt-1 text-2xl font-bold", statusFilter === s && "text-brand-600")}>{counts[s] ?? 0}</p>
            </Card>
          ))}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowCreate(true)}>+ New Order</Button>
        </div>

        {loading && <TableSkeleton rows={5} cols={5} />}
        {error && <p className="text-red-600 text-sm py-4">{error}</p>}

        {!loading && (
          <div className="overflow-hidden rounded-lg border border-[#E8E8E8] bg-white">
            {visible.length === 0 ? (
              <div className="p-12 text-center text-sm text-[rgba(0,0,0,0.45)]">No production orders found.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Quantity</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Started</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Created</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(order => (
                    <tr key={order.id} className="border-b border-[#F0F0F0] cursor-pointer hover:bg-[#FAFAFA]" onClick={() => setSelected(order)}>
                      <td className="px-4 py-3 font-medium text-[rgba(0,0,0,0.88)]">{order.product_name ?? "—"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{order.quantity}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{order.started_at ? formatDate(order.started_at) : "—"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{formatDate(order.created_at)}</td>
                      <td className="px-4 py-3"><Badge variant={STATUS_BADGE[order.status]} size="sm">{STATUS_LABEL[order.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Order detail modal */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
            <div className="w-full max-w-md rounded-xl bg-white shadow-2xl p-6 overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">{selected.product_name ?? "Production Order"}</h3>
                  <p className="text-xs text-[rgba(0,0,0,0.45)]">Qty: {selected.quantity}</p>
                </div>
                <Badge variant={STATUS_BADGE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
              </div>

              {selected.notes && <p className="mb-4 text-sm text-[rgba(0,0,0,0.65)] bg-[#FAFAFA] rounded p-2">{selected.notes}</p>}

              {/* BOM lines */}
              {selected.bom_lines && selected.bom_lines.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-semibold mb-2">Bill of Materials</h4>
                  <div className="space-y-1">
                    {selected.bom_lines.map((b, i) => (
                      <div key={i} className="flex justify-between text-xs border-b border-[#F0F0F0] py-1">
                        <span className="text-[rgba(0,0,0,0.65)]">{b.raw_material_name}</span>
                        <span className="font-medium">{b.qty_consumed} / {b.qty_required} {b.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Change Status</h4>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_STATUSES.filter(s => s !== selected.status).map(s => (
                    <button key={s} type="button" onClick={() => void updateStatus(selected.id, s)}
                      className="rounded border border-[#D9D9D9] px-3 py-1.5 text-xs text-[rgba(0,0,0,0.65)] hover:bg-[#F5F5F5]">
                      Set {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="mt-4 w-full rounded border border-[#D9D9D9] py-1.5 text-xs text-[rgba(0,0,0,0.45)] hover:bg-[#F5F5F5]">Close</button>
            </div>
          </div>
        )}

        {/* Create order modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">New Production Order</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Product Name *</label>
                  <input type="text" placeholder="Widget Pro 500…" value={form.productName}
                    onChange={e => setForm(f => ({ ...f, productName: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Quantity to Produce</label>
                  <input type="number" min="1" value={form.quantity}
                    onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void createOrder()} loading={saving}>Create</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
