"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { AppointmentStatus, Appointment, AppointmentsResponse, ServiceCatalogItem, ServiceCatalogResponse } from "@/api-client/types";
import { clsx } from "clsx";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STATUS_BADGE: Record<AppointmentStatus, BadgeVariant> = {
  scheduled:   "blue",
  confirmed:   "green",
  in_progress: "yellow",
  completed:   "gray",
  cancelled:   "red",
  no_show:     "red",
};

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled:   "Scheduled",
  confirmed:   "Confirmed",
  in_progress: "In Progress",
  completed:   "Completed",
  cancelled:   "Cancelled",
  no_show:     "No Show",
};

const ALL_STATUSES: AppointmentStatus[] = ["scheduled", "confirmed", "in_progress", "completed", "cancelled", "no_show"];

interface BookForm {
  serviceId: string;
  customerName: string;
  startAt: string;
  notes: string;
}

const EMPTY_FORM: BookForm = { serviceId: "", customerName: "", startAt: "", notes: "" };

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "all">("all");
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [showBook, setShowBook] = useState(false);
  const [form, setForm] = useState<BookForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [apptData, svcData] = await Promise.all([
        apiGet<AppointmentsResponse>("/api/v1/appointments"),
        apiGet<ServiceCatalogResponse>("/api/v1/appointments/services"),
      ]);
      setAppointments(apptData.items ?? []);
      setServices(svcData.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = statusFilter === "all" ? appointments : appointments.filter(a => a.status === statusFilter);
  const counts = ALL_STATUSES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = appointments.filter(r => r.status === s).length; return acc;
  }, {});

  async function book() {
    if (!form.serviceId || !form.customerName.trim() || !form.startAt) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/appointments", {
        serviceId: form.serviceId,
        customerName: form.customerName.trim(),
        startAt: new Date(form.startAt).getTime(),
        notes: form.notes.trim() || undefined,
      });
      setShowBook(false); setForm(EMPTY_FORM); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  async function updateStatus(id: string, status: AppointmentStatus) {
    try {
      await apiPatch(`/api/v1/appointments/${id}/status`, { status });
      setSelected(null); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  function formatDt(ts: number) {
    return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  const activeStatuses: AppointmentStatus[] = ["scheduled", "confirmed", "in_progress"];
  const doneStatuses: AppointmentStatus[] = ["completed", "cancelled", "no_show"];

  return (
    <EnterpriseShell active="appointments" title="Appointments" subtitle="Service bookings & scheduling">
      <div className="flex flex-col gap-6 p-6">
        {/* Stat row */}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {ALL_STATUSES.map(s => (
            <Card key={s} className={clsx("p-3 cursor-pointer hover:shadow-md transition-shadow", statusFilter === s && "ring-2 ring-brand-500")}
              onClick={() => setStatusFilter(f => f === s ? "all" : s)}>
              <p className="text-xs text-[rgba(0,0,0,0.45)] truncate">{STATUS_LABEL[s]}</p>
              <p className="mt-0.5 text-xl font-bold">{counts[s] ?? 0}</p>
            </Card>
          ))}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowBook(true)}>+ Book Appointment</Button>
        </div>

        {loading && <TableSkeleton rows={5} cols={5} />}
        {error && <p className="text-red-600 text-sm py-4">{error}</p>}

        {!loading && (
          <div className="overflow-hidden rounded-lg border border-[#E8E8E8] bg-white">
            {visible.length === 0 ? (
              <div className="p-12 text-center text-sm text-[rgba(0,0,0,0.45)]">
                No appointments found.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Service</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Date & Time</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(appt => (
                    <tr key={appt.id} className="border-b border-[#F0F0F0] cursor-pointer hover:bg-[#FAFAFA]" onClick={() => setSelected(appt)}>
                      <td className="px-4 py-3 font-medium text-[rgba(0,0,0,0.88)]">{appt.customer_name ?? "Walk-in"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{appt.service_name ?? "—"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{formatDt(appt.starts_at)}</td>
                      <td className="px-4 py-3"><Badge variant={STATUS_BADGE[appt.status]} size="sm">{STATUS_LABEL[appt.status]}</Badge></td>
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
                  <h3 className="text-lg font-bold">{selected.customer_name ?? "Walk-in"}</h3>
                  <p className="text-xs text-[rgba(0,0,0,0.45)]">{selected.service_name ?? "No service"}</p>
                  <p className="text-xs text-[rgba(0,0,0,0.45)]">{formatDt(selected.starts_at)}</p>
                </div>
                <Badge variant={STATUS_BADGE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
              </div>
              {selected.notes && <p className="mb-4 text-sm text-[rgba(0,0,0,0.65)] bg-[#FAFAFA] rounded p-2">{selected.notes}</p>}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Update Status</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[...activeStatuses, ...doneStatuses].filter(s => s !== selected.status).map(s => (
                    <button key={s} type="button" onClick={() => void updateStatus(selected.id, s)}
                      className="rounded border border-[#D9D9D9] px-3 py-1.5 text-xs text-[rgba(0,0,0,0.65)] hover:bg-[#F5F5F5]">
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="mt-4 w-full rounded border border-[#D9D9D9] py-1.5 text-xs text-[rgba(0,0,0,0.45)] hover:bg-[#F5F5F5]">Close</button>
            </div>
          </div>
        )}

        {/* Book modal */}
        {showBook && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBook(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Book Appointment</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Service *</label>
                  <select value={form.serviceId} onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" autoFocus>
                    <option value="">Select a service…</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name} — {formatMoney(s.price_cents)} ({s.duration_mins} min)</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Customer Name *</label>
                  <input type="text" placeholder="Jane Smith…" value={form.customerName}
                    onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Date & Time *</label>
                  <input type="datetime-local" value={form.startAt}
                    onChange={e => setForm(f => ({ ...f, startAt: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Notes</label>
                  <input type="text" placeholder="Special requests…" value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowBook(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void book()} loading={saving}>Book</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
