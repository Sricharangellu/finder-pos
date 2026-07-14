"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, ApiResponseError } from "@/api-client/client";
import { fmtDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { FieldInput, FieldSelect } from "./TeamFormFields";
import {
  ROLES, ROLE_LABELS, ROLE_COLORS, AVATAR_COLORS, DEPT_OPTIONS, EMPLOYMENT_LABELS,
  initials, formatHours, elapsedMins, fmtTime, fmtInputDate,
  type Employee, type TimeEntry, type RoleId, type AccountStatus, type EmploymentType, type ModalTab,
} from "./teamTypes";

interface Props {
  employee: Employee;
  onClose: () => void;
  onUpdated: () => void;
}

export function EmployeeModal({ employee, onClose, onUpdated }: Props) {
  const [tab, setTab] = useState<ModalTab>("profile");
  const [profile, setProfile] = useState({
    name: employee.name,
    email: employee.email,
    phone: employee.phone ?? "",
    department: employee.department ?? "",
    employment_type: employee.employment_type,
    hourly_rate: employee.hourly_rate_cents ? String(employee.hourly_rate_cents / 100) : "",
    pin: employee.pin ?? "",
  });
  const [role, setRole] = useState<RoleId>(employee.role);
  const [status, setStatus] = useState<AccountStatus>(employee.status);
  const [suspendReason, setSuspendReason] = useState(employee.suspend_reason ?? "");
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [clockingIn, setClockingIn] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isClockedIn, setIsClockedIn] = useState(employee.clocked_in);
  const [clockedInAt, setClockedInAt] = useState(employee.clocked_in_at);
  const [todayMins, setTodayMins] = useState(employee.today_minutes);

  useEffect(() => {
    if (tab !== "timeclock") return;
    setEntriesLoading(true);
    apiGet<{ items: TimeEntry[] }>(`/api/v1/team/${employee.id}/time-entries`)
      .then((r) => setTimeEntries(r.items))
      .catch(() => {})
      .finally(() => setEntriesLoading(false));
  }, [tab, employee.id]);

  const handleSave = async () => {
    setSaving(true); setSaveError(null);
    try {
      await apiPatch(`/api/v1/team/${employee.id}`, {
        name: profile.name.trim(),
        email: profile.email.trim(),
        phone: profile.phone.trim() || null,
        department: profile.department || null,
        employment_type: profile.employment_type,
        hourly_rate_cents: profile.hourly_rate ? Math.round(parseFloat(profile.hourly_rate) * 100) : null,
        pin: profile.pin || null,
        role,
        status,
        suspend_reason: status !== "active" ? suspendReason : null,
      });
      onUpdated();
      onClose();
    } catch (e) {
      setSaveError(e instanceof ApiResponseError ? e.message : "Save failed.");
    } finally { setSaving(false); }
  };

  const clockIn = async () => {
    setClockingIn(true);
    try {
      await apiPost(`/api/v1/team/${employee.id}/clock-in`, {});
      setIsClockedIn(true); setClockedInAt(Date.now());
    } catch {} finally { setClockingIn(false); }
  };

  const clockOut = async () => {
    setClockingOut(true);
    try {
      const r = await apiPost<{ today_minutes: number }>(`/api/v1/team/${employee.id}/clock-out`, {});
      setIsClockedIn(false); setClockedInAt(null);
      setTodayMins(r.today_minutes);
      setTimeEntries([]);
      setTab("timeclock");
    } catch {} finally { setClockingOut(false); }
  };

  const tabs: { key: ModalTab; label: string }[] = [
    { key: "profile",   label: "Profile" },
    { key: "timeclock", label: "Time Clock" },
    { key: "account",   label: "Account" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${AVATAR_COLORS[employee.role]}`}>
            {initials(employee.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-[#111]">{employee.name}</p>
            <p className="truncate text-xs text-slate-400">{employee.email}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab nav */}
        <div className="flex shrink-0 border-b border-slate-100 px-5">
          {tabs.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`mr-4 border-b-2 py-2.5 text-sm font-medium transition-colors ${tab === key ? "border-brand-600 text-brand-600" : "border-transparent text-slate-500 hover:text-[#111]"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Profile tab */}
          {tab === "profile" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldInput label="Full Name" value={profile.name} onChange={(v) => setProfile((p) => ({ ...p, name: v }))} />
              <FieldInput label="Email" type="email" value={profile.email} onChange={(v) => setProfile((p) => ({ ...p, email: v }))} />
              <FieldInput label="Phone" type="tel" value={profile.phone} onChange={(v) => setProfile((p) => ({ ...p, phone: v }))} placeholder="555-0100" />
              <FieldSelect label="Department" value={profile.department} onChange={(v) => setProfile((p) => ({ ...p, department: v }))}>
                <option value="">— None —</option>
                {DEPT_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </FieldSelect>
              <FieldSelect label="Employment Type" value={profile.employment_type} onChange={(v) => setProfile((p) => ({ ...p, employment_type: v as EmploymentType }))}>
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="contractor">Contractor</option>
              </FieldSelect>
              <FieldInput label="Hourly Rate ($)" type="number" value={profile.hourly_rate} onChange={(v) => setProfile((p) => ({ ...p, hourly_rate: v }))} placeholder="18.00" />
              <FieldInput label="Hire Date" type="date" value={fmtInputDate(employee.hire_date)} readOnly />
              <FieldInput
                label="Clock-in PIN" type="password" inputMode="numeric" maxLength={6}
                value={profile.pin} onChange={(v) => setProfile((p) => ({ ...p, pin: v.replace(/\D/g, "") }))}
                placeholder="4–6 digits"
              />
            </div>
          )}

          {/* Time Clock tab */}
          {tab === "timeclock" && (
            <div className="space-y-4">
              <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${isClockedIn ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                <div>
                  <p className={`text-sm font-semibold ${isClockedIn ? "text-emerald-700" : "text-slate-600"}`}>
                    {isClockedIn ? "Currently Clocked IN" : "Currently Off"}
                  </p>
                  {isClockedIn && clockedInAt && (
                    <p className="text-xs text-emerald-600">
                      Since {fmtTime(clockedInAt)} · {formatHours(elapsedMins(clockedInAt))} elapsed
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    Today total: <span className="font-semibold">
                      {formatHours(isClockedIn && clockedInAt ? todayMins + elapsedMins(clockedInAt) : todayMins)}
                    </span>
                  </p>
                </div>
                <div>
                  {isClockedIn ? (
                    <button type="button" onClick={() => void clockOut()} disabled={clockingOut}
                      className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40">
                      {clockingOut ? "…" : "Clock Out"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void clockIn()} disabled={clockingIn}
                      className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40">
                      {clockingIn ? "…" : "Clock In"}
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-4 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Today's Punches</p>
                </div>
                {entriesLoading ? (
                  <div className="space-y-2 px-4 py-3">
                    {[1, 2].map((i) => <div key={i} className="h-7 animate-pulse rounded bg-slate-100" />)}
                  </div>
                ) : timeEntries.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">No time entries recorded today.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        <th className="px-4 pb-2 pt-2.5">Clock In</th>
                        <th className="px-4 pb-2 pt-2.5">Clock Out</th>
                        <th className="px-4 pb-2 pt-2.5 text-right">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {timeEntries.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-mono text-xs text-[#111]">{fmtTime(e.clock_in)}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                            {e.clock_out ? fmtTime(e.clock_out) : <span className="text-emerald-600">In progress</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs font-semibold text-[#111]">
                            {e.duration_mins != null ? formatHours(e.duration_mins) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Account tab */}
          {tab === "account" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-400">Role</label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {ROLES.map((r) => (
                    <button key={r} type="button" onClick={() => setRole(r)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${role === r ? "border-brand-600 bg-brand-600/5 text-brand-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      <span className={`h-2 w-2 rounded-full ${ROLE_COLORS[r].split(" ")[0]}`} />
                      {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-400">Account Status</label>
                <div className="flex gap-2">
                  {(["active", "suspended", "terminated"] as AccountStatus[]).map((s) => {
                    const styles = {
                      active:     "border-emerald-300 bg-emerald-50 text-emerald-700",
                      suspended:  "border-amber-300 bg-amber-50 text-amber-700",
                      terminated: "border-red-300 bg-red-50 text-red-700",
                    };
                    return (
                      <button key={s} type="button" onClick={() => setStatus(s)}
                        className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold capitalize transition-colors ${status === s ? styles[s] : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                        {s}
                      </button>
                    );
                  })}
                </div>
                {status !== "active" && (
                  <textarea
                    rows={2}
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    placeholder={status === "suspended" ? "Reason for suspension…" : "Reason for termination…"}
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
                  />
                )}
              </div>

              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Hired</span>
                  <span className="font-medium text-slate-700">{fmtDate(employee.hire_date)}</span>
                </div>
                <div className="mt-1.5 flex justify-between">
                  <span>Employment</span>
                  <span className="font-medium text-slate-700">{EMPLOYMENT_LABELS[employee.employment_type]}</span>
                </div>
                {employee.hourly_rate_cents && (
                  <div className="mt-1.5 flex justify-between">
                    <span>Rate</span>
                    <span className="font-medium text-slate-700">{formatMoney(employee.hourly_rate_cents)} / hr</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {saveError && (
          <p role="alert" className="shrink-0 border-t border-red-100 bg-red-50 px-5 py-2 text-xs text-red-600">
            {saveError}
          </p>
        )}
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={saving}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
