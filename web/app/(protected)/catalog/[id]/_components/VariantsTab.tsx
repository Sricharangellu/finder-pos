"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiDelete, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { CatalogProduct } from "@/api-client/types";
import { VariantSetupWizard } from "./VariantSetupWizard";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Attribute {
  id: string;
  name: string;
  values: string[];
}

interface GeneratePayload {
  attributes: { name: string; values: string[] }[];
  exclude?: string[][];
}

const VARIANT_SEPARATOR = " "; // must match the backend VARIANT_SEPARATOR

function comboLabel(values: string[]): string {
  return values.join(VARIANT_SEPARATOR);
}

/** Order-independent key for a combination (matches the backend's valuesKey). */
function comboKey(values: string[]): string {
  return JSON.stringify(values.map((v) => v.trim().toLowerCase()).sort());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cartesian(arrays: string[][]): string[][] {
  return arrays.reduce<string[][]>(
    (acc, arr) => acc.flatMap((combo) => arr.map((v) => [...combo, v])),
    [[]],
  );
}

const STATUS_COLOR: Record<string, string> = {
  active:   "bg-emerald-100 text-emerald-700",
  draft:    "bg-amber-100 text-amber-700",
  archived: "bg-slate-100 text-slate-500",
};

const FLD = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#5D5FEF] focus:outline-none";

// ── Value chips input ──────────────────────────────────────────────────────────
// Enter-based value chips over the attribute's `values` array: type a value and
// press Enter to add a chip, click × or Backspace-on-empty to remove. Duplicates
// (case-insensitive) and empty values are ignored. No commas — each value is its
// own chip. Pasting multiple newline-separated values adds them all at once.
function ValueChipsInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = (incoming: string[]) => {
    const cleaned = incoming.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    const next = [...values];
    for (const t of cleaned) {
      if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
    }
    onChange(next);
  };

  const removeAt = (i: number) => onChange(values.filter((_, idx) => idx !== i));

  return (
    <div className="flex min-h-[2.5rem] w-full flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus-within:border-[#5D5FEF]">
      {values.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className="inline-flex items-center gap-1 rounded-md bg-[#5D5FEF]/10 px-2 py-0.5 text-xs font-medium text-[#5D5FEF]"
        >
          {t}
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-[#5D5FEF]/60 transition-colors hover:text-[#5D5FEF]"
            aria-label={`Remove ${t}`}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      <input
        className="min-w-[6rem] flex-1 border-0 bg-transparent p-0 text-sm focus:outline-none focus:ring-0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit([draft]); setDraft(""); }
          else if (e.key === "Backspace" && draft === "" && values.length > 0) { removeAt(values.length - 1); }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          // Only intercept multi-line pastes; a plain single value types normally.
          if (/[\n\r\t]/.test(text)) { e.preventDefault(); commit(text.split(/[\n\r\t]+/)); setDraft(""); }
        }}
        onBlur={() => { if (draft.trim()) { commit([draft]); setDraft(""); } }}
        placeholder={values.length === 0 ? placeholder : ""}
        aria-label="Add value"
      />
    </div>
  );
}

// ── Attribute row ─────────────────────────────────────────────────────────────

function AttrRow({
  attr,
  index,
  dragging,
  onName,
  onValues,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  attr: Attribute;
  index: number;
  dragging: boolean;
  onName: (id: string, name: string) => void;
  onValues: (id: string, values: string[]) => void;
  onRemove: (id: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-lg ${dragging ? "opacity-40" : ""}`}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      {/* Drag handle — reorders attributes, which drives variant naming order. */}
      <button
        type="button"
        draggable
        onDragStart={() => onDragStart(index)}
        onDragEnd={onDragEnd}
        className="mt-1.5 cursor-grab touch-none rounded p-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        aria-label={`Reorder ${attr.name || "attribute"}`}
        title="Drag to reorder"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 4a1 1 0 100 2 1 1 0 000-2zM7 9a1 1 0 100 2 1 1 0 000-2zM7 14a1 1 0 100 2 1 1 0 000-2zM13 4a1 1 0 100 2 1 1 0 000-2zM13 9a1 1 0 100 2 1 1 0 000-2zM13 14a1 1 0 100 2 1 1 0 000-2z" />
        </svg>
      </button>
      <div className="w-32">
        <input
          className={FLD}
          value={attr.name}
          onChange={(e) => onName(attr.id, e.target.value)}
          placeholder="e.g. Size"
        />
      </div>
      <div className="flex-1">
        <ValueChipsInput
          values={attr.values}
          onChange={(next) => onValues(attr.id, next)}
          placeholder="Type a value, press Enter (S ⏎ M ⏎ L ⏎)"
        />
      </div>
      <button
        type="button"
        onClick={() => onRemove(attr.id)}
        className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
        aria-label="Remove attribute"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── Link existing product modal ───────────────────────────────────────────────

function LinkProductModal({
  masterId,
  existingChildIds,
  onClose,
  onLinked,
}: {
  masterId: string;
  existingChildIds: Set<string>;
  onClose: () => void;
  onLinked: (children: CatalogProduct[]) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (term: string) => {
    if (!term.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await apiGet<{ items: CatalogProduct[] }>(`/api/v1/catalog?q=${encodeURIComponent(term)}&limit=20`);
      setResults(res.items.filter((p) => p.id !== masterId && !existingChildIds.has(p.id) && !p.parent_product_id));
    } catch { /* noop */ }
    finally { setSearching(false); }
  }, [masterId, existingChildIds]);

  const handleKey = (val: string) => {
    setQ(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void search(val), 300);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleLink = async () => {
    if (selected.size === 0) return;
    setLinking(true); setError(null);
    try {
      const res = await apiPost<{ items: CatalogProduct[] }>(`/api/v1/catalog/${masterId}/variants/assign`, {
        productIds: [...selected],
        label: label.trim() || null,
      });
      onLinked(res.items);
      onClose();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to link.");
    } finally { setLinking(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-[#111]">Link Existing Product as Variant</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/>
            </svg>
            <input
              autoFocus
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-[#5D5FEF] focus:outline-none"
              placeholder="Search products by name or SKU…"
              value={q}
              onChange={(e) => handleKey(e.target.value)}
            />
          </div>
          <div className="min-h-[120px] rounded-lg border border-slate-200">
            {searching ? (
              <p className="p-4 text-center text-sm text-slate-400">Searching…</p>
            ) : results.length === 0 ? (
              <p className="p-4 text-center text-sm text-slate-400">{q ? "No products found." : "Type to search."}</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {results.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-[#5D5FEF]"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#111]">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.sku} · {formatMoney(p.price_cents)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_COLOR[p.status] ?? ""}`}>
                      {p.status}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Variant Label (applies to all selected)
            </label>
            <input
              className={FLD}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Large, Red, 1L — optional"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleLink()}
            disabled={linking || selected.size === 0}
            className="rounded-lg bg-[#5D5FEF] px-5 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40"
          >
            {linking ? "Linking…" : `Link ${selected.size > 0 ? `${selected.size} ` : ""}Product${selected.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── VariantsTab ───────────────────────────────────────────────────────────────

export function VariantsTab({
  product,
}: {
  product: CatalogProduct;
}) {
  const router = useRouter();
  const [children, setChildren]       = useState<CatalogProduct[]>([]);
  const [loading, setLoading]         = useState(true);
  const [attrs, setAttrs]             = useState<Attribute[]>([{ id: "a1", name: "", values: [] }]);
  const [generating, setGenerating]   = useState(false);
  const [genError, setGenError]       = useState<string | null>(null);
  const [showLink, setShowLink]       = useState(false);
  const [unlinkId, setUnlinkId]       = useState<string | null>(null);
  const [showWizard, setShowWizard]   = useState(false);
  // Preview controls
  const [excluded, setExcluded]       = useState<Set<string>>(new Set()); // comboKey set
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewSort, setPreviewSort] = useState<"matrix" | "az">("matrix");
  // Attribute drag-and-drop
  const dragFrom = useRef<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const isChild = !!product.parent_product_id;

  const loadChildren = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ items: CatalogProduct[] }>(`/api/v1/catalog/${product.id}/variants`);
      setChildren(res.items);
    } catch { /* noop */ }
    finally { setLoading(false); }
  }, [product.id]);

  useEffect(() => { if (!isChild) void loadChildren(); else setLoading(false); }, [isChild, loadChildren]);

  // Attr helpers
  const addAttr = () =>
    setAttrs((prev) => [...prev, { id: `a${Date.now()}`, name: "", values: [] }]);

  const setAttrName = (id: string, name: string) =>
    setAttrs((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)));

  const setAttrValues = (id: string, values: string[]) =>
    setAttrs((prev) => prev.map((a) => (a.id === id ? { ...a, values } : a)));

  const removeAttr = (id: string) =>
    setAttrs((prev) => (prev.length > 1 ? prev.filter((a) => a.id !== id) : prev));

  // Reorder attributes via drag-and-drop — order drives variant naming order.
  const moveAttr = (from: number, to: number) =>
    setAttrs((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  // Matrix preview
  const validAttrs = attrs.filter((a) => a.name.trim() && a.values.length > 0);
  const combos = validAttrs.length > 0
    ? cartesian(validAttrs.map((a) => a.values))
    : [];

  // Preview list, with search + sort applied. Excluded combos stay visible (dimmed).
  const previewCombos = (() => {
    const term = previewSearch.trim().toLowerCase();
    let list = combos.map((values) => ({ values, key: comboKey(values), label: comboLabel(values) }));
    if (term) list = list.filter((c) => c.label.toLowerCase().includes(term));
    if (previewSort === "az") list = [...list].sort((a, b) => a.label.localeCompare(b.label));
    return list;
  })();
  const includedCount = combos.filter((v) => !excluded.has(comboKey(v))).length;

  const toggleExcluded = (key: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const handleGenerate = async () => {
    if (validAttrs.length === 0) { setGenError("Add at least one attribute with values."); return; }
    if (includedCount === 0) { setGenError("All combinations are excluded — include at least one."); return; }
    setGenerating(true); setGenError(null);
    try {
      const exclude = combos.filter((v) => excluded.has(comboKey(v)));
      const payload: GeneratePayload = {
        attributes: validAttrs.map((a) => ({ name: a.name.trim(), values: a.values })),
        ...(exclude.length ? { exclude } : {}),
      };
      const res = await apiPost<{ items: CatalogProduct[] }>(`/api/v1/catalog/${product.id}/variants/generate`, payload);
      setChildren(res.items);
      if (res.items.length > 0) setShowWizard(true); // guide SKU/UPC → pricing → categories
    } catch (e) {
      setGenError(e instanceof ApiResponseError ? e.message : "Generation failed.");
    } finally { setGenerating(false); }
  };

  const handleUnlink = async (childId: string) => {
    await apiDelete(`/api/v1/catalog/${product.id}/variants/${childId}`);
    setChildren((prev) => prev.filter((c) => c.id !== childId));
    setUnlinkId(null);
  };

  // ── CHILD VIEW ───────────────────────────────────────────────────────────────
  if (isChild) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-4 rounded-xl border border-[#5D5FEF]/20 bg-[#5D5FEF]/5 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#5D5FEF]/10">
            <svg className="h-5 w-5 text-[#5D5FEF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#5D5FEF]">This product is a variant</p>
            <p className="mt-0.5 text-sm text-slate-600">
              {product.variant_label
                ? <>Label: <span className="font-semibold text-[#111]">{product.variant_label}</span> · </>
                : null}
              It belongs to a master product.
            </p>
            <button
              type="button"
              onClick={() => router.push(`/catalog/${product.parent_product_id}`)}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#5D5FEF] hover:underline"
            >
              View master product →
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs text-slate-500">
            To manage this variant or change its label, go to the master product&apos;s Variants tab.
          </p>
        </div>
      </div>
    );
  }

  // ── MASTER VIEW ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Matrix builder */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[#111]">Generate Variants</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Define attributes and auto-generate all variant combinations.
            </p>
          </div>
          <span className="rounded-full border border-[#5D5FEF]/20 bg-[#5D5FEF]/5 px-2.5 py-0.5 text-xs font-semibold text-[#5D5FEF]">
            {includedCount === combos.length
              ? `${combos.length} combination${combos.length !== 1 ? "s" : ""}`
              : `${includedCount} of ${combos.length}`}
          </span>
        </div>

        <div className="space-y-3 px-5 py-4">
          {/* Column headers */}
          <div className="flex gap-2 pl-6 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <span className="w-32">Attribute</span>
            <span className="flex-1">Values</span>
          </div>

          {/* Attribute rows — drag the handle to reorder (drives naming order) */}
          {attrs.map((a, i) => (
            <AttrRow
              key={a.id}
              attr={a}
              index={i}
              dragging={dragIdx === i}
              onName={setAttrName}
              onValues={setAttrValues}
              onRemove={removeAttr}
              onDragStart={(idx) => { dragFrom.current = idx; setDragIdx(idx); }}
              onDragOver={(idx) => {
                if (dragFrom.current !== null && dragFrom.current !== idx) {
                  moveAttr(dragFrom.current, idx);
                  dragFrom.current = idx;
                  setDragIdx(idx);
                }
              }}
              onDrop={() => { dragFrom.current = null; setDragIdx(null); }}
              onDragEnd={() => { dragFrom.current = null; setDragIdx(null); }}
            />
          ))}

          <button
            type="button"
            onClick={addAttr}
            className="flex items-center gap-1.5 text-sm font-medium text-[#5D5FEF] hover:underline"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add attribute
          </button>

          {/* Combination preview — search, sort, and remove/disable before generating */}
          {combos.length > 0 && (
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Preview — {includedCount} of {combos.length} will be created
                </p>
                <div className="flex items-center gap-2">
                  <input
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    placeholder="Search…"
                    aria-label="Search combinations"
                    className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs focus:border-[#5D5FEF] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setPreviewSort((s) => (s === "az" ? "matrix" : "az"))}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    title="Toggle sort order"
                  >
                    Sort: {previewSort === "az" ? "A–Z" : "Matrix"}
                  </button>
                  {excluded.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setExcluded(new Set())}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Reset ({excluded.size})
                    </button>
                  )}
                </div>
              </div>
              {previewCombos.length === 0 ? (
                <p className="py-3 text-center text-xs text-slate-400">No combinations match “{previewSearch}”.</p>
              ) : (
                <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                  {previewCombos.map((c) => {
                    const off = excluded.has(c.key);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => toggleExcluded(c.key)}
                        title={off ? "Excluded — click to include" : "Included — click to exclude"}
                        aria-pressed={!off}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                          off
                            ? "border-slate-200 bg-slate-100 text-slate-400 line-through"
                            : "border-slate-200 bg-white text-slate-700 hover:border-[#5D5FEF]/40"
                        }`}
                      >
                        {c.label}
                        <span className={off ? "text-slate-400" : "text-slate-300"}>{off ? "+" : "×"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {genError && <p role="alert" className="text-sm text-red-600">{genError}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <p className="text-xs text-slate-400">
            Existing variants are kept. Only new combinations are added.
          </p>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || validAttrs.length === 0}
            className="rounded-lg bg-[#5D5FEF] px-5 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40 transition-colors"
          >
            {generating ? "Generating…" : "Generate Variants"}
          </button>
        </div>
      </div>

      {/* Variant list */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-[#111]">
            Variants
            {children.length > 0 && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {children.length}
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={() => setShowLink(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Link existing
          </button>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">{[1,2,3].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100"/>)}</div>
        ) : children.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <svg className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-sm text-slate-400">No variants yet.</p>
            <p className="text-xs text-slate-400">Use Generate Variants above or link an existing product.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Label</th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {children.map((child) => (
                  <tr
                    key={child.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => router.push(`/catalog/${child.id}`)}
                  >
                    <td className="px-4 py-3">
                      {child.variant_label ? (
                        <span className="rounded-full bg-[#5D5FEF]/10 px-2.5 py-0.5 text-xs font-semibold text-[#5D5FEF]">
                          {child.variant_label}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#111]">{child.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{child.sku}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatMoney(child.price_cents)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_COLOR[child.status] ?? ""}`}>
                        {child.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => router.push(`/catalog/${child.id}`)}
                          className="text-xs font-medium text-[#5D5FEF] hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setUnlinkId(child.id)}
                          className="text-xs font-medium text-red-500 hover:underline"
                        >
                          Unlink
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Setup wizard */}
      {showWizard && children.length > 0 && (
        <VariantSetupWizard
          master={product}
          variants={children}
          onClose={() => setShowWizard(false)}
          onSaved={(updated) => setChildren((prev) => prev.map((c) => updated.find((u) => u.id === c.id) ?? c))}
        />
      )}

      {/* Link modal */}
      {showLink && (
        <LinkProductModal
          masterId={product.id}
          existingChildIds={new Set(children.map((c) => c.id))}
          onClose={() => setShowLink(false)}
          onLinked={(all) => setChildren(all)}
        />
      )}

      {/* Unlink confirm */}
      {unlinkId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <p className="font-semibold text-[#111]">Unlink this variant?</p>
            <p className="mt-1 text-sm text-slate-500">
              The product will remain in your catalog but will no longer be linked to this master.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setUnlinkId(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={() => void handleUnlink(unlinkId)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                Unlink
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
