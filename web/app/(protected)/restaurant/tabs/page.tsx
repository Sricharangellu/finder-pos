"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost } from "@/api-client/client";
import type { BarTab, BarTabsResponse, TabStatus } from "@/api-client/types";
import { clsx } from "clsx";

function elapsed(openedAt: number): string {
  const mins = Math.floor((Date.now() - openedAt) / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface OpenTabForm {
  customerName: string;
  tableId: string;
}

export default function BarTabsPage() {
  const [tabs, setTabs] = useState<BarTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TabStatus | "all">("open");
  const [selected, setSelected] = useState<BarTab | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<OpenTabForm>({ customerName: "", tableId: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = statusFilter !== "all"
        ? `/api/v1/restaurant/tabs?status=${statusFilter}`
        : "/api/v1/restaurant/tabs";
      const data = await apiGet<BarTabsResponse>(url);
      setTabs(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tabs");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const openCount   = tabs.filter(t => t.status === "open").length;
  const closedCount = tabs.filter(t => t.status === "closed").length;
  const totalOpen   = tabs.filter(t => t.status === "open").length; // count only

  async function openTab() {
    if (!form.customerName.trim()) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/restaurant/tabs", {
        customerName: form.customerName.trim(),
        tableId: form.tableId.trim() || undefined,
      });
      setShowCreate(false);
      setForm({ customerName: "", tableId: "" });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to open tab");
    } finally {
      setSaving(false);
    }
  }

  async function closeTab(tabId: string) {
    if (!confirm("Close this tab? This will finalize the tab for payment.")) return;
    setSaving(true);
    try {
      await apiPost(`/api/v1/restaurant/tabs/${tabId}/close`, {});
      setSelected(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to close tab");
    } finally {
      setSaving(false);
    }
  }

  return (
    <EnterpriseShell active="restaurant-tabs" title="Bar Tabs" subtitle="Open tabs and multi-round ordering">
      <div className="flex flex-col gap-6 p-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Open Tabs</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{openCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Closed Today</p>
            <p className="mt-1 text-2xl font-bold text-[rgba(0,0,0,0.88)]">{closedCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Total Open</p>
            <p className="mt-1 text-2xl font-bold text-[rgba(0,0,0,0.88)]">{totalOpen}</p>
          </Card>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded border border-[#D9D9D9] bg-white p-0.5">
            {(["open", "closed", "all"] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={clsx(
                  "rounded px-3 py-1 text-xs font-medium transition-colors capitalize",
                  statusFilter === s ? "bg-brand-600 text-white" : "text-[rgba(0,0,0,0.65)] hover:bg-[#F5F5F5]",
                )}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>+ Open Tab</Button>
        </div>

        {loading && <TableSkeleton rows={5} cols={4} />}
        {error && <p className="text-center text-sm text-red-600 py-8">{error}</p>}

        {!loading && (
          <div className="overflow-hidden rounded-lg border border-[#E8E8E8] bg-white">
            {tabs.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-sm text-[rgba(0,0,0,0.45)]">No {statusFilter !== "all" ? statusFilter : ""} tabs found.</p>
                {statusFilter === "open" && (
                  <Button size="sm" className="mt-3" onClick={() => setShowCreate(true)}>+ Open First Tab</Button>
                )}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Table</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Rounds</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Elapsed</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {tabs.map(tab => (
                    <tr
                      key={tab.id}
                      className="border-b border-[#F0F0F0] cursor-pointer hover:bg-[#FAFAFA] transition-colors"
                      onClick={() => setSelected(tab)}
                    >
                      <td className="px-4 py-3 font-medium text-[rgba(0,0,0,0.88)]">
                        {tab.customer_name ?? "Walk-in"}
                      </td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">
                        {tab.table_id ? `Table ${tab.table_id.slice(-4)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{tab.order_ids.length}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">
                        {tab.status === "open" ? elapsed(tab.opened_at) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={tab.status === "open" ? "blue" : "gray"} size="sm">
                          {tab.status === "open" ? "Open" : "Closed"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {tab.status === "open" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={e => { e.stopPropagation(); void closeTab(tab.id); }}
                          >
                            Close Tab
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab detail modal */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
            <div className="w-full max-w-md rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">{selected.customer_name ?? "Walk-in"}</h3>
                  <p className="text-xs text-[rgba(0,0,0,0.45)]">
                    Opened {new Date(selected.opened_at).toLocaleTimeString()}
                    {selected.status === "open" && ` · ${elapsed(selected.opened_at)} elapsed`}
                  </p>
                </div>
                <Badge variant={selected.status === "open" ? "blue" : "gray"}>
                  {selected.status === "open" ? "Open" : "Closed"}
                </Badge>
              </div>
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-[rgba(0,0,0,0.45)]">Rounds</span>
                  <span className="font-medium">{selected.order_ids.length}</span>
                </div>
                {selected.table_id && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[rgba(0,0,0,0.45)]">Table</span>
                    <span className="font-medium">{selected.table_id}</span>
                  </div>
                )}
              </div>
              {selected.status === "open" && (
                <Button
                  className="w-full"
                  onClick={() => void closeTab(selected.id)}
                  loading={saving}
                >
                  Close Tab &amp; Proceed to Payment
                </Button>
              )}
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mt-2 w-full rounded border border-[#D9D9D9] py-1.5 text-xs text-[rgba(0,0,0,0.45)] hover:bg-[#F5F5F5]"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Open tab modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Open Tab</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[rgba(0,0,0,0.65)] mb-1">Customer Name *</label>
                  <input
                    type="text" placeholder="John Smith…"
                    value={form.customerName}
                    onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[rgba(0,0,0,0.65)] mb-1">Table ID (optional)</label>
                  <input
                    type="text" placeholder="Table number or ID…"
                    value={form.tableId}
                    onChange={e => setForm(f => ({ ...f, tableId: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void openTab()} loading={saving}>Open Tab</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
