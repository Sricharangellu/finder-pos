"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { apiGet, apiPost, apiPatch, ApiResponseError } from "@/api-client/client";
import { FEATURE_GROUPS } from "@/lib/features";
import {
  ROLES, ROLE_LABELS, ROLE_COLORS, AVATAR_COLORS, DEPT_OPTIONS,
  EMPLOYMENT_LABELS, formatHours, elapsedMins, fmtTime, fmtInputDate,
  type Employee, type RoleId, type AccountStatus,
} from "../_components/teamTypes";
import { BUILT_IN } from "../../settings/permissions/_components/permissionsTypes";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimeEntry {
  id: string;
  clock_in: number;
  clock_out: number | null;
  duration_mins: number | null;
  notes: string | null;
}

interface RolePermissions {
  features: string[];
}

type PRStatus = "draft" | "submitted" | "pending_review" | "approved" | "rejected" | "expired" | "revoked";
type Urgency = "low" | "normal" | "high" | "urgent";

interface PermissionRequest {
  id: string;
  requested_for_user_id: string;
  requested_by_user_id: string;
  requested_by_name: string;
  permission_code: string;
  reason: string;
  business_justification: string | null;
  access_type: "temporary" | "permanent";
  start_at: number | null;
  end_at: number | null;
  urgency: Urgency;
  status: PRStatus;
  reviewed_by_name: string | null;
  review_notes: string | null;
  reviewed_at: number | null;
  created_at: number;
  risk_level: "low" | "medium" | "high";
}

interface PermissionOverride {
  id: string;
  user_id: string;
  permission_code: string;
  granted_by_name: string;
  source_request_id: string | null;
  starts_at: number | null;
  expires_at: number | null;
  status: "active" | "expired" | "revoked";
  created_at: number;
}

type Tab = "profile" | "timeclock" | "permissions" | "requests" | "security";

const TABS: { id: Tab; label: string }[] = [
  { id: "profile",     label: "Profile" },
  { id: "timeclock",   label: "Time Clock" },
  { id: "permissions", label: "Permissions" },
  { id: "requests",    label: "Permission Requests" },
  { id: "security",    label: "Security" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(" ");
  return parts.length >= 2
    ? (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function fmtDuration(mins: number | null): string {
  if (mins === null) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtDate(ts: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(ts));
}

function employmentLabel(t: string): string {
  return EMPLOYMENT_LABELS[t as keyof typeof EMPLOYMENT_LABELS] ?? t;
}

// ── Profile Tab ───────────────────────────────────────────────────────────────

function ProfileTab({ emp, onSaved }: { emp: Employee; onSaved: (e: Employee) => void }) {
  const [name, setName] = useState(emp.name);
  const [phone, setPhone] = useState(emp.phone ?? "");
  const [dept, setDept] = useState(emp.department ?? "");
  const [role, setRole] = useState<RoleId>(emp.role);
  const [empType, setEmpType] = useState(emp.employment_type);
  const [hireDate, setHireDate] = useState(fmtInputDate(emp.hire_date));
  const [rate, setRate] = useState(emp.hourly_rate_cents ? String(emp.hourly_rate_cents / 100) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null); setSuccess(false);
    try {
      const updated = await apiPatch<Employee>(`/api/v1/team/${emp.id}`, {
        name: name.trim(),
        phone: phone.trim() || null,
        department: dept || null,
        role,
        employment_type: empType,
        hire_date: new Date(hireDate).getTime(),
        hourly_rate_cents: rate ? Math.round(parseFloat(rate) * 100) : null,
      });
      onSaved(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Save failed.");
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <Card className="p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Basic information</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Full name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Email</label>
            <input
              type="email"
              value={emp.email}
              disabled
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Department</label>
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">No department</option>
              {DEPT_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Hire date</label>
            <input
              type="date"
              value={hireDate}
              onChange={(e) => setHireDate(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Role & employment</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RoleId)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Employment type</label>
            <select
              value={empType}
              onChange={(e) => setEmpType(e.target.value as Employee["employment_type"])}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contractor">Contractor</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Hourly rate (USD)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-md border border-slate-300 py-2 pl-7 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
          </div>
        </div>
      </Card>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="min-h-[40px] rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        {success && <span className="text-sm text-emerald-600">Saved!</span>}
      </div>
    </form>
  );
}

// ── Time Clock Tab ─────────────────────────────────────────────────────────────

function TimeClockTab({ emp, onUpdated }: { emp: Employee; onUpdated: (e: Employee) => void }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [clocking, setClocking] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const loadEntries = useCallback(async () => {
    try {
      const data = await apiGet<{ items: TimeEntry[] }>(`/api/v1/team/${emp.id}/time-entries`);
      setEntries(data.items ?? []);
    } finally { setLoading(false); }
  }, [emp.id]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  useEffect(() => {
    if (!emp.clocked_in || !emp.clocked_in_at) return;
    const tick = () => setElapsed(elapsedMins(emp.clocked_in_at!));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [emp.clocked_in, emp.clocked_in_at]);

  const handleClock = async () => {
    setClocking(true);
    try {
      if (emp.clocked_in) {
        await apiPost(`/api/v1/team/${emp.id}/clock-out`, {});
      } else {
        await apiPost(`/api/v1/team/${emp.id}/clock-in`, {});
      }
      const updated = await apiGet<Employee>(`/api/v1/team/${emp.id}`);
      onUpdated(updated);
      void loadEntries();
    } catch {} finally { setClocking(false); }
  };

  const totalToday = emp.today_minutes + (emp.clocked_in ? elapsed : 0);

  return (
    <div className="space-y-4">
      {/* Status card */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Status today</p>
            <div className="mt-1 flex items-center gap-2">
              <span className={`inline-flex h-2.5 w-2.5 rounded-full ${emp.clocked_in ? "bg-emerald-500" : "bg-slate-300"}`} />
              <span className="text-sm font-semibold text-slate-900">
                {emp.clocked_in
                  ? `Clocked in at ${fmtTime(emp.clocked_in_at!)}`
                  : "Not clocked in"}
              </span>
            </div>
            {emp.clocked_in && (
              <p className="mt-0.5 text-xs text-slate-500">
                Current session: {formatHours(elapsed)}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-slate-500">Today&rsquo;s total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{formatHours(totalToday)}</p>
          </div>
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={handleClock}
            disabled={clocking}
            className={[
              "min-h-[40px] rounded-md px-5 py-2 text-sm font-medium transition-colors disabled:opacity-60",
              emp.clocked_in
                ? "bg-red-50 text-red-700 hover:bg-red-100"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
            ].join(" ")}
          >
            {clocking ? "..." : emp.clocked_in ? "Clock out" : "Clock in"}
          </button>
        </div>
      </Card>

      {/* Today's entries */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Today&rsquo;s entries</h3>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-sm text-slate-400">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-400">No clock-in entries today.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Clock in</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Clock out</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-500">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{fmtTime(e.clock_in)}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {e.clock_out ? fmtTime(e.clock_out) : <span className="text-emerald-600">Active</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">
                    {fmtDuration(e.duration_mins)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ── Permissions Tab ───────────────────────────────────────────────────────────

// ── Permission status helpers ─────────────────────────────────────────────────

const PR_STATUS_STYLES: Record<PRStatus, { bg: string; text: string; label: string }> = {
  draft:          { bg: "bg-slate-100",  text: "text-slate-500",  label: "Draft" },
  submitted:      { bg: "bg-amber-100",  text: "text-amber-700",  label: "Submitted" },
  pending_review: { bg: "bg-amber-100",  text: "text-amber-700",  label: "Pending Review" },
  approved:       { bg: "bg-emerald-100",text: "text-emerald-700",label: "Approved" },
  rejected:       { bg: "bg-red-100",    text: "text-red-600",    label: "Rejected" },
  expired:        { bg: "bg-slate-100",  text: "text-slate-500",  label: "Expired" },
  revoked:        { bg: "bg-red-50",     text: "text-red-500",    label: "Revoked" },
};

const URGENCY_STYLES: Record<Urgency, { bg: string; text: string; label: string }> = {
  low:    { bg: "bg-slate-100",  text: "text-slate-500",  label: "Low" },
  normal: { bg: "bg-blue-100",   text: "text-blue-700",   label: "Normal" },
  high:   { bg: "bg-orange-100", text: "text-orange-700", label: "High" },
  urgent: { bg: "bg-red-100",    text: "text-red-700",    label: "Urgent" },
};

function PRStatusBadge({ status }: { status: PRStatus }) {
  const s = PR_STATUS_STYLES[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.bg} ${s.text}`}>{s.label}</span>;
}

function featLabel(code: string): string {
  for (const g of FEATURE_GROUPS) {
    const f = g.features.find((f) => f.id === code);
    if (f) return f.label;
  }
  return code;
}

// ── Permissions Tab (with overrides + pending) ────────────────────────────────

function PermissionsTab({ emp, onRequestClick }: { emp: Employee; onRequestClick: () => void }) {
  const [permissions, setPermissions] = useState<RolePermissions | null>(null);
  const [overrides, setOverrides] = useState<PermissionOverride[]>([]);
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      apiGet<Record<string, { features: string[] }>>("/api/v1/settings/permissions"),
      apiGet<{ items: PermissionOverride[] }>(`/api/v1/team/${emp.id}/permission-overrides`),
      apiGet<{ items: PermissionRequest[] }>(`/api/v1/team/${emp.id}/permission-requests`),
    ]).then(([permsData, ovData, reqData]) => {
      const rolePerms = permsData[emp.role];
      setPermissions(rolePerms ?? { features: FEATURE_GROUPS.flatMap((g) => g.features.map((f) => f.id)) });
      setOverrides(ovData.items ?? []);
      setRequests(reqData.items ?? []);
    }).catch(() => {
      setPermissions({ features: [] });
    }).finally(() => setLoading(false));
  }, [emp.id, emp.role]);

  const isFullAccess = emp.role === "owner" || emp.role === "admin";
  const roleSet = new Set(permissions?.features ?? []);
  const activeOverrideSet = new Set(overrides.filter((o) => o.status === "active").map((o) => o.permission_code));
  const pendingSet = new Set(
    requests
      .filter((r) => r.status === "submitted" || r.status === "pending_review")
      .map((r) => r.permission_code)
  );
  const roleInfo = BUILT_IN[emp.role as keyof typeof BUILT_IN];

  const activeOverrides = overrides.filter((o) => o.status === "active");

  return (
    <div className="space-y-4">
      {/* Role card + action buttons */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${AVATAR_COLORS[emp.role]} text-sm font-bold`}>
            {ROLE_LABELS[emp.role].charAt(0)}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">{ROLE_LABELS[emp.role]}</p>
            <p className="text-xs text-slate-500">{roleInfo?.description ?? "Custom role"}</p>
          </div>
          {isFullAccess && (
            <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">Full access</span>
          )}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-3">
          {[
            { color: "bg-emerald-500", label: "Role permission" },
            { color: "bg-blue-500",    label: "Temporary override" },
            { color: "bg-amber-400",   label: "Pending request" },
            { color: "bg-slate-300",   label: "Not allowed" },
          ].map((l) => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${l.color}`} />
              <span className="text-xs text-slate-500">{l.label}</span>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRequestClick}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
          >
            Request Permission
          </button>
          <button
            type="button"
            onClick={onRequestClick}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View Request History
          </button>
          <Link
            href="/settings/permissions"
            className="inline-flex items-center rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Settings › Permissions
          </Link>
        </div>
      </Card>

      {/* Active overrides banner */}
      {activeOverrides.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="mb-2 text-xs font-semibold text-blue-800">Active temporary overrides</p>
          <div className="space-y-1.5">
            {activeOverrides.map((ov) => (
              <div key={ov.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  <span className="text-sm font-medium text-blue-900">{featLabel(ov.permission_code)}</span>
                  <span className="text-xs text-blue-600">granted by {ov.granted_by_name}</span>
                </div>
                {ov.expires_at && (
                  <span className="text-xs text-blue-500">
                    Expires {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(ov.expires_at))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature grid */}
      {loading ? (
        <Card className="p-5 text-sm text-slate-400">Loading permissions...</Card>
      ) : (
        <div className="space-y-3">
          {FEATURE_GROUPS.map((group) => (
            <Card key={group.label} className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <span className="text-xs font-semibold text-slate-600">{group.label}</span>
                <span className="text-xs text-slate-400">
                  {isFullAccess
                    ? `${group.features.length}/${group.features.length}`
                    : `${group.features.filter((f) => roleSet.has(f.id) || activeOverrideSet.has(f.id)).length}/${group.features.length}`}
                </span>
              </div>
              <ul className="divide-y divide-slate-50">
                {group.features.map((feat) => {
                  const fromRole     = isFullAccess || roleSet.has(feat.id);
                  const fromOverride = !fromRole && activeOverrideSet.has(feat.id);
                  const isPending    = !fromRole && !fromOverride && pendingSet.has(feat.id);
                  const allowed      = fromRole || fromOverride;

                  let dotColor = "bg-slate-300";
                  let iconEl: React.ReactNode = (
                    <svg className="h-3 w-3 text-slate-400" viewBox="0 0 12 12" fill="none">
                      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  );
                  let bgColor = "bg-slate-100";
                  let labelColor = "text-slate-400";
                  let badge: React.ReactNode = null;

                  if (fromRole) {
                    dotColor = "bg-emerald-500"; bgColor = "bg-emerald-100"; labelColor = "text-slate-900";
                    iconEl = <svg className="h-3 w-3 text-emerald-600" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
                  } else if (fromOverride) {
                    dotColor = "bg-blue-500"; bgColor = "bg-blue-100"; labelColor = "text-slate-900";
                    iconEl = <svg className="h-3 w-3 text-blue-600" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
                    badge = <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Override</span>;
                  } else if (isPending) {
                    dotColor = "bg-amber-400"; bgColor = "bg-amber-100"; labelColor = "text-slate-700";
                    iconEl = <svg className="h-3 w-3 text-amber-600" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M6 3.5V6l1.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
                    badge = <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Pending</span>;
                  }

                  return (
                    <li key={feat.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/50">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${bgColor}`}>
                        {iconEl}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center">
                          <p className={`text-sm ${labelColor}`}>{feat.label}</p>
                          {badge}
                        </div>
                        <p className="text-xs text-slate-400">{feat.description}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Request Permission Modal ───────────────────────────────────────────────────

function RequestPermissionModal({ emp, onClose, onSubmitted }: {
  emp: Employee;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [permCode, setPermCode] = useState("");
  const [reason, setReason] = useState("");
  const [justification, setJustification] = useState("");
  const [accessType, setAccessType] = useState<"temporary" | "permanent">("temporary");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("normal");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permCode || !reason.trim()) { setError("Permission and reason are required."); return; }
    setSubmitting(true); setError(null);
    try {
      await apiPost("/api/v1/permission-requests", {
        requested_for_user_id: emp.id,
        requested_for_name: emp.name,
        requested_by_user_id: emp.id,
        requested_by_name: emp.name,
        permission_code: permCode,
        reason: reason.trim(),
        business_justification: justification.trim() || null,
        access_type: accessType,
        start_at: accessType === "temporary" && startDate ? new Date(startDate).getTime() : null,
        end_at: accessType === "temporary" && endDate ? new Date(endDate).getTime() : null,
        urgency,
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Submit failed.");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Request permission</h2>
            <p className="text-xs text-slate-500">For {emp.name} &middot; {ROLE_LABELS[emp.role]}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Permission <span className="text-red-500">*</span></label>
            <select
              value={permCode}
              onChange={(e) => setPermCode(e.target.value)}
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">Select a permission…</option>
              {FEATURE_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.features.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Reason <span className="text-red-500">*</span></label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={2}
              placeholder="Why is this permission needed?"
              className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Business justification</label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={2}
              placeholder="How will this benefit the business?"
              className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Access type</label>
              <div className="flex rounded-md border border-slate-300 p-0.5">
                {(["temporary", "permanent"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setAccessType(t)}
                    className={`flex-1 rounded py-1.5 text-xs font-medium transition-colors ${
                      accessType === t ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {t === "temporary" ? "Temporary" : "Permanent"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Urgency</label>
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as Urgency)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {accessType === "temporary" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Start date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">End date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-60">
              {submitting ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Permission Requests Tab ───────────────────────────────────────────────────

function PermissionRequestsTab({ emp }: { emp: Employee }) {
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ items: PermissionRequest[] }>(`/api/v1/team/${emp.id}/permission-requests`);
      setRequests(data.items ?? []);
    } finally { setLoading(false); }
  }, [emp.id]);

  useEffect(() => { void load(); }, [load]);

  const pending = requests.filter((r) => r.status === "submitted" || r.status === "pending_review");
  const past    = requests.filter((r) => !["submitted", "pending_review"].includes(r.status));

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Permission requests</h3>
          {pending.length > 0 && (
            <p className="text-xs text-amber-600">{pending.length} pending review</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
        >
          Request Permission
        </button>
      </div>

      {loading ? (
        <Card className="p-5 text-sm text-slate-400">Loading requests…</Card>
      ) : requests.length === 0 ? (
        <Card className="flex flex-col items-center py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
            <svg className="h-6 w-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700">No requests yet</p>
          <p className="mt-1 text-xs text-slate-400">Click Request Permission to submit a new access request.</p>
        </Card>
      ) : (
        <>
          {pending.length > 0 && (
            <RequestList title="Pending" requests={pending} />
          )}
          {past.length > 0 && (
            <RequestList title="History" requests={past} />
          )}
        </>
      )}

      {showModal && (
        <RequestPermissionModal
          emp={emp}
          onClose={() => setShowModal(false)}
          onSubmitted={() => { setShowModal(false); void load(); }}
        />
      )}
    </div>
  );
}

function RequestList({ title, requests }: { title: string; requests: PermissionRequest[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="text-xs font-semibold text-slate-600">{title}</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {requests.map((req) => {
          const urg = URGENCY_STYLES[req.urgency];
          return (
            <li key={req.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{featLabel(req.permission_code)}</p>
                    <PRStatusBadge status={req.status} />
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${urg.bg} ${urg.text}`}>{urg.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      req.access_type === "permanent" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"
                    }`}>
                      {req.access_type === "permanent" ? "Permanent" : "Temporary"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{req.reason}</p>
                  {req.review_notes && (
                    <p className="mt-1 text-xs text-slate-500 italic">
                      <span className="font-medium not-italic">Reviewer note:</span> {req.review_notes}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400">
                    <span>Requested by {req.requested_by_name}</span>
                    <span>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(req.created_at))}</span>
                    {req.end_at && (
                      <span>Until {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(req.end_at))}</span>
                    )}
                  </div>
                </div>
                {req.reviewed_by_name && (
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-slate-400">Reviewed by</p>
                    <p className="text-xs font-medium text-slate-600">{req.reviewed_by_name}</p>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── Security Tab ──────────────────────────────────────────────────────────────

function SecurityTab({ emp, onUpdated }: { emp: Employee; onUpdated: (e: Employee) => void }) {
  const [suspendReason, setSuspendReason] = useState("");
  const [pin, setPin] = useState(emp.pin ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"suspend" | "terminate" | "reactivate" | null>(null);

  const changeStatus = async (status: AccountStatus, reason?: string) => {
    setSaving(true); setError(null);
    try {
      const updated = await apiPatch<Employee>(`/api/v1/team/${emp.id}`, {
        status,
        suspend_reason: status === "suspended" ? (reason ?? null) : null,
      });
      onUpdated(updated);
      setConfirmAction(null);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed.");
    } finally { setSaving(false); }
  };

  const savePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const updated = await apiPatch<Employee>(`/api/v1/team/${emp.id}`, { pin: pin || null });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed.");
    } finally { setSaving(false); }
  };

  const statusColors: Record<AccountStatus, string> = {
    active:     "bg-emerald-100 text-emerald-700",
    suspended:  "bg-amber-100 text-amber-700",
    terminated: "bg-red-100 text-red-600",
  };

  return (
    <div className="space-y-4">
      {/* Account status */}
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Account status</h3>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${statusColors[emp.status]}`}>
            {emp.status.charAt(0).toUpperCase() + emp.status.slice(1)}
          </span>
          {emp.suspend_reason && (
            <span className="text-sm text-slate-500">&mdash; {emp.suspend_reason}</span>
          )}
        </div>

        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          {emp.status !== "active" && (
            <button
              type="button"
              onClick={() => setConfirmAction("reactivate")}
              className="rounded-md bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
            >
              Reactivate account
            </button>
          )}
          {emp.status === "active" && (
            <button
              type="button"
              onClick={() => setConfirmAction("suspend")}
              className="rounded-md bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
            >
              Suspend account
            </button>
          )}
          {emp.status !== "terminated" && (
            <button
              type="button"
              onClick={() => setConfirmAction("terminate")}
              className="rounded-md bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Terminate
            </button>
          )}
        </div>
      </Card>

      {/* PIN management */}
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">POS PIN</h3>
        <p className="mb-3 text-xs text-slate-500">
          Used for quick-login at the terminal. Leave blank to disable PIN access.
        </p>
        <form onSubmit={savePin} className="flex gap-2">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="4-6 digits"
            className="w-40 rounded-md border border-slate-300 px-3 py-2 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Update PIN"}
          </button>
          {pin && (
            <button
              type="button"
              onClick={() => { setPin(""); }}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </form>
      </Card>

      {/* Confirm action modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
            {confirmAction === "suspend" && (
              <>
                <h2 className="text-base font-semibold text-slate-900">Suspend {emp.name}?</h2>
                <p className="mt-2 text-sm text-slate-600">
                  They will not be able to log in until reactivated.
                </p>
                <div className="mt-3">
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Reason (optional)</label>
                  <input
                    type="text"
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    placeholder="Policy violation, leave of absence..."
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmAction(null)}
                    className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
                  <button type="button" onClick={() => changeStatus("suspended", suspendReason)} disabled={saving}
                    className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60">
                    {saving ? "..." : "Suspend"}
                  </button>
                </div>
              </>
            )}
            {confirmAction === "terminate" && (
              <>
                <h2 className="text-base font-semibold text-slate-900">Terminate {emp.name}?</h2>
                <p className="mt-2 text-sm text-slate-600">
                  This will permanently end their employment. This action cannot be undone.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmAction(null)}
                    className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
                  <button type="button" onClick={() => changeStatus("terminated")} disabled={saving}
                    className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                    {saving ? "..." : "Terminate"}
                  </button>
                </div>
              </>
            )}
            {confirmAction === "reactivate" && (
              <>
                <h2 className="text-base font-semibold text-slate-900">Reactivate {emp.name}?</h2>
                <p className="mt-2 text-sm text-slate-600">
                  They will regain access to log in with their assigned permissions.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmAction(null)}
                    className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
                  <button type="button" onClick={() => changeStatus("active")} disabled={saving}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                    {saving ? "..." : "Reactivate"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params["id"]);

  const [emp, setEmp] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("profile");
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestsKey, setRequestsKey] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    setLoading(true); setError(null);
    apiGet<Employee>(`/api/v1/team/${id}`)
      .then(setEmp)
      .catch((e) => setError(e instanceof ApiResponseError ? e.message : "Employee not found."))
      .finally(() => setLoading(false));
    // Load pending count for badge
    apiGet<{ items: PermissionRequest[] }>(`/api/v1/team/${id}/permission-requests`)
      .then((d) => setPendingCount(d.items.filter((r) => r.status === "submitted" || r.status === "pending_review").length))
      .catch(() => {});
  }, [id]);

  if (loading) {
    return (
      <EnterpriseShell active="team" title="Team" subtitle="Loading...">
        <div className="flex flex-1 items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
        </div>
      </EnterpriseShell>
    );
  }

  if (error || !emp) {
    return (
      <EnterpriseShell active="team" title="Team" subtitle="Not found">
        <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
          <p className="text-sm text-red-700">{error ?? "Employee not found."}</p>
          <button
            type="button"
            onClick={() => router.push("/team")}
            className="mt-4 rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Back to team
          </button>
        </div>
      </EnterpriseShell>
    );
  }

  return (
    <EnterpriseShell active="team" title="Team" subtitle={emp.name}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-slate-400">
          <Link href="/team" className="hover:text-slate-700">Team</Link>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="text-slate-700">{emp.name}</span>
        </nav>

        {/* Header */}
        <div className="flex items-start gap-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold ${AVATAR_COLORS[emp.role]}`}>
            {initials(emp.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-900">{emp.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_COLORS[emp.role]}`}>
                {ROLE_LABELS[emp.role]}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                emp.status === "active" ? "bg-emerald-100 text-emerald-700" :
                emp.status === "suspended" ? "bg-amber-100 text-amber-700" :
                "bg-red-100 text-red-600"
              }`}>
                {emp.status.charAt(0).toUpperCase() + emp.status.slice(1)}
              </span>
              {emp.department && (
                <span className="text-xs text-slate-500">{emp.department}</span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {emp.email}
              {emp.phone && <> &middot; {emp.phone}</>}
              &middot; {employmentLabel(emp.employment_type)}
              &middot; Since {fmtDate(emp.hire_date)}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-200">
          <nav className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={[
                  "flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors",
                  tab === t.id
                    ? "border-b-2 border-brand-600 text-brand-600"
                    : "text-slate-500 hover:text-slate-700",
                ].join(" ")}
              >
                {t.label}
                {t.id === "requests" && pendingCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {tab === "profile"     && <ProfileTab            emp={emp} onSaved={setEmp} />}
        {tab === "timeclock"   && <TimeClockTab          emp={emp} onUpdated={setEmp} />}
        {tab === "permissions" && (
          <PermissionsTab
            emp={emp}
            onRequestClick={() => { setShowRequestModal(true); }}
          />
        )}
        {tab === "requests"    && <PermissionRequestsTab emp={emp} key={requestsKey} />}
        {tab === "security"    && <SecurityTab           emp={emp} onUpdated={setEmp} />}

        {showRequestModal && emp && (
          <RequestPermissionModal
            emp={emp}
            onClose={() => setShowRequestModal(false)}
            onSubmitted={() => {
              setShowRequestModal(false);
              setRequestsKey((k) => k + 1);
              setTab("requests");
            }}
          />
        )}
      </div>
    </EnterpriseShell>
  );
}
