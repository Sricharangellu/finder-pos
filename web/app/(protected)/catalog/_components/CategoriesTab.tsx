"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/Card";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import type { Category, CategoriesResponse } from "@/api-client/types";

export function CategoriesTab() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const [newName, setNewName]         = useState("");
  const [newParent, setNewParent]     = useState("");
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editTarget, setEditTarget]     = useState<Category | null>(null);
  const [editName, setEditName]         = useState("");
  const [editSaving, setEditSaving]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting]         = useState(false);
  const [actionError, setActionError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<CategoriesResponse>("/api/v1/catalog/categories");
      setCategories(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load categories.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true); setCreateError(null);
    try {
      await apiPost("/api/v1/catalog/categories", { name: newName.trim(), parent_id: newParent || null });
      setNewName(""); setNewParent("");
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiResponseError ? err.message : "Create failed.");
    } finally { setCreating(false); }
  };

  const startEdit = (c: Category) => { setEditTarget(c); setEditName(c.name); setActionError(null); };

  const handleEditSave = async () => {
    if (!editTarget || !editName.trim()) return;
    setEditSaving(true); setActionError(null);
    try {
      await apiPatch(`/api/v1/catalog/categories/${editTarget.id}`, { name: editName.trim() });
      setEditTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiResponseError ? err.message : "Save failed.");
    } finally { setEditSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setActionError(null);
    try {
      await apiDelete(`/api/v1/catalog/categories/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiResponseError ? err.message : "Delete failed.");
    } finally { setDeleting(false); }
  };

  if (loading) return <TableSkeleton headers={["Name", "Products", "Sub-categories", ""]} rows={6} />;
  if (error)   return <p role="alert" className="py-6 text-sm text-red-700">{error}</p>;

  const roots    = categories.filter((c) => !c.parent_id);
  const children = categories.filter((c) => !!c.parent_id);

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Product categories</h2>
            <p className="text-sm text-slate-500">{categories.length} {categories.length === 1 ? "category" : "categories"}</p>
          </div>
        </div>

        {actionError && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2">
            <p className="text-sm text-red-700">{actionError}</p>
          </div>
        )}

        {categories.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">No categories yet. Add one below.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {roots.map((root) => {
              const subs = children.filter((c) => c.parent_id === root.id);
              return (
                <li key={root.id}>
                  {/* Root category row */}
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    {editTarget?.id === root.id ? (
                      <div className="flex flex-1 items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          className="min-h-[40px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                        />
                        <button type="button" onClick={handleEditSave} disabled={editSaving}
                          className="min-h-[40px] rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60">
                          {editSaving ? "..." : "Save"}
                        </button>
                        <button type="button" onClick={() => setEditTarget(null)}
                          className="min-h-[40px] rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
                      </div>
                    ) : (
                      <>
                        {/* Clickable name → category detail */}
                        <button
                          type="button"
                          onClick={() => router.push(`/catalog/categories/${root.id}`)}
                          className="flex flex-1 items-center gap-3 text-left"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600/10 text-sm font-bold text-brand-600">
                            {root.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900 hover:text-brand-600 transition-colors">{root.name}</p>
                            {subs.length > 0 && (
                              <p className="text-[11px] text-slate-400">{subs.length} sub-{subs.length === 1 ? "category" : "categories"}</p>
                            )}
                          </div>
                          {/* Product count badge */}
                          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                            {root.product_count ?? 0} products
                          </span>
                        </button>

                        <div className="flex shrink-0 gap-2">
                          <button type="button" onClick={() => startEdit(root)}
                            className="min-h-[32px] rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100">Edit</button>
                          <button type="button" onClick={() => { setDeleteTarget(root); setActionError(null); }}
                            className="min-h-[32px] rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Sub-category rows */}
                  {subs.map((sub) => (
                    <div key={sub.id} className="flex items-center gap-3 border-t border-slate-50 bg-slate-50/60 py-2 pl-14 pr-4 hover:bg-slate-100/60">
                      {editTarget?.id === sub.id ? (
                        <div className="flex flex-1 items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            className="min-h-[36px] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                          />
                          <button type="button" onClick={handleEditSave} disabled={editSaving}
                            className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60">
                            {editSaving ? "..." : "Save"}
                          </button>
                          <button type="button" onClick={() => setEditTarget(null)}
                            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => router.push(`/catalog/categories/${sub.id}`)}
                            className="flex flex-1 items-center gap-2 text-left"
                          >
                            <svg className="h-3.5 w-3.5 shrink-0 text-slate-300" viewBox="0 0 16 16" fill="none">
                              <path d="M2 4h4v8H2V4z" fill="currentColor" opacity=".3"/>
                              <path d="M7 8h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                            <span className="flex-1 text-sm text-slate-700 hover:text-brand-600 transition-colors">{sub.name}</span>
                            <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 border border-slate-200">
                              {sub.product_count ?? 0} products
                            </span>
                          </button>
                          <div className="flex shrink-0 gap-2">
                            <button type="button" onClick={() => startEdit(sub)}
                              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100">Edit</button>
                            <button type="button" onClick={() => { setDeleteTarget(sub); setActionError(null); }}
                              className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}

        {/* Add category form */}
        <form onSubmit={handleCreate} className="flex items-center gap-2 border-t border-slate-200 px-4 py-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New category name..."
            className="min-h-[40px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
          <select
            value={newParent}
            onChange={(e) => setNewParent(e.target.value)}
            className="min-h-[40px] rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
          >
            <option value="">No parent</option>
            {roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="min-h-[40px] rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {creating ? "Adding..." : "Add"}
          </button>
        </form>
        {createError && <p className="px-4 pb-2 text-xs text-red-700">{createError}</p>}
      </Card>

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-950">Delete &ldquo;{deleteTarget.name}&rdquo;?</h2>
            <p className="mt-2 text-sm text-slate-600">Products will not be deleted but will no longer be linked to this category.</p>
            {actionError && <p className="mt-3 text-sm text-red-700">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)}
                className="min-h-[40px] rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="min-h-[40px] rounded-md bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-60">
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
