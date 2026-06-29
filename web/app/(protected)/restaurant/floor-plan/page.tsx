"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, apiPatch } from "@/api-client/client";
import type { RestaurantTable, TableStatus, RestaurantTablesResponse, TableSession } from "@/api-client/types";
import { clsx } from "clsx";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STATUS_BADGE: Record<TableStatus, BadgeVariant> = {
  available: "green",
  occupied:  "blue",
  reserved:  "yellow",
  cleaning:  "gray",
};

const STATUS_LABEL: Record<TableStatus, string> = {
  available: "Available",
  occupied:  "Occupied",
  reserved:  "Reserved",
  cleaning:  "Cleaning",
};

const ALL_STATUSES: TableStatus[] = ["available", "occupied", "reserved", "cleaning"];

interface CreateTableForm {
  tableNumber: string;
  capacity: string;
  floorSection: string;
}

const EMPTY_FORM: CreateTableForm = { tableNumber: "", capacity: "4", floorSection: "" };

interface OpenSessionForm {
  partySize: string;
  notes: string;
}

export default function FloorPlanPage() {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TableStatus | "all">("all");
  const [selected, setSelected] = useState<RestaurantTable | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateTableForm>(EMPTY_FORM);
  const [sessionForm, setSessionForm] = useState<OpenSessionForm>({ partySize: "2", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<RestaurantTablesResponse>("/api/v1/restaurant/tables");
      setTables(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tables");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = statusFilter === "all" ? tables : tables.filter(t => t.status === statusFilter);

  const sections = [...new Set(tables.map(t => t.floor_section ?? "Main Floor"))].sort();

  const counts = ALL_STATUSES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = tables.filter(t => t.status === s).length;
    return acc;
  }, {});

  async function createTable() {
    if (!form.tableNumber.trim()) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/restaurant/tables", {
        tableNumber: form.tableNumber.trim(),
        capacity: parseInt(form.capacity) || 4,
        floorSection: form.floorSection.trim() || undefined,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create table");
    } finally {
      setSaving(false);
    }
  }

  async function openSession() {
    if (!selected) return;
    setSaving(true);
    try {
      await apiPost(`/api/v1/restaurant/tables/${selected.id}/open-session`, {
        partySize: parseInt(sessionForm.partySize) || 1,
        notes: sessionForm.notes.trim() || undefined,
      });
      setSelected(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to open session");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(tableId: string, status: TableStatus) {
    try {
      await apiPatch(`/api/v1/restaurant/tables/${tableId}/status`, { status });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update status");
    }
  }

  return (
    <EnterpriseShell active="restaurant-floor-plan" title="Floor Plan" subtitle="Table layout & session management">
      <div className="flex flex-col gap-6 p-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ALL_STATUSES.map(s => (
            <Card key={s} className="p-4">
              <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">{STATUS_LABEL[s]}</p>
              <p className="mt-1 text-2xl font-bold text-[rgba(0,0,0,0.88)]">{counts[s] ?? 0}</p>
            </Card>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded border border-[#D9D9D9] bg-white p-0.5">
            {(["all", ...ALL_STATUSES] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={clsx(
                  "rounded px-3 py-1 text-xs font-medium transition-colors",
                  statusFilter === s
                    ? "bg-brand-600 text-white"
                    : "text-[rgba(0,0,0,0.65)] hover:bg-[#F5F5F5]",
                )}
              >
                {s === "all" ? "All" : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>+ Add Table</Button>
        </div>

        {loading && <p className="text-center text-sm text-[rgba(0,0,0,0.45)] py-12">Loading tables…</p>}
        {error && <p className="text-center text-sm text-red-600 py-12">{error}</p>}

        {/* Table grid by section */}
        {!loading && sections.map(section => {
          const sectionTables = visible.filter(t => (t.floor_section ?? "Main Floor") === section);
          if (sectionTables.length === 0) return null;
          return (
            <div key={section}>
              <h3 className="mb-3 text-sm font-semibold text-[rgba(0,0,0,0.65)] uppercase tracking-wide">{section}</h3>
              <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {sectionTables.map(table => (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => setSelected(table)}
                    className={clsx(
                      "rounded-lg border-2 p-4 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500",
                      table.status === "available" && "border-emerald-300 bg-emerald-50",
                      table.status === "occupied"  && "border-blue-300 bg-blue-50",
                      table.status === "reserved"  && "border-amber-300 bg-amber-50",
                      table.status === "cleaning"  && "border-gray-200 bg-gray-50",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-[rgba(0,0,0,0.88)]">T{table.table_number}</span>
                      <Badge variant={STATUS_BADGE[table.status]} size="sm">{STATUS_LABEL[table.status]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-[rgba(0,0,0,0.45)]">{table.capacity} seats</p>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {!loading && visible.length === 0 && (
          <div className="rounded-lg border-2 border-dashed border-[#D9D9D9] p-12 text-center">
            <p className="text-sm text-[rgba(0,0,0,0.45)]">No tables yet. Add your first table to get started.</p>
            <Button size="sm" className="mt-3" onClick={() => setShowCreate(true)}>+ Add Table</Button>
          </div>
        )}

        {/* Table detail / session modal */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">Table {selected.table_number}</h3>
                  <p className="text-xs text-[rgba(0,0,0,0.45)]">{selected.capacity} seats · {selected.floor_section ?? "Main Floor"}</p>
                </div>
                <Badge variant={STATUS_BADGE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
              </div>

              {selected.status === "available" && (
                <div className="space-y-3 mb-4">
                  <h4 className="text-sm font-semibold text-[rgba(0,0,0,0.65)]">Open Session</h4>
                  <div>
                    <label className="block text-xs font-medium text-[rgba(0,0,0,0.65)] mb-1">Party Size</label>
                    <input
                      type="number" min="1" max="100"
                      value={sessionForm.partySize}
                      onChange={e => setSessionForm(f => ({ ...f, partySize: e.target.value }))}
                      className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[rgba(0,0,0,0.65)] mb-1">Notes (optional)</label>
                    <input
                      type="text" placeholder="Special requests…"
                      value={sessionForm.notes}
                      onChange={e => setSessionForm(f => ({ ...f, notes: e.target.value }))}
                      className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm"
                    />
                  </div>
                  <Button className="w-full" onClick={() => void openSession()} loading={saving}>Open Session</Button>
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Change Status</h4>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_STATUSES.filter(s => s !== selected.status).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { void setStatus(selected.id, s); setSelected(null); }}
                      className="rounded border border-[#D9D9D9] px-3 py-1.5 text-xs text-[rgba(0,0,0,0.65)] hover:bg-[#F5F5F5] transition-colors"
                    >
                      Set {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mt-4 w-full rounded border border-[#D9D9D9] py-1.5 text-xs text-[rgba(0,0,0,0.45)] hover:bg-[#F5F5F5]"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Create table modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Add Table</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[rgba(0,0,0,0.65)] mb-1">Table Number *</label>
                  <input
                    type="text" placeholder="1, 2, A1…"
                    value={form.tableNumber}
                    onChange={e => setForm(f => ({ ...f, tableNumber: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[rgba(0,0,0,0.65)] mb-1">Capacity</label>
                  <input
                    type="number" min="1" max="100"
                    value={form.capacity}
                    onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[rgba(0,0,0,0.65)] mb-1">Floor Section</label>
                  <input
                    type="text" placeholder="Main Floor, Patio, Bar…"
                    value={form.floorSection}
                    onChange={e => setForm(f => ({ ...f, floorSection: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void createTable()} loading={saving}>Create</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
