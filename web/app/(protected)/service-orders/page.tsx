"use client";
import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { ServiceOrder, ServiceOrderStatus, ServiceOrderResponse } from "@/api-client/types";
import { fmtDate, fmtDateTime } from "@/lib/date";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STATUS_BADGE: Record<ServiceOrderStatus, BadgeVariant> = {
  draft: "gray",
  open: "blue",
  in_progress: "yellow",
  ready: "green",
  closed: "gray",
};

const STATUS_LABEL: Record<ServiceOrderStatus, string> = {
  draft: "Draft",
  open: "Open",
  in_progress: "In Progress",
  ready: "Ready",
  closed: "Closed",
};

const STATUS_TRANSITIONS: Record<ServiceOrderStatus, ServiceOrderStatus | null> = {
  draft: "open",
  open: "in_progress",
  in_progress: "ready",
  ready: "closed",
  closed: null,
};

const TRANSITION_LABEL: Record<ServiceOrderStatus, string> = {
  draft: "Open Ticket",
  open: "Start Work",
  in_progress: "Mark Ready",
  ready: "Close",
  closed: "",
};

const ALL_STATUSES: ServiceOrderStatus[] = ["draft", "open", "in_progress", "ready", "closed"];

interface CreateForm {
  customer_name: string;
  title: string;
  description: string;
  estimate_cents_str: string;
  assigned_to_name: string;
}

const EMPTY_FORM: CreateForm = {
  customer_name: "",
  title: "",
  description: "",
  estimate_cents_str: "",
  assigned_to_name: "",
};

export default function ServiceOrdersPage() {
  const [items, setItems] = useState<ServiceOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ServiceOrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ServiceOrder | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search.trim()) params.set("q", search.trim());
      const data = await apiGet<ServiceOrderResponse>(`/api/v1/service-orders?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load service orders.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const cents = Math.round(parseFloat(form.estimate_cents_str.replace(/[^0-9.]/g, "")) * 100) || 0;
      await apiPost("/api/v1/service-orders", {
        customer_name: form.customer_name,
        title: form.title,
        description: form.description,
        estimate_cents: cents,
        assigned_to_name: form.assigned_to_name || null,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to create service order.");
    } finally {
      setSaving(false);
    }
  };

  const handleTransition = async (order: ServiceOrder) => {
    const next = STATUS_TRANSITIONS[order.status];
    if (!next) return;
    setTransitioning(order.id);
    try {
      const patch: Partial<ServiceOrder> = { status: next };
      if (next === "closed") patch.actual_cents = order.estimate_cents;
      await apiPatch(`/api/v1/service-orders/${order.id}`, patch);
      if (selected?.id === order.id) setSelected({ ...order, ...patch });
      await load();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to update status.");
    } finally {
      setTransitioning(null);
    }
  };

  const formField = (key: keyof CreateForm, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <EnterpriseShell active="service-orders" title="Service Orders" subtitle="Repair ticket management"
      contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search tickets or customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {(["all", ...ALL_STATUSES] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {s === "all" ? "All" : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <Button variant="primary" onClick={() => { setShowCreate(true); setForm(EMPTY_FORM); }}>
              + New Ticket
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {ALL_STATUSES.map((s) => {
            const count = items.filter((o) => o.status === s).length;
            return (
              <Card key={s} className="cursor-pointer p-4 text-center hover:bg-slate-50"
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}>
                <p className="text-2xl font-bold text-slate-900">{count}</p>
                <p className="mt-0.5 text-xs text-slate-500">{STATUS_LABEL[s]}</p>
              </Card>
            );
          })}
        </div>

        {/* Table */}
        {loading ? (
          <TableSkeleton headers={["Ticket #", "Customer", "Device", "Status", "Assigned", "Due", ""]} rows={8} />
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-table-border)] py-16 text-center">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">No tickets found</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Create your first repair ticket to get started.</p>
          </div>
        ) : (
        <Card className="overflow-hidden p-0">
          {(
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Ticket</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Estimate</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actual</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Created</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((order) => {
                  const next = STATUS_TRANSITIONS[order.status];
                  return (
                    <tr key={order.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <button
                          onClick={() => setSelected(order)}
                          className="max-w-xs truncate text-left font-medium text-blue-600 hover:underline"
                        >
                          {order.title}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-slate-700">{order.customer_name}</td>
                      <td className="px-5 py-3">
                        <Badge variant={STATUS_BADGE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{order.assigned_to_name ?? "—"}</td>
                      <td className="px-5 py-3 text-right font-mono text-slate-700">{formatMoney(order.estimate_cents)}</td>
                      <td className="px-5 py-3 text-right font-mono text-slate-500">
                        {order.actual_cents != null ? formatMoney(order.actual_cents) : "—"}
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-xs">
                        {fmtDate(order.created_at)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {next && (
                          <button
                            onClick={() => void handleTransition(order)}
                            disabled={transitioning === order.id}
                            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                          >
                            {transitioning === order.id ? "…" : TRANSITION_LABEL[order.status]}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
          }
          {total > 0 && (
            <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
              {total} ticket{total !== 1 ? "s" : ""}
            </div>
          )}
        </Card>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-950">{selected.title}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{selected.customer_name}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)}
                className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_BADGE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
                {selected.assigned_to_name && (
                  <span className="text-sm text-slate-500">· Assigned to {selected.assigned_to_name}</span>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Description</p>
                <p className="text-sm text-slate-700 leading-relaxed">{selected.description || "No description."}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Estimate</p>
                  <p className="text-sm font-mono font-medium text-slate-900">{formatMoney(selected.estimate_cents)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Actual</p>
                  <p className="text-sm font-mono font-medium text-slate-900">
                    {selected.actual_cents != null ? formatMoney(selected.actual_cents) : "—"}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs text-slate-500">
                <div>Created {fmtDateTime(selected.created_at)}</div>
                <div>Updated {fmtDateTime(selected.updated_at)}</div>
              </div>
            </div>
            {STATUS_TRANSITIONS[selected.status] && (
              <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
                <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
                <Button
                  variant="primary"
                  onClick={() => { void handleTransition(selected); setSelected(null); }}
                  disabled={transitioning === selected.id}
                >
                  {TRANSITION_LABEL[selected.status]}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">New Service Ticket</h2>
              <button type="button" onClick={() => setShowCreate(false)}
                className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <form id="create-form" onSubmit={(e) => void handleCreate(e)}
              className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Customer Name <span className="text-red-500">*</span></label>
                <input required value={form.customer_name} onChange={(e) => formField("customer_name", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Customer full name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ticket Title <span className="text-red-500">*</span></label>
                <input required value={form.title} onChange={(e) => formField("title", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Trek FX3 — brake cable replacement" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea rows={3} value={form.description} onChange={(e) => formField("description", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Describe the issue and parts needed…" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Estimate ($)</label>
                  <input type="number" min="0" step="0.01" value={form.estimate_cents_str}
                    onChange={(e) => formField("estimate_cents_str", e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Assign To</label>
                  <input value={form.assigned_to_name} onChange={(e) => formField("assigned_to_name", e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Technician name" />
                </div>
              </div>
            </form>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form="create-form" disabled={saving}>
                {saving ? "Creating…" : "Create Ticket"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </EnterpriseShell>
  );
}
