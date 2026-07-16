"use client";

import { useState } from "react";
import { useQuery } from "@/lib/useQuery";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { ReportsSubNav } from "@/components/reports/ReportsSubNav";
import { Card } from "@/components/Card";
import { KpiCard } from "@/components/KpiCard";
import { apiGet } from "@/api-client/client";
import { fmtTime, fmtDateShort } from "@/lib/date";

interface TimeEntry {
  employee_id: string;
  employee_name: string;
  clock_in: number;
  clock_out: number | null;
  break_minutes: number;
  worked_minutes: number | null;
}

interface EmployeeSummary {
  employeeId: string;
  employeeName: string;
  totalHours: number;
  entryCount: number;
}

interface TimeCardsResponse {
  entries: TimeEntry[];
  summary: EmployeeSummary[];
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "In progress";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default function TimeCardsPage() {
  const [range, setRange] = useState("30d");
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);

  const since = range === "7d" ? Date.now() - 7 * 86_400_000
    : range === "90d" ? Date.now() - 90 * 86_400_000
    : Date.now() - 30 * 86_400_000;

  const params = new URLSearchParams({ from: String(since) });
  if (selectedEmployee) params.set("employeeId", selectedEmployee);

  const { data, loading } = useQuery(
    `time-cards:${range}:${selectedEmployee}`,
    () => apiGet<TimeCardsResponse>(`/api/v1/reports/time-cards?${params}`),
    { staleMs: 60_000 },
  );

  const summary = data?.summary ?? [];
  const entries = data?.entries ?? [];
  const totalHours = summary.reduce((s, e) => s + e.totalHours, 0);
  const activeNow = entries.filter((e) => e.clock_out === null).length;

  return (
    <EnterpriseShell active="reports" title="Time Cards" subtitle="Employee clock-in/out history and hour totals">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">
        <ReportsSubNav />

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="h-8 rounded border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-brand-600"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <select
            value={selectedEmployee ?? ""}
            onChange={(e) => setSelectedEmployee(e.target.value || null)}
            className="h-8 rounded border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-brand-600"
          >
            <option value="">All employees</option>
            {summary.map((s) => (
              <option key={s.employeeId} value={s.employeeId}>{s.employeeName}</option>
            ))}
          </select>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <KpiCard title="Total Hours" value={`${totalHours.toFixed(1)}h`} loading={loading} tone="blue" />
          <KpiCard title="Employees" value={summary.length.toLocaleString()} loading={loading} tone="neutral" />
          <KpiCard title="Clocked In Now" value={activeNow.toLocaleString()} loading={loading} tone={activeNow > 0 ? "green" : "neutral"} />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          {/* Employee summary */}
          <div className="lg:col-span-2">
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
                By Employee
              </h3>
              {loading ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 animate-pulse rounded bg-gray-100" />)}</div>
              ) : summary.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--color-text-secondary)]">No time entries in this period.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-table-border)]">
                  {summary.map((s) => (
                    <li key={s.employeeId}>
                      <button
                        type="button"
                        onClick={() => setSelectedEmployee(selectedEmployee === s.employeeId ? null : s.employeeId)}
                        className={`w-full px-2 py-3 text-left rounded-lg transition-colors ${selectedEmployee === s.employeeId ? "bg-brand-50" : "hover:bg-gray-50"}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-[var(--color-text-primary)]">{s.employeeName}</span>
                          <span className="text-sm font-bold text-[var(--color-text-primary)]">{s.totalHours.toFixed(1)}h</span>
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{s.entryCount} shift{s.entryCount !== 1 ? "s" : ""}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Entry detail */}
          <div className="lg:col-span-3">
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
                {selectedEmployee ? `Shifts — ${summary.find(s => s.employeeId === selectedEmployee)?.employeeName}` : "All Shifts"}
              </h3>
              {loading ? (
                <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />)}</div>
              ) : entries.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">No entries.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-table-border)] text-xs text-[var(--color-text-secondary)]">
                      <th className="pb-2 text-left">Employee</th>
                      <th className="pb-2 text-left">Date</th>
                      <th className="pb-2 text-left">In</th>
                      <th className="pb-2 text-left">Out</th>
                      <th className="pb-2 text-left">Break</th>
                      <th className="pb-2 text-right">Worked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-table-border)]">
                    {entries.map((e, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="py-2 font-medium text-[var(--color-text-primary)]">{e.employee_name}</td>
                        <td className="py-2 text-[var(--color-text-secondary)]">{fmtDateShort(e.clock_in)}</td>
                        <td className="py-2 text-[var(--color-text-secondary)]">{fmtTime(e.clock_in)}</td>
                        <td className="py-2 text-[var(--color-text-secondary)]">{e.clock_out ? fmtTime(e.clock_out) : <span className="text-success-600 font-medium">Active</span>}</td>
                        <td className="py-2 text-[var(--color-text-secondary)]">{e.break_minutes > 0 ? `${e.break_minutes}m` : "—"}</td>
                        <td className="py-2 text-right font-medium tabular-nums text-[var(--color-text-primary)]">
                          {formatDuration(e.worked_minutes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </div>
      </div>
    </EnterpriseShell>
  );
}
