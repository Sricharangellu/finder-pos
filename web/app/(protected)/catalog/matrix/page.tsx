"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Skeleton } from "@/components/Skeleton";
import { apiGet, apiPatch, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney, parseToCents } from "@/lib/money";
import { hasRole } from "@/lib/auth";
import type { Product, ProductsResponse } from "@/api-client/types";

/**
 * Product Matrix Builder — a workspace to manage master products and their
 * variants inline (selling/cost price, online/active), with bulk selection and
 * a sticky bulk-actions toolbar. Wired to the existing catalog API; no separate
 * edit screen for common updates.
 */

type Group = { master: Product; variants: Product[] };

function StatusBadge({ status }: { status: string }) {
  const style =
    status === "active"
      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      : status === "draft"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${style}`}>{status}</span>;
}

function OnlineBadge({ online }: { online: boolean }) {
  return online ? (
    <span className="inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">Online</span>
  ) : (
    <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Offline</span>
  );
}

/** Inline money field — click to edit dollars, Enter/blur saves cents, Esc cancels. */
function EditableCents({ cents, canEdit, onSave }: { cents: number | null; canEdit: boolean; onSave: (cents: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!canEdit) return <span className="tabular-nums">{cents == null ? "—" : formatMoney(cents)}</span>;
  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(cents == null ? "" : (cents / 100).toFixed(2)); setEditing(true); }}
        className="rounded px-1 tabular-nums hover:bg-neutral-100 dark:hover:bg-neutral-800"
        aria-label="Edit price"
      >
        {cents == null ? "—" : formatMoney(cents)}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const next = parseToCents(draft);
    if (Number.isFinite(next) && next >= 0 && next !== cents) onSave(next);
  };
  return (
    <input
      autoFocus
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-20 rounded border border-neutral-300 bg-white px-1 py-0.5 text-right tabular-nums dark:border-neutral-600 dark:bg-neutral-900"
    />
  );
}

export default function ProductMatrixPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pct, setPct] = useState("");
  const [priceTarget, setPriceTarget] = useState<"selling" | "cost">("selling");
  const canManage = hasRole("manager");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<ProductsResponse>("/api/v1/catalog/?limit=200");
      setProducts(res.items ?? []);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Could not load products.");
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Group into master → variants, filtered by search, sorted by category then name.
  const groups = useMemo<Group[]>(() => {
    const byParent = new Map<string, Product[]>();
    for (const p of products) {
      if (p.parent_product_id) {
        const arr = byParent.get(p.parent_product_id) ?? [];
        arr.push(p);
        byParent.set(p.parent_product_id, arr);
      }
    }
    const q = search.trim().toLowerCase();
    const matches = (p: Product) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.variant_label ?? "").toLowerCase().includes(q);
    const out: Group[] = [];
    for (const p of products) {
      if (p.parent_product_id) continue; // variants handled under their master
      const variants = (byParent.get(p.id) ?? []).sort((a, b) => (a.variant_label ?? "").localeCompare(b.variant_label ?? "") || a.sku.localeCompare(b.sku));
      // Keep the group if the master or any variant matches the search.
      if (matches(p) || variants.some(matches)) out.push({ master: p, variants });
    }
    return out.sort((a, b) => a.master.category.localeCompare(b.master.category) || a.master.name.localeCompare(b.master.name));
  }, [products, search]);

  const allVariantIds = useMemo(() => groups.flatMap((g) => (g.variants.length ? g.variants.map((v) => v.id) : [g.master.id])), [groups]);

  // ── actions ────────────────────────────────────────────────────────────────
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); }
    catch (err) { setError(err instanceof ApiResponseError ? err.message : "Action failed."); }
    finally { setBusy(false); }
  }, [load]);

  const patchProduct = (id: string, update: Record<string, unknown>) => act(() => apiPatch(`/api/v1/catalog/${id}`, update));
  const bulkUpdate = (ids: string[], update: Record<string, unknown>) => act(() => apiPost("/api/v1/catalog/bulk-update", { ids, update }));

  const selectedIds = useMemo(() => [...selected], [selected]);
  const applyBulk = (update: Record<string, unknown>) => { if (selectedIds.length) void bulkUpdate(selectedIds, update).then(() => setSelected(new Set())); };

  // Bulk price/cost ops computed server-side (per product) via /catalog/bulk-price.
  const bulkPrice = (op: string, value?: number) => {
    if (!selectedIds.length) return;
    void act(() => apiPost("/api/v1/catalog/bulk-price", { ids: selectedIds, target: priceTarget, op, value }))
      .then(() => { setSelected(new Set()); setPct(""); });
  };
  const applyPct = () => {
    const p = Number(pct);
    if (!Number.isFinite(p) || p === 0) return;
    bulkPrice(p >= 0 ? "inc_pct" : "dec_pct", Math.abs(p));
  };

  // ── selection helpers ────────────────────────────────────────────────────────
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (g: Group, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      const ids = g.variants.length ? g.variants.map((v) => v.id) : [g.master.id];
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });
  const groupChecked = (g: Group) => {
    const ids = g.variants.length ? g.variants.map((v) => v.id) : [g.master.id];
    return ids.length > 0 && ids.every((id) => selected.has(id));
  };
  const allSelected = allVariantIds.length > 0 && allVariantIds.every((id) => selected.has(id));

  const rowActions = (p: Product) => (
    <div className="flex shrink-0 items-center gap-1">
      <Button size="sm" variant="link" disabled={busy || !canManage} onClick={() => patchProduct(p.id, { ecommerce: p.ecommerce !== 1 })}>
        {p.ecommerce === 1 ? "Take offline" : "Put online"}
      </Button>
      <Button size="sm" variant="link" disabled={busy || !canManage} onClick={() => patchProduct(p.id, { status: p.status === "active" ? "archived" : "active" })}>
        {p.status === "active" ? "Deactivate" : "Activate"}
      </Button>
    </div>
  );

  return (
    <EnterpriseShell active="catalog-matrix" title="Product Matrix" subtitle="Manage master products and variants — inline pricing, visibility, and bulk actions" contentClassName="overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 pb-24">
        {error && (
          <Card role="alert" className="border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">{error}</Card>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products, variants, SKUs…"
            aria-label="Search products"
            className="w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <button className="hover:underline" onClick={() => setExpanded(new Set(groups.map((g) => g.master.id)))}>Expand all</button>
            <span>·</span>
            <button className="hover:underline" onClick={() => setExpanded(new Set())}>Collapse all</button>
            {allVariantIds.length > 0 && (
              <>
                <span>·</span>
                <button className="hover:underline" onClick={() => setSelected(allSelected ? new Set() : new Set(allVariantIds))}>
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              </>
            )}
          </div>
        </div>

        {!canManage && <p className="text-xs text-neutral-500">You have read-only access — editing requires the manager role.</p>}

        {/* Matrix */}
        <Card className="overflow-hidden p-0">
          {!loaded ? (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-4 w-4" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-4 w-16" /><Skeleton className="h-5 w-14 rounded-full" />
                </div>
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-500">
              {search ? "No products match your search." : "No products yet. Create products in the Catalog."}
            </p>
          ) : (
            <div className="min-w-full overflow-x-auto">
              <div className="min-w-[720px]">
                {/* Header */}
                <div className="sticky top-0 z-10 grid grid-cols-[2fr_1fr_1fr_auto] items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                  <span>Product · SKU</span><span className="text-right">Sell</span><span className="text-right">Cost</span><span className="text-right">Status</span>
                </div>
                {groups.map((g) => {
                  const isOpen = expanded.has(g.master.id) || g.variants.length === 0;
                  const isStandalone = g.variants.length === 0;
                  return (
                    <div key={g.master.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                      {/* Master / standalone row */}
                      <div className="grid grid-cols-[2fr_1fr_1fr_auto] items-center gap-3 px-4 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <input type="checkbox" disabled={!canManage} checked={groupChecked(g)} onChange={(e) => toggleGroup(g, e.target.checked)} aria-label={`Select ${g.master.name}`} />
                          {!isStandalone ? (
                            <button onClick={() => setExpanded((s) => { const n = new Set(s); n.has(g.master.id) ? n.delete(g.master.id) : n.add(g.master.id); return n; })} className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-expanded={isOpen} aria-label={isOpen ? "Collapse" : "Expand"}>
                              {isOpen ? "▾" : "▸"}
                            </button>
                          ) : <span className="w-3 shrink-0" />}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{g.master.name}</p>
                            <p className="truncate text-xs text-neutral-500">
                              <span className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">{g.master.category}</span>
                              {isStandalone ? <> · {g.master.sku}</> : <> · {g.variants.length} variant{g.variants.length === 1 ? "" : "s"}</>}
                            </p>
                          </div>
                        </div>
                        {isStandalone ? (
                          <>
                            <div className="text-right"><EditableCents cents={g.master.price_cents} canEdit={canManage} onSave={(c) => patchProduct(g.master.id, { price_cents: c })} /></div>
                            <div className="text-right"><EditableCents cents={g.master.raw_cost_price_cents} canEdit={canManage} onSave={(c) => patchProduct(g.master.id, { raw_cost_price_cents: c })} /></div>
                            <div className="flex items-center justify-end gap-2"><OnlineBadge online={g.master.ecommerce === 1} /><StatusBadge status={g.master.status} />{rowActions(g.master)}</div>
                          </>
                        ) : (
                          <><span /><span /><span className="text-right text-xs text-neutral-400">master</span></>
                        )}
                      </div>

                      {/* Variant rows */}
                      {isOpen && !isStandalone && g.variants.map((v) => (
                        <div key={v.id} className="grid grid-cols-[2fr_1fr_1fr_auto] items-center gap-3 bg-neutral-50/60 px-4 py-2 pl-10 dark:bg-neutral-900/40">
                          <div className="flex min-w-0 items-center gap-2">
                            <input type="checkbox" disabled={!canManage} checked={selected.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Select ${v.name}`} />
                            <div className="min-w-0">
                              <p className="truncate text-sm">{v.variant_label || v.name}</p>
                              <p className="truncate text-xs text-neutral-500">{v.sku}{v.barcode ? ` · ${v.barcode}` : ""}</p>
                            </div>
                          </div>
                          <div className="text-right"><EditableCents cents={v.price_cents} canEdit={canManage} onSave={(c) => patchProduct(v.id, { price_cents: c })} /></div>
                          <div className="text-right"><EditableCents cents={v.raw_cost_price_cents} canEdit={canManage} onSave={(c) => patchProduct(v.id, { raw_cost_price_cents: c })} /></div>
                          <div className="flex items-center justify-end gap-2"><OnlineBadge online={v.ecommerce === 1} /><StatusBadge status={v.status} />{rowActions(v)}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Sticky bulk toolbar */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
            <Button size="sm" variant="secondary" disabled={busy || !canManage} onClick={() => applyBulk({ status: "active" })}>Activate</Button>
            <Button size="sm" variant="secondary" disabled={busy || !canManage} onClick={() => applyBulk({ status: "archived" })}>Deactivate</Button>
            <Button size="sm" variant="secondary" disabled={busy || !canManage} onClick={() => applyBulk({ ecommerce: true })}>Enable online</Button>
            <Button size="sm" variant="secondary" disabled={busy || !canManage} onClick={() => applyBulk({ ecommerce: false })}>Disable online</Button>
            <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
            <div className="flex items-center gap-1">
              <select
                aria-label="Price target"
                value={priceTarget}
                onChange={(e) => setPriceTarget(e.target.value as "selling" | "cost")}
                className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
              >
                <option value="selling">Sell</option>
                <option value="cost">Cost</option>
              </select>
              <input id="pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="±%" aria-label="Percent change" className="w-16 rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900" />
              <Button size="sm" disabled={busy || !canManage || !pct} onClick={applyPct}>Apply %</Button>
              <Button size="sm" variant="secondary" disabled={busy || !canManage} onClick={() => bulkPrice("round_99")}>Round .99</Button>
            </div>
            <Button size="sm" variant="link" disabled={busy} onClick={() => setSelected(new Set())} className="ml-auto">Clear</Button>
          </div>
        </div>
      )}
    </EnterpriseShell>
  );
}
