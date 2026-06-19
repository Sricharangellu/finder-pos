"use client";

/**
 * /team — Team directory. Owner/manager only.
 * Lists all users in the tenant with role badges.
 * Fetches GET /api/v1/team.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { getUser } from "@/lib/auth";

interface TeamMember {
  id: string;
  email: string;
  role: string;
  custom_role_id: string | null;
  created_at: number;
}

const ROLE_STYLE: Record<string, string> = {
  owner:   "bg-violet-50 text-violet-700 ring-violet-200",
  manager: "bg-blue-50 text-blue-700 ring-blue-200",
  cashier: "bg-slate-50 text-slate-700 ring-slate-200",
};

function roleBadge(role: string): "blue" | "green" | "gray" {
  if (role === "owner") return "blue";
  if (role === "manager") return "green";
  return "gray";
}

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TeamPage() {
  const user = getUser();
  const role = user?.role ?? "cashier";
  const allowed = role === "owner" || role === "manager";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{ items: TeamMember[] }>("/api/v1/team");
        if (!cancelled) setMembers(data.items ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiResponseError ? err.message : "Failed to load team.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed]);

  const ownerCount = members.filter((m) => m.role === "owner").length;
  const managerCount = members.filter((m) => m.role === "manager").length;
  const cashierCount = members.filter((m) => m.role === "cashier").length;

  return (
    <EnterpriseShell
      active="team"
      title="Team"
      subtitle="Staff directory and role management"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">

        {!allowed ? (
          <Card>
            <p role="alert" className="text-sm text-slate-700">
              You don&apos;t have permission to view the team directory.
            </p>
          </Card>
        ) : loading ? (
          <p className="text-sm text-slate-500" aria-busy="true">Loading…</p>
        ) : error ? (
          <Card>
            <p role="alert" className="text-sm text-danger-700">{error}</p>
          </Card>
        ) : (
          <>
            {/* Summary chips */}
            <div className="flex flex-wrap gap-3">
              {[
                { label: "Owners",   count: ownerCount,   color: "bg-violet-50 text-violet-700 ring-1 ring-violet-200" },
                { label: "Managers", count: managerCount, color: "bg-blue-50 text-blue-700 ring-1 ring-blue-200" },
                { label: "Cashiers", count: cashierCount, color: "bg-slate-50 text-slate-700 ring-1 ring-slate-200" },
              ].map(({ label, count, color }) => (
                <span key={label} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${color}`}>
                  <span className="text-base font-semibold">{count}</span> {label}
                </span>
              ))}
            </div>

            {/* Members table */}
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Team members</h2>
                  <p className="text-sm text-slate-500">{members.length} {members.length === 1 ? "member" : "members"} in your workspace</p>
                </div>
                {role === "owner" && (
                  <Link
                    href="/team/custom-roles"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Manage roles
                  </Link>
                )}
              </div>

              {members.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-slate-500">No team members found.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3 hidden sm:table-cell">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {members.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${ROLE_STYLE[m.role] ?? "bg-slate-100 text-slate-600"}`}>
                              {initials(m.email)}
                            </div>
                            <div>
                              <p className="font-medium text-slate-950">{m.email}</p>
                              {m.custom_role_id && (
                                <p className="text-xs text-slate-400">Custom role assigned</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={roleBadge(m.role)}>
                            {m.role.charAt(0).toUpperCase() + m.role.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell text-slate-500">
                          {formatDate(m.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {/* Info callout */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="font-medium">Role permissions: </span>
              Owners have full access · Managers can view reports and manage operations ·
              Cashiers can process orders and payments at the register.
            </div>
          </>
        )}
      </div>
    </EnterpriseShell>
  );
}
