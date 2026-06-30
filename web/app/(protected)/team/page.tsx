"use client";

/**
 * /team — Team directory with invite, role-change, and remove actions.
 * Owner-only mutations; managers get read-only view.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { getUser } from "@/lib/auth";
import { fmtDate } from "@/lib/date";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  email: string;
  role: "owner" | "manager" | "cashier";
  custom_role_id: string | null;
  created_at: number;
}

type Role = "owner" | "manager" | "cashier";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_AVATAR: Record<string, string> = {
  owner:   "bg-violet-100 text-violet-700",
  manager: "bg-blue-100 text-blue-700",
  cashier: "bg-slate-100 text-slate-600",
};

function roleBadge(role: string): "blue" | "green" | "gray" {
  if (role === "owner") return "blue";
  if (role === "manager") return "green";
  return "gray";
}

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const user = getUser();
  const currentRole = user?.role ?? "cashier";
  const isOwner = currentRole === "owner";
  const allowed = currentRole === "owner" || currentRole === "manager";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("cashier");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Edit role modal
  const [editTarget, setEditTarget] = useState<TeamMember | null>(null);
  const [editRole, setEditRole] = useState<Role>("cashier");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Remove confirmation
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const data = await apiGet<{ items: TeamMember[] }>("/api/v1/team");
      setMembers(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load team.");
    } finally { setLoading(false); }
  }, [allowed]);

  useEffect(() => { void load(); }, [load]);

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true); setInviteError(null);
    try {
      await apiPost("/api/v1/team/invite", { email, role: inviteRole });
      setShowInvite(false);
      setInviteEmail(""); setInviteRole("cashier");
      void load();
    } catch (err) {
      setInviteError(err instanceof ApiResponseError ? err.message : "Invite failed.");
    } finally { setInviting(false); }
  };

  const openEdit = (m: TeamMember) => {
    setEditTarget(m);
    setEditRole(m.role);
    setEditError(null);
  };

  const handleSaveRole = async () => {
    if (!editTarget) return;
    setSaving(true); setEditError(null);
    try {
      await apiPatch(`/api/v1/team/${editTarget.id}`, { role: editRole });
      setEditTarget(null);
      void load();
    } catch (err) {
      setEditError(err instanceof ApiResponseError ? err.message : "Could not update role.");
    } finally { setSaving(false); }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await apiDelete(`/api/v1/team/${removeTarget.id}`);
      setRemoveTarget(null);
      void load();
    } finally { setRemoving(false); }
  };

  const ownerCount   = members.filter(m => m.role === "owner").length;
  const managerCount = members.filter(m => m.role === "manager").length;
  const cashierCount = members.filter(m => m.role === "cashier").length;

  return (
    <EnterpriseShell active="team" title="Team" subtitle="Staff directory and role management" contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">

        {!allowed ? (
          <Card><p role="alert" className="text-sm text-slate-700">You don&apos;t have permission to view the team directory.</p></Card>
        ) : loading ? (
          <TableSkeleton headers={["Name", "Email", "Role", "Status", ""]} rows={6} />
        ) : error ? (
          <Card><p role="alert" className="text-sm text-red-700">{error}</p></Card>
        ) : (
          <>
            {/* Summary chips */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
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
              {isOwner && (
                <Button variant="primary" size="sm" onClick={() => { setShowInvite(true); setInviteError(null); }}>
                  + Invite member
                </Button>
              )}
            </div>

            {/* Members table */}
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Team members</h2>
                  <p className="text-sm text-slate-500">{members.length} {members.length === 1 ? "member" : "members"}</p>
                </div>
                {isOwner && (
                  <Link href="/team/custom-roles" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                    Manage custom roles
                  </Link>
                )}
              </div>

              {members.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-slate-500">No team members yet. Invite someone above.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3 hidden sm:table-cell">Joined</th>
                      {isOwner && <th className="px-4 py-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {members.map(m => {
                      const isSelf = m.email === user?.email;
                      return (
                        <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${ROLE_AVATAR[m.role] ?? "bg-slate-100 text-slate-600"}`}>
                                {initials(m.email)}
                              </div>
                              <div>
                                <p className="font-medium text-slate-950">{m.email}</p>
                                {isSelf && <p className="text-xs text-slate-400">You</p>}
                                {m.custom_role_id && !isSelf && <p className="text-xs text-slate-400">Custom role assigned</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={roleBadge(m.role)}>{m.role.charAt(0).toUpperCase() + m.role.slice(1)}</Badge>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell text-slate-500">{fmtDate(m.created_at)}</td>
                          {isOwner && (
                            <td className="px-4 py-3 text-right">
                              {!isSelf && (
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => openEdit(m)}
                                    className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                                  >
                                    Change role
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRemoveTarget(m)}
                                    className="rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>

            {/* Role permissions callout */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="font-medium">Roles: </span>
              <span className="text-violet-700 font-medium">Owner</span> — full access ·{" "}
              <span className="text-blue-700 font-medium">Manager</span> — reports &amp; operations ·{" "}
              <span className="text-slate-700 font-medium">Cashier</span> — register only
            </div>
          </>
        )}
      </div>

      {/* ── Invite modal ────────────────────────────────────────────────────── */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowInvite(false)}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">Invite team member</h2>
              <button type="button" onClick={() => setShowInvite(false)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {inviteError && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{inviteError}</p>}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Email address</label>
                <input
                  type="email"
                  autoFocus
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void handleInvite(); }}
                  placeholder="colleague@company.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as Role)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="cashier">Cashier — register access only</option>
                  <option value="manager">Manager — reports &amp; operations</option>
                  <option value="owner">Owner — full access</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <Button variant="secondary" size="sm" onClick={() => setShowInvite(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={inviting} disabled={!inviteEmail.trim()} onClick={() => void handleInvite()}>
                Send invite
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change role modal ────────────────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">Change role</h2>
              <button type="button" onClick={() => setEditTarget(null)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {editError && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{editError}</p>}
              <p className="text-sm text-slate-500">Updating role for <span className="font-medium text-slate-900">{editTarget.email}</span></p>
              <select
                value={editRole}
                onChange={e => setEditRole(e.target.value as Role)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <Button variant="secondary" size="sm" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSaveRole()}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove confirmation ────────────────────────────────────────── */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRemoveTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-950 mb-2">Remove member?</h2>
            <p className="text-sm text-slate-500 mb-5">
              <span className="font-medium text-slate-900">{removeTarget.email}</span> will lose access to this workspace immediately.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setRemoveTarget(null)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={removing}
                onClick={() => void handleRemove()}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-500">
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}
    </EnterpriseShell>
  );
}
