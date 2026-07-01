"use client";

import { useEffect, useRef, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/api-client/client";
import { FEATURE_GROUPS, ALL_FEATURES } from "@/lib/features";
import type { CustomRole, RoleEntry } from "./_components/permissionsTypes";
import { BUILT_IN, BUILT_IN_ORDER } from "./_components/permissionsTypes";
import { NewRoleModal } from "./_components/NewRoleModal";
import { EditRoleModal } from "./_components/EditRoleModal";

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => !disabled && onChange(!enabled)}
      className={[
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5D5FEF] focus-visible:ring-offset-2",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        enabled ? "bg-[#5D5FEF]" : "bg-slate-200",
      ].join(" ")}
    >
      <span
        className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

// ── Role action menu ──────────────────────────────────────────────────────────

function RoleMenu({
  roleId,
  isCustom,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  roleId: string;
  isCustom: boolean;
  onDuplicate: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:text-slate-500 focus:outline-none"
        aria-label="Role actions"
      >
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          <button type="button" onClick={() => { onDuplicate(roleId); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
            Duplicate
          </button>
          {isCustom && (
            <>
              <button type="button" onClick={() => { onEdit(roleId); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                Rename
              </button>
              <button type="button" onClick={() => { onDelete(roleId); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
                Delete role
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Record<string, Set<string>>>({});
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [activeRoleId, setActiveRoleId] = useState<string>("manager");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [showNewRole, setShowNewRole] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleEntry | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{
      roles: Array<{ role: string; features: string[] }>;
      customRoles?: Array<{ id: string; name: string; description: string; color: string; features: string[] }>;
    }>("/api/v1/settings/permissions")
      .then((data) => {
        const perms: Record<string, Set<string>> = {};
        for (const r of data.roles) {
          perms[r.role] = new Set(r.features);
        }
        for (const id of BUILT_IN_ORDER) {
          if (!perms[id]) {
            perms[id] = id === "owner" || id === "admin" ? new Set(ALL_FEATURES) : new Set();
          }
        }
        for (const cr of data.customRoles ?? []) {
          perms[cr.id] = new Set(cr.features);
        }
        setPermissions(perms);
        setCustomRoles(
          data.customRoles?.map((cr) => ({ id: cr.id, name: cr.name, description: cr.description, color: cr.color })) ?? []
        );
      })
      .catch(() => {
        const perms: Record<string, Set<string>> = {};
        for (const id of BUILT_IN_ORDER) {
          perms[id] = id === "owner" || id === "admin" ? new Set(ALL_FEATURES) : new Set();
        }
        setPermissions(perms);
      })
      .finally(() => setLoading(false));
  }, []);

  const allRoles: RoleEntry[] = [
    ...BUILT_IN_ORDER.map((id) => ({ id, ...BUILT_IN[id] })),
    ...customRoles.map((cr) => ({ ...cr, custom: true })),
  ];

  const activeRole = allRoles.find((r) => r.id === activeRoleId);
  const isImmutable = !!activeRole?.immutable;
  const currentFeatures = permissions[activeRoleId] ?? new Set<string>();

  const toggleFeature = (featureId: string, on: boolean) => {
    setPermissions((prev) => {
      const next = new Set(prev[activeRoleId]);
      if (on) next.add(featureId);
      else next.delete(featureId);
      return { ...prev, [activeRoleId]: next };
    });
    setUnsaved(true);
    setSavedAt(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPatch<{ ok: boolean }>("/api/v1/settings/permissions", {
        roles: allRoles.map((r) => ({ role: r.id, features: [...(permissions[r.id] ?? new Set())] })),
      });
      setSavedAt(Date.now());
      setUnsaved(false);
    } catch { /* user can retry */ } finally { setSaving(false); }
  };

  const handleDuplicate = (sourceId: string) => {
    const source = allRoles.find((r) => r.id === sourceId);
    if (!source) return;
    const newId = `crl_${Date.now()}`;
    const newRole: CustomRole = { id: newId, name: `${source.name} (copy)`, description: source.description, color: source.color };
    void apiPost<{ id: string }>("/api/v1/settings/custom-roles", {
      name: newRole.name, description: newRole.description, color: newRole.color,
      features: [...(permissions[sourceId] ?? new Set())],
    }).then((r) => {
      newRole.id = r.id;
      setCustomRoles((prev) => [...prev, newRole]);
      setPermissions((prev) => ({ ...prev, [r.id]: new Set(permissions[sourceId]) }));
      setActiveRoleId(r.id);
    });
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/api/v1/settings/custom-roles/${id}`);
      setCustomRoles((prev) => prev.filter((r) => r.id !== id));
      setPermissions((prev) => { const next = { ...prev }; delete next[id]; return next; });
      if (activeRoleId === id) setActiveRoleId("manager");
    } catch { /* ignore */ } finally { setDeleteConfirm(null); }
  };

  const handleRoleCreated = (role: CustomRole, features: string[]) => {
    setCustomRoles((prev) => [...prev, role]);
    setPermissions((prev) => ({ ...prev, [role.id]: new Set(features) }));
    setActiveRoleId(role.id);
  };

  const handleRoleEdited = (id: string, patch: Pick<CustomRole, "name" | "description" | "color">) => {
    setCustomRoles((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
    void apiPatch(`/api/v1/settings/custom-roles/${id}`, patch);
  };

  if (loading) {
    return (
      <EnterpriseShell active="permissions" title="Role Permissions" subtitle="Configure access by role" contentClassName="overflow-hidden">
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#5D5FEF]" />
        </div>
      </EnterpriseShell>
    );
  }

  return (
    <EnterpriseShell
      active="permissions"
      title="Role Permissions"
      subtitle="Configure feature access per role — changes apply immediately on next sign-in"
      contentClassName="overflow-hidden"
    >
      <div className="flex h-full min-h-0">

        {/* ── Left: role list ───────────────────────────────────────────────── */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Roles</p>
            <button
              type="button"
              onClick={() => setShowNewRole(true)}
              className="flex items-center gap-1 rounded-md bg-[#5D5FEF] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#4849d0]"
              aria-label="Create custom role"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
              New role
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5">
            <div className="px-3 pb-1 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-300">Built-in</p>
            </div>
            {BUILT_IN_ORDER.map((roleId) => {
              const def = BUILT_IN[roleId];
              const featureCount = permissions[roleId]?.size ?? ALL_FEATURES.length;
              const isActive = activeRoleId === roleId;
              return (
                <div key={roleId} className="group relative flex items-center">
                  <button
                    type="button"
                    onClick={() => setActiveRoleId(roleId)}
                    className={`flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left transition-colors ${isActive ? "bg-[#5D5FEF]/8 text-[#111]" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${def.color}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-semibold ${isActive ? "text-[#5D5FEF]" : ""}`}>{def.name}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {def.immutable ? "Full access" : `${featureCount} permissions`}
                      </p>
                    </div>
                    {def.immutable && (
                      <svg className="h-3 w-3 shrink-0 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="Locked">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    )}
                  </button>
                  {!def.immutable && (
                    <div className="mr-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <RoleMenu roleId={roleId} isCustom={false} onDuplicate={handleDuplicate} onEdit={() => {}} onDelete={() => {}} />
                    </div>
                  )}
                </div>
              );
            })}

            {customRoles.length > 0 && (
              <>
                <div className="px-3 pb-1 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-300">Custom</p>
                </div>
                {customRoles.map((cr) => {
                  const featureCount = permissions[cr.id]?.size ?? 0;
                  const isActive = activeRoleId === cr.id;
                  return (
                    <div key={cr.id} className="group relative flex items-center">
                      <button
                        type="button"
                        onClick={() => setActiveRoleId(cr.id)}
                        className={`flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left transition-colors ${isActive ? "bg-[#5D5FEF]/8 text-[#111]" : "text-slate-600 hover:bg-slate-50"}`}
                      >
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cr.color}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className={`truncate text-sm font-semibold ${isActive ? "text-[#5D5FEF]" : ""}`}>{cr.name}</p>
                            <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-slate-400">Custom</span>
                          </div>
                          <p className="truncate text-[11px] text-slate-400">{featureCount} permissions</p>
                        </div>
                      </button>
                      <div className="mr-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <RoleMenu
                          roleId={cr.id}
                          isCustom={true}
                          onDuplicate={handleDuplicate}
                          onEdit={() => setEditingRole({ id: cr.id, name: cr.name, description: cr.description, color: cr.color, custom: true })}
                          onDelete={() => setDeleteConfirm(cr.id)}
                        />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </aside>

        {/* ── Right: feature toggles ────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {activeRole && (
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
              <div className="flex items-center gap-3">
                <span className={`h-3 w-3 rounded-full ${activeRole.color}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[#111]">{activeRole.name}</p>
                    {activeRole.custom && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-400">Custom</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{activeRole.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {unsaved && <span className="text-xs text-amber-600">Unsaved changes</span>}
                {savedAt && !unsaved && (
                  <span className="text-xs text-emerald-600">
                    Saved {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(savedAt))}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || isImmutable || !unsaved}
                  className="rounded-lg bg-[#5D5FEF] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0] disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}

          {isImmutable && (
            <div className="shrink-0 border-b border-[#5D5FEF]/10 bg-[#5D5FEF]/5 px-6 py-2.5">
              <p className="text-xs text-[#5D5FEF]">
                <strong>{activeRole?.name}</strong> always has full access and cannot be restricted.
              </p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              {FEATURE_GROUPS.map((group) => {
                const enabledInGroup = group.features.filter((f) => isImmutable || currentFeatures.has(f.id)).length;
                return (
                  <div key={group.label} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</h2>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-400">{enabledInGroup} / {group.features.length}</span>
                        {!isImmutable && (
                          <button
                            type="button"
                            onClick={() => {
                              const allOn = group.features.every((f) => currentFeatures.has(f.id));
                              group.features.forEach((f) => toggleFeature(f.id, !allOn));
                            }}
                            className="text-[11px] font-medium text-[#5D5FEF] hover:underline"
                          >
                            {group.features.every((f) => currentFeatures.has(f.id)) ? "Remove all" : "Add all"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="divide-y divide-slate-50">
                      {group.features.map((feature) => {
                        const enabled = isImmutable || currentFeatures.has(feature.id);
                        return (
                          <div key={feature.id} className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-[#FAFAFA]">
                            <div className="mr-4">
                              <p className={`text-sm font-medium ${enabled ? "text-[#111]" : "text-slate-400"}`}>{feature.label}</p>
                              <p className="text-xs text-slate-400">{feature.description}</p>
                            </div>
                            <Toggle enabled={enabled} onChange={(v) => toggleFeature(feature.id, v)} disabled={isImmutable} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="h-6" />
          </div>
        </div>
      </div>

      {showNewRole && (
        <NewRoleModal
          allRoles={allRoles}
          permissions={permissions}
          onClose={() => setShowNewRole(false)}
          onCreate={handleRoleCreated}
        />
      )}

      {editingRole && (
        <EditRoleModal
          role={editingRole}
          onClose={() => setEditingRole(null)}
          onSave={(patch) => { handleRoleEdited(editingRole.id, patch); setEditingRole(null); }}
        />
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <p className="font-semibold text-[#111]">Delete this role?</p>
            <p className="mt-1 text-sm text-slate-500">
              Employees assigned this role will retain their current access until reassigned. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={() => void handleDelete(deleteConfirm)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </EnterpriseShell>
  );
}
