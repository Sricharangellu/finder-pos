"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { fmtDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

// ── Types ─────────────────────────────────────────────────────────────────────

type RoleId =
  | "owner" | "admin" | "manager" | "sales" | "cashier"
  | "accountant" | "receiver" | "shipper" | "driver" | "warehouse";

type AccountStatus = "active" | "suspended" | "terminated";
type EmploymentType = "full_time" | "part_time" | "contractor";
type ModalTab = "profile" | "timeclock" | "account";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: RoleId;
  department: string | null;
  employment_type: EmploymentType;
  hourly_rate_cents: number | null;
  status: AccountStatus;
  suspend_reason: string | null;
  pin: string | null;
  hire_date: number;
  clocked_in: boolean;
  clocked_in_at: number | null;
  today_minutes: number;
}

interface TimeEntry {
  id: string;
  clock_in: number;
  clock_out: number | null;
  duration_mins: number | null;
  notes: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLES: RoleId[] = [
  "owner", "admin", "manager", "sales", "cashier",
  "accountant", "receiver", "shipper", "driver", "warehouse",
];

const ROLE_LABELS: Record<RoleId, string> = {
  owner: "Owner", admin: "Admin", manager: "Manager", sales: "Sales",
  cashier: "Cashier", accountant: "Accountant", receiver: "Receiver",
  shipper: "Shipper", driver: "Driver", warehouse: "Warehouse",
};

const ROLE_COLORS: Record<RoleId, string> = {
  owner:      "bg-violet-100 text-violet-700",
  admin:      "bg-indigo-100 text-indigo-700",
  manager:    "bg-blue-100 text-blue-700",
  sales:      "bg-emerald-100 text-emerald-700",
  cashier:    "bg-cyan-100 text-cyan-700",
  accountant: "bg-amber-100 text-amber-700",
  receiver:   "bg-orange-100 text-orange-700",
  shipper:    "bg-sky-100 text-sky-700",
  driver:     "bg-teal-100 text-teal-700",
  warehouse:  "bg-slate-100 text-slate-600",
};

const AVATAR_COLORS: Record<RoleId, string> = {
  owner:      "bg-violet-600 text-white",
  admin:      "bg-indigo-600 text-white",
  manager:    "bg-blue-600 text-white",
  sales:      "bg-emerald-600 text-white",
  cashier:    "bg-cyan-600 text-white",
  accountant: "bg-amber-600 text-white",
  receiver:   "bg-orange-600 text-white",
  shipper:    "bg-sky-600 text-white",
  driver:     "bg-teal-600 text-white",
  warehouse:  "bg-slate-600 text-white",
};

const DEPT_OPTIONS = [
  "Operations", "Front End", "Back Office", "Finance", "Warehouse",
  "Delivery", "IT", "Sales", "Customer Service", "Management",
];

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time", part_time: "Part-time", contractor: "Contractor",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(" ");
  return parts.length >= 2
    ? (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function formatHours(minutes: number): string {
  if (minutes === 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function elapsedMins(since: number): number {
  return Math.floor((Date.now() - since) / 60_000);
}

function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ts));
}

// ── Badges ────────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: RoleId }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${ROLE_COLORS[role]}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

function StatusBadge({ status }: { status: AccountStatus }) {
  const styles: Record<AccountStatus, string> = {
    active:     "bg-emerald-100 text-emerald-700",
    suspended:  "bg-amber-100 text-amber-700",
    terminated: "bg-red-100 text-red-600",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ── Add Employee Modal ────────────────────────────────────────────────────────

function AddEmployeeModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    name: "", email: "", phone: "", role: "cashier" as RoleId,
    department: "", employment_type: "full_time" as EmploymentType,
    hourly_rate: "", pin: "", hire_date: new Date().toISOString().split("T")[0] ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setSaving(true); setError(null);
    try {
      await apiPost("/api/v1/team", {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        role: form.role,
        department: form.department || null,
        employment_type: form.employment_type,
        hourly_rate_cents: form.hourly_rate ? Math.round(parseFloat(form.hourly_rate) * 100) : null,
        pin: form.pin || null,
        hire_date: form.hire_date ? new Date(form.hire_date).getTime() : Date.now(),
      });
      onAdded();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to add employee.");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-[#111]">Add Employee</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldInput label="Full Name *" value={form.name} onChange={(v) => set("name", v)} placeholder="Jane Smith" />
            <FieldInput label="Email *" type="email" value={form.email} onChange={(v) => set("email", v)} placeholder="jane@company.com" />
            <FieldInput label="Phone" type="tel" value={form.phone} onChange={(v) => set("phone", v)} placeholder="555-0100" />
            <FieldSelect label="Role" value={form.role} onChange={(v) => set("role", v)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </FieldSelect>
            <FieldSelect label="Department" value={form.department} onChange={(v) => set("department", v)}>
              <option value="">— None —</option>
              {DEPT_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </FieldSelect>
            <FieldSelect label="Employment Type" value={form.employment_type} onChange={(v) => set("employment_type", v)}>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contractor">Contractor</option>
            </FieldSelect>
            <FieldInput label="Hourly Rate ($)" type="number" value={form.hourly_rate} onChange={(v) => set("hourly_rate", v)} placeholder="18.00" />
            <FieldInput label="Hire Date" type="date" value={form.hire_date} onChange={(v) => set("hire_date", v)} />
            <FieldInput label="Clock-in PIN" type="password" inputMode="numeric" maxLength={6} value={form.pin} onChange={(v) => set("pin", v.replace(/\D/g, ""))} placeholder="4–6 digits" />
          </div>
          <p className="mt-2 text-xs text-slate-400">PIN is used by the employee to clock in and out at the terminal.</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSubmit()} disabled={saving}
            className="rounded-lg bg-[#5D5FEF] px-5 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40">
            {saving ? "Adding…" : "Add Employee"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Employee Detail Modal ─────────────────────────────────────────────────────

function EmployeeModal({
  employee,
  onClose,
  onUpdated,
}: {
  employee: Employee;
  onClose: () => void;
  onUpdated: () => void;
}) {
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
      setTimeEntries([]); // reload
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
      <div className="flex w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl" style={{ maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>

        {/* Modal header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${AVATAR_COLORS[employee.role]}`}>
            {initials(employee.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate font-semibold text-[#111]">{employee.name}</p>
            <p className="truncate text-xs text-slate-400">{employee.email}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Tab nav */}
        <div className="flex shrink-0 border-b border-slate-100 px-5">
          {tabs.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`mr-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${tab === key ? "border-[#5D5FEF] text-[#5D5FEF]" : "border-transparent text-slate-500 hover:text-[#111]"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ── Profile tab ─────────────────────────────────────────── */}
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
                label="Clock-in PIN"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={profile.pin}
                onChange={(v) => setProfile((p) => ({ ...p, pin: v.replace(/\D/g, "") }))}
                placeholder="4–6 digits"
              />
            </div>
          )}

          {/* ── Time Clock tab ──────────────────────────────────────── */}
          {tab === "timeclock" && (
            <div className="space-y-4">
              {/* Current status */}
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
                    Today total: <span className="font-semibold">{formatHours(isClockedIn && clockedInAt ? todayMins + elapsedMins(clockedInAt) : todayMins)}</span>
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

              {/* Today's entries */}
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

          {/* ── Account tab ─────────────────────────────────────────── */}
          {tab === "account" && (
            <div className="space-y-4">
              {/* Role */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Role</label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {ROLES.map((r) => (
                    <button key={r} type="button" onClick={() => setRole(r)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${role === r ? "border-[#5D5FEF] bg-[#5D5FEF]/5 text-[#5D5FEF]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      <span className={`h-2 w-2 rounded-full ${ROLE_COLORS[r].split(" ")[0]}`} />
                      {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Account status */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Account Status</label>
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
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#5D5FEF] focus:outline-none"
                  />
                )}
              </div>

              {/* Meta info */}
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
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={saving}
            className="rounded-lg bg-[#5D5FEF] px-5 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Form primitives ───────────────────────────────────────────────────────────

function FieldInput({
  label, value, onChange, type = "text", placeholder, readOnly, inputMode, maxLength,
}: {
  label: string; value: string; onChange?: (v: string) => void;
  type?: string; placeholder?: string; readOnly?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; maxLength?: number;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        readOnly={readOnly}
        inputMode={inputMode}
        maxLength={maxLength}
        className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#5D5FEF] focus:outline-none ${readOnly ? "bg-slate-50 text-slate-400" : ""}`}
      />
    </div>
  );
}

function FieldSelect({
  label, value, onChange, children,
}: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#5D5FEF] focus:outline-none"
      >
        {children}
      </select>
    </div>
  );
}

function fmtInputDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Filter = "all" | "in" | "out" | "suspended";

export default function TeamPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [clockingId, setClockingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<{ items: Employee[] }>("/api/v1/team");
      setEmployees(data.items ?? []);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load team.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleQuickClock = async (emp: Employee) => {
    setClockingId(emp.id);
    try {
      if (emp.clocked_in) {
        await apiPost(`/api/v1/team/${emp.id}/clock-out`, {});
      } else {
        await apiPost(`/api/v1/team/${emp.id}/clock-in`, {});
      }
      void load();
    } catch {} finally { setClockingId(null); }
  };

  const filtered = employees.filter((e) => {
    if (filter === "in" && !e.clocked_in) return false;
    if (filter === "out" && (e.clocked_in || e.status !== "active")) return false;
    if (filter === "suspended" && e.status === "active") return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.name.toLowerCase().includes(q) && !e.email.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalActive   = employees.filter((e) => e.status === "active").length;
  const clockedInNow  = employees.filter((e) => e.clocked_in).length;
  const totalHoursMins = employees.reduce((s, e) => {
    const mins = e.clocked_in && e.clocked_in_at
      ? e.today_minutes + elapsedMins(e.clocked_in_at)
      : e.today_minutes;
    return s + mins;
  }, 0);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all",       label: `All (${employees.length})` },
    { key: "in",        label: `Clocked In (${clockedInNow})` },
    { key: "out",       label: `Off Duty (${totalActive - clockedInNow})` },
    { key: "suspended", label: `Suspended (${employees.filter((e) => e.status !== "active").length})` },
  ];

  return (
    <EnterpriseShell
      active="team"
      title="Team"
      subtitle="Employee directory and time clock"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 sm:px-6">

        {/* ── Stats bar ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total Staff",     value: String(employees.length),     color: "text-[#111]" },
            { label: "Clocked In Now",  value: String(clockedInNow),         color: "text-emerald-600" },
            { label: "Hours Today",     value: formatHours(totalHoursMins),  color: "text-blue-600" },
            { label: "Suspended",       value: String(employees.filter((e) => e.status !== "active").length), color: "text-amber-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400">{label}</p>
              <p className={`mt-0.5 text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* ── Filter + search + add ─────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {FILTERS.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setFilter(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${filter === key ? "bg-[#5D5FEF] text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-[#5D5FEF] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="rounded-lg bg-[#5D5FEF] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#4849d0]"
            >
              + Add Employee
            </button>
            <Link
              href="/team/custom-roles"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Custom roles
            </Link>
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────────────── */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p role="alert" className="text-sm text-red-700">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center shadow-sm">
            <p className="text-sm text-slate-400">No employees match this filter.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3 hidden md:table-cell">Status</th>
                  <th className="px-4 py-3">Clock Status</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Today</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((emp) => {
                  const isClocking = clockingId === emp.id;
                  const isSuspended = emp.status !== "active";
                  const elapsedToday = emp.clocked_in && emp.clocked_in_at
                    ? emp.today_minutes + elapsedMins(emp.clocked_in_at)
                    : emp.today_minutes;

                  return (
                    <tr
                      key={emp.id}
                      className="cursor-pointer hover:bg-[#FAFAFA] transition-colors"
                      onClick={() => setEditTarget(emp)}
                    >
                      {/* Employee */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isSuspended ? "bg-slate-200 text-slate-400" : AVATAR_COLORS[emp.role]}`}>
                            {initials(emp.name)}
                          </div>
                          <div>
                            <p className="font-semibold text-[#111]">{emp.name}</p>
                            <p className="text-[11px] text-slate-400">{emp.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3">
                        <RoleBadge role={emp.role} />
                        {emp.department && (
                          <p className="mt-0.5 text-[11px] text-slate-400">{emp.department}</p>
                        )}
                      </td>

                      {/* Account status */}
                      <td className="hidden px-4 py-3 md:table-cell">
                        <StatusBadge status={emp.status} />
                      </td>

                      {/* Clock status */}
                      <td className="px-4 py-3">
                        {isSuspended ? (
                          <span className="text-slate-300">—</span>
                        ) : emp.clocked_in && emp.clocked_in_at ? (
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            <span className="text-xs font-semibold text-emerald-700">
                              IN · {fmtTime(emp.clocked_in_at)}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-slate-300" />
                            <span className="text-xs text-slate-400">Off</span>
                          </div>
                        )}
                      </td>

                      {/* Today hours */}
                      <td className="hidden px-4 py-3 text-sm font-medium text-[#111] sm:table-cell">
                        {isSuspended ? "—" : formatHours(elapsedToday)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {!isSuspended && (
                            <button
                              type="button"
                              disabled={isClocking}
                              onClick={() => void handleQuickClock(emp)}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                                emp.clocked_in
                                  ? "bg-red-50 text-red-600 hover:bg-red-100"
                                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              }`}
                            >
                              {isClocking ? "…" : emp.clocked_in ? "Clock Out" : "Clock In"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setEditTarget(emp)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Roles legend ──────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <span key={r} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${ROLE_COLORS[r]}`}>
              {ROLE_LABELS[r]}
            </span>
          ))}
        </div>

      </div>

      {/* ── Modals ────────────────────────────────────────────────────── */}
      {showAdd && (
        <AddEmployeeModal
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); void load(); }}
        />
      )}
      {editTarget && (
        <EmployeeModal
          employee={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={() => { setEditTarget(null); void load(); }}
        />
      )}

    </EnterpriseShell>
  );
}
