"use client";

import { useState } from "react";
import { apiPost, ApiResponseError } from "@/api-client/client";
import type { CustomRole, RoleEntry } from "./permissionsTypes";
import { COLOR_OPTIONS } from "./permissionsTypes";

export function NewRoleModal({
  allRoles,
  permissions,
  onClose,
  onCreate,
}: {
  allRoles: RoleEntry[];
  permissions: Record<string, Set<string>>;
  onClose: () => void;
  onCreate: (role: CustomRole, features: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLOR_OPTIONS[4]!);
  const [copyFrom, setCopyFrom] = useState<string>("cashier");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) { setError("Role name is required."); return; }
    setSaving(true); setError(null);
    const features = copyFrom ? [...(permissions[copyFrom] ?? new Set())] : [];
    try {
      const res = await apiPost<{ id: string }>("/api/v1/settings/custom-roles", {
        name: name.trim(), description: description.trim(), color, features,
      });
      onCreate({ id: res.id, name: name.trim(), description: description.trim(), color }, features);
      onClose();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to create role.");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-[#111]">Create Custom Role</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Role Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Floor Supervisor"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none" />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this role do?"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none" />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ${c} transition-transform ${color === c ? "scale-110 ring-2 ring-brand-600 ring-offset-2" : "hover:scale-105"}`}
                  aria-label={c} />
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Copy permissions from</label>
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none">
              <option value="">— Start empty —</option>
              {allRoles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">You can fine-tune permissions after creating the role.</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={() => void handleCreate()} disabled={saving}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40">
            {saving ? "Creating…" : "Create Role"}
          </button>
        </div>
      </div>
    </div>
  );
}
