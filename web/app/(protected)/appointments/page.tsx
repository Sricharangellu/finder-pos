"use client";

/**
 * FE-S1: Appointments calendar — week view with day-column layout.
 * Module-gated by module:appointments.
 */

import { useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { apiGet, apiPost, safeLoad } from "@/api-client/client";

interface Appointment {
  id: string;
  customer_id: string | null;
  employee_id: string | null;
  service: string;
  starts_at: number;
  ends_at: number;
  status: string;
  notes: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled:   "bg-blue-100 text-blue-800 border-blue-300",
  confirmed:   "bg-indigo-100 text-indigo-800 border-indigo-300",
  in_progress: "bg-amber-100 text-amber-800 border-amber-300",
  completed:   "bg-green-100 text-green-800 border-green-300",
  cancelled:   "bg-red-100 text-red-800 border-red-300",
  no_show:     "bg-gray-100 text-gray-500 border-gray-300",
};

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function AppointmentsPage() {
  const [date, setDate]         = useState(todayDateStr());
  const [items, setItems]       = useState<Appointment[]>([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState({
    service: "", startsAt: "", endsAt: "", notes: "",
  });

  const load = (d: string) => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: Appointment[] }>(`/api/v1/appointments?date=${d}`)
        .then(r => setItems(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  };

  useEffect(() => { load(date); }, [date]);

  // Group by hour for the day-column layout
  const byHour = useMemo(() => {
    const map: Record<number, Appointment[]> = {};
    items.forEach(a => {
      const h = new Date(a.starts_at).getHours();
      if (!map[h]) map[h] = [];
      map[h].push(a);
    });
    return map;
  }, [items]);

  const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 – 20:00

  const prevDay = () => {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    setDate(d.toISOString().slice(0, 10));
  };
  const nextDay = () => {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    setDate(d.toISOString().slice(0, 10));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const base = new Date(date + "T00:00:00");
      const [startH, startM] = form.startsAt.split(":").map(Number);
      const [endH, endM]     = form.endsAt.split(":").map(Number);
      const startsAt = new Date(base).setHours(startH ?? 9, startM ?? 0, 0, 0);
      const endsAt   = new Date(base).setHours(endH ?? 10, endM ?? 0, 0, 0);
      await apiPost("/api/v1/appointments", {
        service: form.service, startsAt, endsAt, notes: form.notes || undefined,
      });
      setModal(false);
      setForm({ service: "", startsAt: "", endsAt: "", notes: "" });
      load(date);
    } finally { setSaving(false); }
  };

  const displayDate = new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <EnterpriseShell active="appointments" title="Appointments" subtitle="Daily schedule view">
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5 sm:px-6">

        {/* Day navigator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={prevDay}
              className="rounded-lg border border-[var(--color-table-border)] p-2 hover:bg-gray-50">
              ‹
            </button>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{displayDate}</h2>
            <button type="button" onClick={nextDay}
              className="rounded-lg border border-[var(--color-table-border)] p-2 hover:bg-gray-50">
              ›
            </button>
            <button type="button" onClick={() => setDate(todayDateStr())}
              className="ml-1 rounded-lg border border-[var(--color-table-border)] px-3 py-1.5 text-xs hover:bg-gray-50">
              Today
            </button>
          </div>
          <Button variant="primary" size="sm" onClick={() => setModal(true)}>+ Appointment</Button>
        </div>

        {/* Day grid */}
        <Card noPadding>
          {loading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />)}
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-table-border)]">
              {HOURS.map(h => {
                const slots = byHour[h] ?? [];
                return (
                  <div key={h} className="flex min-h-[56px]">
                    <div className="w-16 shrink-0 py-3 pl-4 text-xs font-medium text-[var(--color-text-secondary)]">
                      {String(h).padStart(2, "0")}:00
                    </div>
                    <div className="flex flex-1 flex-wrap gap-2 border-l border-[var(--color-table-border)] p-2">
                      {slots.map(appt => (
                        <div key={appt.id}
                          className={`rounded-lg border px-3 py-1.5 text-xs ${STATUS_COLORS[appt.status] ?? "bg-gray-50 border-gray-200"}`}>
                          <p className="font-semibold leading-tight">{appt.service}</p>
                          <p className="mt-0.5 opacity-75">{fmtTime(appt.starts_at)} – {fmtTime(appt.ends_at)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Summary counts */}
        {!loading && (
          <p className="text-xs text-[var(--color-text-secondary)]">
            {items.length} appointment{items.length !== 1 ? "s" : ""} today
            {items.filter(a => a.status === "completed").length > 0 &&
              ` · ${items.filter(a => a.status === "completed").length} completed`}
          </p>
        )}
      </div>

      {/* New appointment modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="New Appointment">
        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Service *</label>
            <input type="text" value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))}
              placeholder="e.g. Haircut, Oil change, Consultation"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Start time *</label>
              <input type="time" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">End time *</label>
              <input type="time" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={saving}
              onClick={handleSave} disabled={!form.service || !form.startsAt || !form.endsAt}>
              Book
            </Button>
          </div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
