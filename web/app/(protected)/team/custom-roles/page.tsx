"use client";

/**
 * /team/custom-roles — Owner-only custom role management.
 * Lists custom roles with their permission sets.
 * Supports create, edit (name/description/permissions), and delete.
 * Links back to /team.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { getUser } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: number;
  updatedAt: number;
}

type CreateBody = { name: string; description?: string; permissions: string[] };
type PatchBody  = Partial<{ name: string; description: string; permissions: string[] }>;

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_PERMISSIONS: Array<{ key: string; label: string; group: string }> = [
  { key: "orders:read",       label: "View orders",         group: "Orders"    },
  { key: "orders:write",      label: "Manage orders",       group: "Orders"    },
  { key: "orders:void",       label: "Void orders",         group: "Orders"    },
  { key: "customers:read",    label: "View customers",      group: "Customers" },
  { key: "customers:write",   label: "Manage customers",    group: "Customers" },
  { key: "catalog:read",      label: "View catalog",        group: "Catalog"   },
  { key: "catalog:write",     label: "Manage catalog",      group: "Catalog"   },
  { key: "inventory:read",    label: "View inventory",      group: "Inventory" },
  { key: "inventory:write",   label: "Manage inventory",    group: "Inventory" },
  { key: "purchasing:read",   label: "View purchasing",     group: "Purchasing"},
  { key: "purchasing:write",  label: "Manage purchasing",   group: "Purchasing"},
  { key: "reports:read",      label: "View reports",        group: "Reports"   },
  { key: "discounts:read",    label: "View discounts",      group: "Discounts" },
  { key: "discounts:write",   label: "Manage discounts",    group: "Discounts" },
  { key: "ecommerce:read",    label: "View ecommerce",      group: "Ecommerce" },
  { key: "ecommerce:write",   label: "Manage ecommerce",    group: "Ecommerce" },
  { key: "team:read",         label: "View team",           group: "Team"      },
];

const PERMISSION_GROUPS = Array.from(new Set(ALL_PERMISSIONS.map((p) => p.group)));

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ── Permission Picker ─────────────────────────────────────────────────────────

function PermissionPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (key: string) => {
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key));
    else onChange([...selected, key]);
  };

  const toggleGroup = (group: string) => {
    const groupKeys = ALL_PERMISSIONS.filter((p) => p.group === group).map((p) => p.key);
    const allSelected = groupKeys.every((k) => selected.includes(k));
    if (allSelected) onChange(selected.filter((k) => !groupKeys.includes(k)));
    else onChange(Array.from(new Set([...selected, ...groupKeys])));
  };

  return (
    <div className="space-y-3">
      {PERMISSION_GROUPS.map((group) => {
        const perms = ALL_PERMISSIONS.filter((p) => p.group === group);
        const allOn = perms.every((p) => selected.includes(p.key));
        const someOn = perms.some((p) => selected.includes(p.key));
        return (
          <div key={group} className="rounded-lg border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className="flex w-full items-center justify-between bg-slate-50 px-3 py-2 text-left"
            >
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
                {group}
              </span>
              <span className={`text-xs font-medium ${allOn ? "text-blue-600" : someOn ? "text-slate-500" : "text-slate-400"}`}>
                {allOn ? "All" : someOn ? "Some" : "None"}
              </span>
            </button>
            <div className="divide-y divide-slate-100">
              {perms.map((p) => (
                <label key={p.key} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.key)}
                    onChange={() => toggle(p.key)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="flex-1 text-sm text-slate-700">{p.label}</span>
                  <code className="text-xs text-slate-400">{p.key}</code>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Role Form Modal ───────────────────────────────────────────────────────────

function RoleFormModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: CustomRole;
  onSave: (b: CreateBody) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [permissions, setPermissions] = useState<string[]>(initial?.permissions ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required."); return; }
    if (permissions.length === 0) { setErr("Select at least one permission."); return; }
    setSaving(true);
    setErr(null);
    try {
      await onSave({ name: name.trim(), description: description.trim() || undefined, permissions });
      onClose();
    } catch (ex) {
      setErr(ex instanceof ApiResponseError ? ex.message : "Save failed.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            {initial ? "Edit role" : "New custom role"}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <form id="role-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {err && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {err}
            </p>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Role name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sales Rep"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Description <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What can this role do?"
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Permissions <span className="text-red-500">*</span>
              <span className="ml-2 font-normal text-slate-400">
                {permissions.length}/{ALL_PERMISSIONS.length} selected
              </span>
            </label>
            <PermissionPicker selected={permissions} onChange={setPermissions} />
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="role-form"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Create role"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CustomRolesPage() {
  const user = getUser();
  const role = user?.role ?? "cashier";
  const isOwner = role === "owner";

  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomRole | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomRole | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ items: CustomRole[] }>("/api/v1/custom-roles");
      setRoles(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load custom roles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOwner) load();
    else setLoading(false);
  }, [isOwner, load]);

  const handleCreate = async (body: CreateBody) => {
    await apiPost("/api/v1/custom-roles", body);
    await load();
  };

  const handleEdit = async (body: CreateBody) => {
    if (!editTarget) return;
    const patch: PatchBody = { name: body.name, permissions: body.permissions };
    if (body.description !== undefined) patch.description = body.description;
    await apiPatch(`/api/v1/custom-roles/${editTarget.id}`, patch);
    await load();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      await apiDelete(`/api/v1/custom-roles/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiResponseError ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <EnterpriseShell
      active="team"
      title="Custom Roles"
      subtitle="Define permission sets for your team members"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm text-slate-500">
          <Link href="/team" className="hover:text-slate-700 hover:underline">Team</Link>
          <span>/</span>
          <span className="text-slate-950 font-medium">Custom Roles</span>
        </nav>

        {!isOwner ? (
          <Card>
            <p role="alert" className="text-sm text-slate-700">
              Custom role management is restricted to owners.
            </p>
          </Card>
        ) : loading ? (
          <p className="text-sm text-slate-500" aria-busy="true">Loading…</p>
        ) : error ? (
          <Card>
            <p role="alert" className="text-sm text-red-700">{error}</p>
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Custom roles</h2>
                  <p className="text-sm text-slate-500">
                    {roles.length} {roles.length === 1 ? "role" : "roles"} defined
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setShowCreate(true); setActionError(null); }}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  + New role
                </button>
              </div>

              {actionError && (
                <div className="border-b border-red-100 bg-red-50 px-4 py-2">
                  <p className="text-sm text-red-700">{actionError}</p>
                </div>
              )}

              {roles.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <p className="text-sm text-slate-500">No custom roles yet.</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Create a role to assign a specific permission set to team members.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {roles.map((r) => (
                    <div key={r.id} className="flex items-start justify-between gap-4 px-4 py-4 hover:bg-slate-50 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-slate-950">{r.name}</h3>
                          <Badge variant="blue">{r.permissions.length} permissions</Badge>
                        </div>
                        {r.description && (
                          <p className="mt-0.5 text-sm text-slate-500 truncate">{r.description}</p>
                        )}
                        {/* Permission chips */}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {r.permissions.slice(0, 8).map((perm) => (
                            <span
                              key={perm}
                              className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                            >
                              {perm}
                            </span>
                          ))}
                          {r.permissions.length > 8 && (
                            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-400">
                              +{r.permissions.length - 8} more
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-xs text-slate-400">
                          Updated {formatDate(r.updatedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { setEditTarget(r); setActionError(null); }}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => { setDeleteTarget(r); setActionError(null); }}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Info callout */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="font-medium">Assigning roles: </span>
              Go to the{" "}
              <Link href="/team" className="text-blue-600 hover:underline">Team directory</Link>
              {" "}and select a member to assign a custom role.
            </div>
          </>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <RoleFormModal
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Edit modal */}
      {editTarget && (
        <RoleFormModal
          initial={editTarget}
          onSave={handleEdit}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-slate-950">Delete &ldquo;{deleteTarget.name}&rdquo;?</h2>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently remove the role. Any team members assigned to it will lose
              this permission set. This action cannot be undone.
            </p>
            {actionError && (
              <p className="mt-3 text-sm text-red-700">{actionError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete role"}
              </button>
            </div>
          </div>
        </div>
      )}
    </EnterpriseShell>
  );
}
