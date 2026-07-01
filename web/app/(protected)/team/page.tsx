"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import {
  ROLES, ROLE_LABELS, ROLE_COLORS, AVATAR_COLORS,
  formatHours, elapsedMins, fmtTime,
  type Employee, type RoleId, type AccountStatus,
} from "./_components/teamTypes";
import { AddEmployeeModal } from "./_components/AddEmployeeModal";
import { EmployeeModal } from "./_components/EmployeeModal";

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

function initials(name: string): string {
  const parts = name.trim().split(" ");
  return parts.length >= 2
    ? (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

// ── Page ──────────────────────────────────────────────────────────────────────

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

  const totalActive  = employees.filter((e) => e.status === "active").length;
  const clockedInNow = employees.filter((e) => e.clocked_in).length;
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

        {/* Stats bar */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total Staff",    value: String(employees.length),    color: "text-[#111]" },
            { label: "Clocked In Now", value: String(clockedInNow),        color: "text-emerald-600" },
            { label: "Hours Today",    value: formatHours(totalHoursMins), color: "text-blue-600" },
            { label: "Suspended",      value: String(employees.filter((e) => e.status !== "active").length), color: "text-amber-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-400">{label}</p>
              <p className={`mt-0.5 text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filter + search + add */}
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

        {/* Table */}
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
                  <th className="hidden px-4 py-3 md:table-cell">Status</th>
                  <th className="px-4 py-3">Clock Status</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Today</th>
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
                      className="cursor-pointer transition-colors hover:bg-[#FAFAFA]"
                      onClick={() => setEditTarget(emp)}
                    >
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
                      <td className="px-4 py-3">
                        <RoleBadge role={emp.role} />
                        {emp.department && (
                          <p className="mt-0.5 text-[11px] text-slate-400">{emp.department}</p>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <StatusBadge status={emp.status} />
                      </td>
                      <td className="px-4 py-3">
                        {isSuspended ? (
                          <span className="text-slate-300">—</span>
                        ) : emp.clocked_in && emp.clocked_in_at ? (
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            <span className="text-xs font-semibold text-emerald-700">IN · {fmtTime(emp.clocked_in_at)}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-slate-300" />
                            <span className="text-xs text-slate-400">Off</span>
                          </div>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-sm font-medium text-[#111] sm:table-cell">
                        {isSuspended ? "—" : formatHours(elapsedToday)}
                      </td>
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

        {/* Roles legend */}
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <span key={r} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${ROLE_COLORS[r]}`}>
              {ROLE_LABELS[r]}
            </span>
          ))}
        </div>

      </div>

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
