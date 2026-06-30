"use client";

/**
 * FE-R1: Restaurant Floor Plan — table grid with real-time status.
 * Module-gated by module:tables.
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { apiGet, apiPost, apiPatch, safeLoad } from "@/api-client/client";
import { useRealtimeStream } from "@/hooks/useRealtimeStream";

interface TableSession {
  id: string;
  table_id: string;
  party_size: number;
  server_id: string | null;
  opened_at: number;
  notes: string | null;
}

interface RestaurantTable {
  id: string;
  table_number: string;
  capacity: number;
  floor_section: string | null;
  status: "available" | "occupied" | "reserved" | "cleaning";
  outlet_id: string | null;
  current_session: TableSession | null;
}

const STATUS_COLOR: Record<string, string> = {
  available: "bg-success-50 border-success-300 text-success-700",
  occupied:  "bg-red-50 border-red-300 text-red-700",
  reserved:  "bg-amber-50 border-amber-300 text-amber-700",
  cleaning:  "bg-slate-50 border-slate-300 text-slate-600",
};

const STATUS_DOT: Record<string, string> = {
  available: "bg-success-500",
  occupied:  "bg-red-500",
  reserved:  "bg-amber-500",
  cleaning:  "bg-slate-400",
};

function elapsed(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function FloorPlanPage() {
  const [tables, setTables]   = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RestaurantTable | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [partySize, setPartySize] = useState(2);
  const [processing, setProcessing] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const load = () => {
    safeLoad(
      apiGet<{ items: RestaurantTable[] }>("/api/v1/restaurant/tables")
        .then((d) => setTables(d.items ?? []))
        .finally(() => setLoading(false)),
    );
  };

  useEffect(() => { load(); }, []);

  // Real-time updates when a table status changes
  useRealtimeStream((e) => {
    if (e.type === "restaurant.table_status_changed") load();
  });

  const handleTableClick = (table: RestaurantTable) => {
    setSelected(table);
    setOpenModal(true);
  };

  const handleOpenSession = async () => {
    if (!selected) return;
    setProcessing(true);
    try {
      await apiPost(`/api/v1/restaurant/tables/${selected.id}/open-session`, { partySize });
      load();
      setOpenModal(false);
    } finally { setProcessing(false); }
  };

  const handleStatusChange = async (status: string) => {
    if (!selected) return;
    setProcessing(true);
    try {
      await apiPatch(`/api/v1/restaurant/tables/${selected.id}/status`, { status });
      load();
      setOpenModal(false);
    } finally { setProcessing(false); }
  };

  const sections = ["all", ...Array.from(new Set(tables.map((t) => t.floor_section ?? "Main").filter(Boolean)))];
  const visible = filter === "all" ? tables : tables.filter((t) => (t.floor_section ?? "Main") === filter);

  const counts = {
    available: tables.filter(t => t.status === "available").length,
    occupied:  tables.filter(t => t.status === "occupied").length,
    reserved:  tables.filter(t => t.status === "reserved").length,
  };

  return (
    <EnterpriseShell active="orders" title="Floor Plan" subtitle="Table status and session management">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">

        {/* Stats + section filter */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-4 text-sm">
            {[
              { label: "Available", count: counts.available, color: "text-success-600" },
              { label: "Occupied",  count: counts.occupied,  color: "text-red-600" },
              { label: "Reserved",  count: counts.reserved,  color: "text-amber-600" },
            ].map(({ label, count, color }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className={`text-lg font-bold ${color}`}>{count}</span>
                <span className="text-[var(--color-text-secondary)]">{label}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            {sections.map((s) => (
              <button key={s} type="button" onClick={() => setFilter(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  filter === s ? "bg-brand-600 text-white" : "bg-gray-100 text-[var(--color-text-secondary)] hover:bg-gray-200"
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Table grid */}
        {loading ? (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <Card>
            <p className="py-10 text-center text-sm text-[var(--color-text-secondary)]">
              No tables yet. Add tables in Setup → Restaurant.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {visible.map((table) => {
              const session = table.current_session;
              return (
                <button
                  key={table.id}
                  type="button"
                  onClick={() => handleTableClick(table)}
                  className={`group flex flex-col items-center justify-between rounded-xl border-2 p-3 text-center transition-all hover:shadow-md ${STATUS_COLOR[table.status]}`}
                >
                  {/* Status dot */}
                  <div className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[table.status]}`} />
                  {/* Table number */}
                  <div>
                    <p className="text-xl font-bold">{table.table_number}</p>
                    <p className="text-[11px] opacity-70">{table.capacity} seats</p>
                  </div>
                  {/* Status / elapsed */}
                  <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
                    {table.status === "occupied" && session
                      ? elapsed(session.opened_at)
                      : table.status}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Table action legend */}
        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-text-secondary)]">
          {Object.entries(STATUS_COLOR).map(([status]) => (
            <span key={status} className="flex items-center gap-1.5 capitalize">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
              {status}
            </span>
          ))}
        </div>
      </div>

      {/* Table action modal */}
      <Modal open={openModal} onClose={() => setOpenModal(false)} title={`Table ${selected?.table_number}`}>
        {selected && (
          <div className="space-y-4 p-4">
            <div className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${STATUS_DOT[selected.status]}`} />
              <span className="capitalize font-medium text-[var(--color-text-primary)]">{selected.status}</span>
              <span className="text-[var(--color-text-secondary)]">· {selected.capacity} seats</span>
              {selected.floor_section && (
                <span className="text-[var(--color-text-secondary)]">· {selected.floor_section}</span>
              )}
            </div>

            {selected.status === "available" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Party size</label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setPartySize(Math.max(1, partySize - 1))}
                      className="h-8 w-8 rounded-lg border border-slate-200 text-lg font-bold hover:bg-gray-50">−</button>
                    <span className="w-8 text-center text-lg font-bold">{partySize}</span>
                    <button type="button" onClick={() => setPartySize(Math.min(selected.capacity, partySize + 1))}
                      className="h-8 w-8 rounded-lg border border-slate-200 text-lg font-bold hover:bg-gray-50">+</button>
                  </div>
                </div>
                <Button variant="primary" fullWidth loading={processing} onClick={handleOpenSession}>
                  Open Session — {partySize} guests
                </Button>
              </div>
            )}

            {selected.status === "occupied" && (
              <div className="space-y-2">
                <Button variant="secondary" fullWidth loading={processing} onClick={() => handleStatusChange("cleaning")}>
                  Mark for Cleaning
                </Button>
                <Button variant="danger" fullWidth loading={processing} onClick={() => handleStatusChange("available")}>
                  Clear Table
                </Button>
              </div>
            )}

            {(selected.status === "reserved" || selected.status === "cleaning") && (
              <Button variant="primary" fullWidth loading={processing} onClick={() => handleStatusChange("available")}>
                Mark Available
              </Button>
            )}
          </div>
        )}
      </Modal>
    </EnterpriseShell>
  );
}
