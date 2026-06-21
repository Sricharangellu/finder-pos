"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Button } from "@/components/Button";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/api-client/client";
import type { Employee, Shift, ShiftsResponse, TimeOffRequest, ShiftRole, TimeOffStatus } from "@/api-client/types";
import { clsx } from "clsx";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ROLE_COLORS: Record<ShiftRole, { bg: string; text: string; border: string }> = {
  manager:    { bg: "bg-purple-100",  text: "text-purple-800",  border: "border-purple-300" },
  supervisor: { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-300" },
  cashier:    { bg: "bg-blue-100",    text: "text-blue-800",    border: "border-blue-300" },
  stock:      { bg: "bg-amber-100",   text: "text-amber-800",   border: "border-amber-300" },
  delivery:   { bg: "bg-orange-100",  text: "text-orange-800",  border: "border-orange-300" },
};

const ROLE_LABELS: Record<ShiftRole, string> = {
  manager: "Manager", supervisor: "Supervisor", cashier: "Cashier",
  stock: "Stock", delivery: "Delivery",
};

const TO_STATUS_COLORS: Record<TimeOffStatus, string> = {
  pending:  "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  denied:   "bg-red-100 text-red-700",
};

// ─── Week helpers ─────────────────────────────────────────────────────────────

function mondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekDates(mon: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtWeekRange(mon: Date): string {
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return `${fmtDateShort(mon)} – ${fmtDateShort(sun)}`;
}

function isToday(d: Date): boolean {
  return isoDate(d) === isoDate(new Date());
}

// ─── Shift Modal ──────────────────────────────────────────────────────────────

interface ShiftModalProps {
  employees: Employee[];
  shift: Shift | null;       // null = new shift
  prefillDate?: string;
  prefillEmployee?: string;
  onClose: () => void;
  onSaved: (s: Shift) => void;
  onDeleted?: (id: string) => void;
}

function ShiftModal({ employees, shift, prefillDate, prefillEmployee, onClose, onSaved, onDeleted }: ShiftModalProps) {
  const [employeeId, setEmployeeId] = useState(shift?.employee_id ?? prefillEmployee ?? employees[0]?.id ?? "");
  const [date, setDate]             = useState(shift?.date       ?? prefillDate       ?? isoDate(new Date()));
  const [startTime, setStartTime]   = useState(shift?.start_time ?? "09:00");
  const [endTime, setEndTime]       = useState(shift?.end_time   ?? "17:00");
  const [notes, setNotes]           = useState(shift?.notes      ?? "");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId || !date) return;
    setSaving(true); setError(null);
    try {
      const payload = { employee_id: employeeId, date, start_time: startTime, end_time: endTime, notes: notes.trim() || null };
      const saved = shift
        ? await apiPatch<Shift>(`/workforce/shifts/${shift.id}`, payload)
        : await apiPost<Shift>("/workforce/shifts", payload);
      onSaved(saved);
    } catch {
      setError("Failed to save shift. Please try again.");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!shift || !onDeleted) return;
    setSaving(true);
    try {
      await apiDelete(`/workforce/shifts/${shift.id}`);
      onDeleted(shift.id);
    } catch {
      setError("Failed to delete shift.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">{shift ? "Edit Shift" : "Add Shift"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
        <form id="shift-form" onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Employee <span className="text-red-500">*</span></label>
            <select
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name} — {ROLE_LABELS[emp.role as ShiftRole]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional note…"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </form>
        <div className="px-6 pb-5 flex items-center justify-between">
          <div>
            {shift && onDeleted && (
              <Button variant="danger" onClick={handleDelete} disabled={saving} size="sm">
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" type="submit" form="shift-form" disabled={saving}>
              {saving ? "Saving…" : shift ? "Update" : "Add Shift"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Schedule Grid ────────────────────────────────────────────────────────────

interface GridProps {
  employees: Employee[];
  shifts: Shift[];
  dates: Date[];
  onCellClick: (date: string, employeeId: string) => void;
  onShiftClick: (shift: Shift) => void;
}

function ScheduleGrid({ employees, shifts, dates, onCellClick, onShiftClick }: GridProps) {
  function shiftsFor(empId: string, date: Date): Shift[] {
    const d = isoDate(date);
    return shifts.filter(s => s.employee_id === empId && s.date === d);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[900px]">
        <thead>
          <tr className="bg-slate-50">
            <th className="text-left px-4 py-3 text-sm font-semibold text-slate-600 border-b border-slate-200 w-40 sticky left-0 bg-slate-50 z-10">
              Employee
            </th>
            {dates.map((d, i) => (
              <th key={i} className={clsx(
                "text-center py-3 px-2 text-sm font-semibold border-b border-slate-200 min-w-[110px]",
                isToday(d) ? "bg-blue-50 text-blue-700" : "text-slate-600"
              )}>
                <div>{DAYS[i]}</div>
                <div className={clsx("text-xs font-normal mt-0.5", isToday(d) ? "text-blue-500" : "text-slate-400")}>
                  {fmtDateShort(d)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map(emp => (
            <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50/50 group">
              <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-slate-50/50 z-10 border-r border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: emp.avatar_color }}
                  >
                    {emp.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800 truncate max-w-[100px]">{emp.name}</p>
                    <p className="text-xs text-slate-400">{ROLE_LABELS[emp.role as ShiftRole]}</p>
                  </div>
                </div>
              </td>
              {dates.map((d, i) => {
                const dayShifts = shiftsFor(emp.id, d);
                return (
                  <td
                    key={i}
                    className={clsx(
                      "px-1.5 py-2 align-top cursor-pointer min-h-[60px]",
                      isToday(d) && "bg-blue-50/40"
                    )}
                    onClick={() => dayShifts.length === 0 && onCellClick(isoDate(d), emp.id)}
                  >
                    {dayShifts.length === 0 ? (
                      <div className="h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-slate-300 text-xl leading-none">+</span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {dayShifts.map(sh => {
                          const colors = ROLE_COLORS[sh.role as ShiftRole] ?? ROLE_COLORS.cashier;
                          return (
                            <button
                              key={sh.id}
                              onClick={e => { e.stopPropagation(); onShiftClick(sh); }}
                              className={clsx(
                                "w-full text-left rounded-md px-2 py-1 text-xs border transition-opacity hover:opacity-80",
                                colors.bg, colors.text, colors.border
                              )}
                            >
                              <div className="font-semibold truncate">{sh.start_time}–{sh.end_time}</div>
                              {sh.notes && <div className="truncate opacity-70">{sh.notes}</div>}
                            </button>
                          );
                        })}
                        <button
                          onClick={e => { e.stopPropagation(); onCellClick(isoDate(d), emp.id); }}
                          className="w-full text-center text-slate-300 hover:text-slate-500 text-lg leading-tight opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Time-off Panel ───────────────────────────────────────────────────────────

interface TimeOffPanelProps {
  requests: TimeOffRequest[];
  onUpdateStatus: (id: string, status: TimeOffStatus) => void;
}

function TimeOffPanel({ requests, onUpdateStatus }: TimeOffPanelProps) {
  const pending = requests.filter(r => r.status === "pending");
  const resolved = requests.filter(r => r.status !== "pending");

  function Row({ r }: { r: TimeOffRequest }) {
    return (
      <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800">{r.employee_name}</p>
          <p className="text-xs text-slate-500">
            {r.date_from === r.date_to ? r.date_from : `${r.date_from} → ${r.date_to}`}
            {r.reason && <span className="ml-2 text-slate-400">· {r.reason}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <span className={clsx("text-xs px-2 py-0.5 rounded-full font-medium", TO_STATUS_COLORS[r.status])}>
            {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
          </span>
          {r.status === "pending" && (
            <>
              <button
                onClick={() => onUpdateStatus(r.id, "approved")}
                className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Approve
              </button>
              <button
                onClick={() => onUpdateStatus(r.id, "denied")}
                className="text-xs px-2 py-1 rounded bg-slate-200 text-slate-700 hover:bg-slate-300"
              >
                Deny
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-800 mb-4">
        Time-Off Requests
        {pending.length > 0 && (
          <span className="ml-2 bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full">{pending.length} pending</span>
        )}
      </h3>
      {requests.length === 0 ? (
        <p className="text-sm text-slate-400">No time-off requests.</p>
      ) : (
        <div>
          {pending.map(r => <Row key={r.id} r={r} />)}
          {resolved.map(r => <Row key={r.id} r={r} />)}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkforcePage() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts]       = useState<Shift[]>([]);
  const [timeOff, setTimeOff]     = useState<TimeOffRequest[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState<Shift | null>(null);
  const [prefillDate, setPrefillDate]       = useState<string | undefined>();
  const [prefillEmployee, setPrefillEmployee] = useState<string | undefined>();

  const dates = weekDates(weekStart);
  const dateFrom = isoDate(dates[0]!);
  const dateTo   = isoDate(dates[6]!);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [empData, shiftData, toData] = await Promise.all([
        apiGet<{ items: Employee[] }>("/workforce/employees"),
        apiGet<ShiftsResponse>(`/workforce/shifts?date_from=${dateFrom}&date_to=${dateTo}`),
        apiGet<{ items: TimeOffRequest[] }>("/workforce/time-off"),
      ]);
      setEmployees(empData.items);
      setShifts(shiftData.items);
      setTimeOff(toData.items);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  function openNew(date: string, empId: string) {
    setPrefillDate(date);
    setPrefillEmployee(empId);
    setEditing(null);
    setShowModal(true);
  }

  function openEdit(sh: Shift) {
    setEditing(sh);
    setPrefillDate(undefined);
    setPrefillEmployee(undefined);
    setShowModal(true);
  }

  function handleSaved(sh: Shift) {
    setShifts(prev => {
      const idx = prev.findIndex(s => s.id === sh.id);
      return idx === -1 ? [...prev, sh] : prev.map(s => s.id === sh.id ? sh : s);
    });
    setShowModal(false);
  }

  function handleDeleted(id: string) {
    setShifts(prev => prev.filter(s => s.id !== id));
    setShowModal(false);
  }

  async function handleTimeOffStatus(id: string, status: TimeOffStatus) {
    try {
      const updated = await apiPatch<TimeOffRequest>(`/workforce/time-off/${id}`, { status });
      setTimeOff(prev => prev.map(r => r.id === id ? updated : r));
    } catch { /* ignore */ }
  }

  function prevWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  }

  function nextWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  }

  function goToday() {
    setWeekStart(mondayOf(new Date()));
  }

  const totalHours = shifts.reduce((sum, s) => {
    const [sh, sm] = s.start_time.split(":").map(Number);
    const [eh, em] = s.end_time.split(":").map(Number);
    return sum + ((eh! * 60 + em!) - (sh! * 60 + sm!)) / 60;
  }, 0);

  const pendingCount = timeOff.filter(r => r.status === "pending").length;

  return (
    <EnterpriseShell
      active="workforce"
      title="Workforce"
      subtitle="Employee scheduling and time-off management"
    >
      <div className="p-6 space-y-5">

        {/* Stat row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Employees",       value: employees.length,           color: "border-slate-300" },
            { label: "Shifts This Week", value: shifts.length,              color: "border-blue-400" },
            { label: "Hours Scheduled",  value: `${totalHours.toFixed(0)}h`, color: "border-emerald-400" },
            { label: "Pending Requests", value: pendingCount,               color: "border-amber-400" },
          ].map(c => (
            <div key={c.label} className={clsx("bg-white rounded-xl border-l-4 p-4 shadow-sm", c.color)}>
              <p className="text-xs text-slate-500 uppercase tracking-wide">{c.label}</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{c.value}</p>
            </div>
          ))}
        </div>

        {/* Schedule grid card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <button
                onClick={prevWeek}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-500 transition-colors"
                aria-label="Previous week"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="text-sm font-semibold text-slate-800 min-w-[180px] text-center">
                {fmtWeekRange(weekStart)}
              </span>
              <button
                onClick={nextWeek}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-500 transition-colors"
                aria-label="Next week"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <button
                onClick={goToday}
                className="ml-1 text-xs px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Today
              </button>
            </div>

            {/* Role legend */}
            <div className="hidden sm:flex items-center gap-3 text-xs">
              {(Object.keys(ROLE_COLORS) as ShiftRole[]).map(r => (
                <span key={r} className={clsx("px-2 py-0.5 rounded font-medium", ROLE_COLORS[r].bg, ROLE_COLORS[r].text)}>
                  {ROLE_LABELS[r]}
                </span>
              ))}
            </div>

            <Button variant="primary" size="sm" onClick={() => { setEditing(null); setPrefillDate(isoDate(new Date())); setPrefillEmployee(employees[0]?.id); setShowModal(true); }}>
              + Add Shift
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-60 text-slate-400 text-sm">Loading schedule…</div>
          ) : (
            <ScheduleGrid
              employees={employees}
              shifts={shifts}
              dates={dates}
              onCellClick={openNew}
              onShiftClick={openEdit}
            />
          )}
        </div>

        {/* Time-off requests */}
        <TimeOffPanel requests={timeOff} onUpdateStatus={handleTimeOffStatus} />
      </div>

      {showModal && (
        <ShiftModal
          employees={employees}
          shift={editing}
          prefillDate={prefillDate}
          prefillEmployee={prefillEmployee}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
          onDeleted={editing ? handleDeleted : undefined}
        />
      )}
    </EnterpriseShell>
  );
}
