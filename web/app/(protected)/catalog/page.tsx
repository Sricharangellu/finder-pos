"use client";

/**
 * /catalog — Product catalog management.
 * Two tabs: Products (filterable list, create/edit modal, archive)
 *           Categories (CRUD list).
 * Fetches GET /api/v1/catalog and /api/v1/catalog/categories.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { Product, ProductsResponse, Category, CategoriesResponse, ProductStatus, TaxClass } from "@/api-client/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const centsToDisplay = formatMoney;

function statusBadge(s: ProductStatus): "green" | "yellow" | "gray" {
  if (s === "active")   return "green";
  if (s === "draft")    return "yellow";
  return "gray";
}

function productStatusStyle(status: ProductStatus) {
  if (status === "active") {
    return {
      row: "border-l-success-500 bg-success-50/30 hover:bg-success-50/70",
      card: "border-l-success-500 bg-success-50/30",
      dot: "bg-success-500",
    };
  }
  if (status === "draft") {
    return {
      row: "border-l-warning-500 bg-warning-50/30 hover:bg-warning-50/70",
      card: "border-l-warning-500 bg-warning-50/30",
      dot: "bg-warning-500",
    };
  }
  return {
    row: "border-l-slate-300 bg-slate-50/70 text-slate-500 hover:bg-slate-100",
    card: "border-l-slate-300 bg-slate-50/80",
    dot: "bg-slate-400",
  };
}

function metricToneClass(tone: "neutral" | "success" | "warning" | "muted" | "restricted") {
  const tones = {
    neutral: "border-slate-200 bg-white",
    success: "border-success-200 bg-success-50",
    warning: "border-warning-200 bg-warning-50",
    muted: "border-slate-200 bg-slate-50",
    restricted: "border-orange-200 bg-orange-50",
  };
  return tones[tone];
}

// ── Product Form Modal ────────────────────────────────────────────────────────

interface ProductFormState {
  name: string;
  sku: string;
  price_cents: string;
  category: string;
  barcode: string;
  tax_class: TaxClass;
  status: ProductStatus;
  brand: string;
  description: string;
  msrp_cents: string;
  raw_cost_price_cents: string;
  age_restricted: boolean;
  track_inventory: boolean;
}

function emptyForm(): ProductFormState {
  return {
    name: "", sku: "", price_cents: "", category: "",
    barcode: "", tax_class: "standard", status: "draft",
    brand: "", description: "", msrp_cents: "", raw_cost_price_cents: "",
    age_restricted: false, track_inventory: true,
  };
}

function productToForm(p: Product): ProductFormState {
  return {
    name: p.name, sku: p.sku,
    price_cents: (p.price_cents / 100).toFixed(2),
    category: p.category, barcode: p.barcode ?? "",
    tax_class: p.tax_class, status: p.status,
    brand: p.brand ?? "", description: p.description ?? "",
    msrp_cents: p.msrp_cents != null ? (p.msrp_cents / 100).toFixed(2) : "",
    raw_cost_price_cents: p.raw_cost_price_cents != null ? (p.raw_cost_price_cents / 100).toFixed(2) : "",
    age_restricted: p.age_restricted === 1,
    track_inventory: p.track_inventory === 1,
  };
}

function formToBody(f: ProductFormState): Record<string, unknown> {
  return {
    name: f.name.trim(),
    sku:  f.sku.trim(),
    price_cents: Math.round(parseFloat(f.price_cents) * 100),
    category: f.category.trim() || "Uncategorized",
    barcode: f.barcode.trim() || null,
    tax_class: f.tax_class,
    status: f.status,
    brand: f.brand.trim() || null,
    description: f.description.trim() || null,
    msrp_cents: f.msrp_cents ? Math.round(parseFloat(f.msrp_cents) * 100) : null,
    raw_cost_price_cents: f.raw_cost_price_cents ? Math.round(parseFloat(f.raw_cost_price_cents) * 100) : null,
    age_restricted: f.age_restricted,
    track_inventory: f.track_inventory,
  };
}

function ProductFormModal({
  initial,
  categories,
  onSave,
  onClose,
}: {
  initial?: Product;
  categories: Category[];
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ProductFormState>(initial ? productToForm(initial) : emptyForm());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof ProductFormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr("Product name is required."); return; }
    if (!form.sku.trim())  { setErr("SKU is required."); return; }
    const price = parseFloat(form.price_cents);
    if (!Number.isFinite(price) || price < 0) { setErr("Price must be a valid number."); return; }
    setSaving(true); setErr(null);
    try {
      await onSave(formToBody(form));
      onClose();
    } catch (ex) {
      setErr(ex instanceof ApiResponseError ? ex.message : "Save failed.");
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-600";
  const labelCls = "mb-1 block text-sm font-medium text-slate-700";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-md bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            {initial ? "Edit product" : "New product"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close product form" className="flex h-9 w-9 items-center justify-center rounded-md text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600">&times;</button>
        </div>

        {/* Body */}
        <form id="product-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4">
          {err && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Product name" className={inputCls} required />
            </div>

            <div>
              <label className={labelCls}>SKU <span className="text-red-500">*</span></label>
              <input type="text" value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="BEV-001" className={inputCls} required />
            </div>

            <div>
              <label className={labelCls}>Barcode</label>
              <input type="text" value={form.barcode} onChange={(e) => set("barcode", e.target.value)} placeholder="012345678901" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Sell price ($) <span className="text-red-500">*</span></label>
              <input type="number" step="0.01" min="0" value={form.price_cents} onChange={(e) => set("price_cents", e.target.value)} placeholder="0.00" className={inputCls} required />
            </div>

            <div>
              <label className={labelCls}>MSRP ($)</label>
              <input type="number" step="0.01" min="0" value={form.msrp_cents} onChange={(e) => set("msrp_cents", e.target.value)} placeholder="0.00" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Cost price ($)</label>
              <input type="number" step="0.01" min="0" value={form.raw_cost_price_cents} onChange={(e) => set("raw_cost_price_cents", e.target.value)} placeholder="0.00" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Category</label>
              {categories.length > 0 ? (
                <select value={form.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>
                  <option value="">— Select category —</option>
                  {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              ) : (
                <input type="text" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Beverages" className={inputCls} />
              )}
            </div>

            <div>
              <label className={labelCls}>Tax class</label>
              <select value={form.tax_class} onChange={(e) => set("tax_class", e.target.value as TaxClass)} className={inputCls}>
                <option value="standard">Standard</option>
                <option value="exempt">Tax exempt</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={(e) => set("status", e.target.value as ProductStatus)} className={inputCls}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>Brand</label>
              <input type="text" value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Brand name" className={inputCls} />
            </div>

            <div className="sm:col-span-2">
              <label className={labelCls}>Description</label>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} placeholder="Short product description" className={`${inputCls} resize-none`} />
            </div>

            <div className="sm:col-span-2 flex flex-wrap gap-5">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.age_restricted} onChange={(e) => set("age_restricted", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Age restricted
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.track_inventory} onChange={(e) => set("track_inventory", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Track inventory
              </label>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="min-h-[40px] rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" form="product-form" disabled={saving} className="min-h-[40px] rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {saving ? "Saving..." : initial ? "Save changes" : "Create product"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Products Tab ──────────────────────────────────────────────────────────────

// ── Print Labels ──────────────────────────────────────────────────────────────

const formatMoneyHTML = formatMoney;

function printLabels(products: Product[]) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>Labels</title><style>
    body { margin: 0; font-family: monospace; }
    .sheet { display: grid; grid-template-columns: repeat(4, 2in); gap: 0.125in; padding: 0.25in; }
    .label { width: 2in; height: 1in; border: 1px solid #ccc; padding: 4px; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
    .name { font-size: 9px; font-weight: bold; line-height: 1.2; }
    .sku { font-size: 7px; color: #888; }
    .barcode-box { flex: 1; background: #f3f3f3; margin: 2px 0; display: flex; align-items: center; justify-content: center; font-size: 6px; color: #555; }
    .price { font-size: 13px; font-weight: bold; text-align: right; }
    @media print { @page { margin: 0.25in; } }
  </style></head><body><div class="sheet">${products.map(p => `
    <div class="label">
      <div class="name">${p.name}</div>
      <div class="sku">${p.sku}</div>
      <div class="barcode-box">${p.barcode ?? p.sku}</div>
      <div class="price">${formatMoneyHTML(p.price_cents)}</div>
    </div>`).join("")}</div><script>window.onload=()=>{window.print();window.close();}<\/script></body></html>`);
  win.document.close();
}

function PrintLabelsModal({
  selected,
  onClose,
}: {
  selected: Product[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-md bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Print Labels</h2>
          <button type="button" onClick={onClose} aria-label="Close print labels" className="flex h-9 w-9 items-center justify-center rounded-md text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {selected.length === 0 ? (
            <p className="text-sm text-slate-500">Select products first using the checkboxes.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">{selected.length} product{selected.length !== 1 ? "s" : ""} selected for printing:</p>
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {selected.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-950">{p.name}</p>
                      <p className="font-mono text-xs text-slate-500">{p.sku}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-950">{formatMoneyHTML(p.price_cents)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="min-h-[40px] rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => { printLabels(selected); onClose(); }}
            className="min-h-[40px] rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Print
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === "," && !inQ) { cells.push(cur); cur = ""; continue; }
      cur += c;
    }
    cells.push(cur);
    return cells.map(s => s.trim());
  };
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(line => {
    const vals = parseRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
  return { headers, rows };
}

// ── Import CSV Modal ───────────────────────────────────────────────────────────

interface ImportResult { imported: number; skipped: number; errors: Array<{ row: number; message: string }> }

function ImportCSVModal({
  onDone, onClose,
}: {
  onDone: () => Promise<void>; onClose: () => void;
}) {
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const REQUIRED = ["name", "sku", "price"];

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setParseError(null); setParsed(null); setResult(null);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      try {
        const data = parseCSV(text);
        if (data.rows.length === 0) { setParseError("File has no data rows."); return; }
        const missing = REQUIRED.filter(h => !data.headers.some(dh => dh.toLowerCase() === h));
        if (missing.length > 0) { setParseError(`Missing required columns: ${missing.join(", ")}`); return; }
        setParsed(data);
      } catch { setParseError("Could not parse the CSV file."); }
    };
    reader.readAsText(f);
  };

  const handleImport = async () => {
    if (!parsed) return;
    setImporting(true);
    try {
      const r = await apiPost<ImportResult>("/api/v1/catalog/import-csv", { rows: parsed.rows });
      setResult(r);
      await onDone();
    } catch { setParseError("Import failed. Please try again."); }
    finally { setImporting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-md bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Import products from CSV</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-md text-xl text-slate-400 hover:bg-slate-100">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!result ? (
            <>
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                <p className="mb-1 text-sm font-semibold text-slate-700">Upload a CSV file</p>
                <p className="mb-3 text-xs text-slate-400">
                  Required: <code className="font-mono">name, sku, price</code><br />
                  Optional: <code className="font-mono">category, brand, barcode, cost, tax_class, description</code>
                </p>
                <input type="file" accept=".csv,text/csv" onChange={handleFile}
                  className="mx-auto block text-sm text-slate-600 file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-1 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50" />
              </div>

              {parseError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{parseError}</p>
              )}

              {parsed && (
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">
                    Preview — {parsed.rows.length} row{parsed.rows.length !== 1 ? "s" : ""} detected
                  </p>
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-left">
                          {parsed.headers.map(h => <th key={h} className="px-3 py-2 font-semibold text-slate-500">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsed.rows.slice(0, 8).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            {parsed.headers.map(h => (
                              <td key={h} className="max-w-[140px] truncate px-3 py-1.5 text-slate-700">{row[h] ?? ""}</td>
                            ))}
                          </tr>
                        ))}
                        {parsed.rows.length > 8 && (
                          <tr>
                            <td colSpan={parsed.headers.length} className="px-3 py-2 text-center text-slate-400">
                              +{parsed.rows.length - 8} more rows…
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-md bg-green-50 p-4">
                  <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                  <p className="text-xs text-green-600 mt-0.5">Imported</p>
                </div>
                <div className="rounded-md bg-slate-50 p-4">
                  <p className="text-2xl font-bold text-slate-700">{result.skipped}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Skipped</p>
                </div>
                <div className="rounded-md bg-red-50 p-4">
                  <p className="text-2xl font-bold text-red-700">{result.errors.length}</p>
                  <p className="text-xs text-red-600 mt-0.5">Errors</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  <p className="mb-1 text-xs font-semibold text-red-700">Row errors:</p>
                  <ul className="space-y-0.5 text-xs text-red-600">
                    {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
                  </ul>
                </div>
              )}
              {result.imported > 0 && (
                <p className="text-sm text-green-700">
                  {result.imported} product{result.imported !== 1 ? "s" : ""} imported as &ldquo;Draft&rdquo; — activate them from the catalog list.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose}
            className="min-h-[40px] rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button type="button" disabled={!parsed || importing} onClick={() => void handleImport()}
              className="min-h-[40px] rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {importing ? "Importing…" : `Import ${parsed?.rows.length ?? 0} products`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sort column header ────────────────────────────────────────────────────────

function SortTh({
  col, label, cur, dir, onSort, right = false,
}: {
  col: string; label: string; cur: string; dir: "asc" | "desc";
  onSort: (c: string) => void; right?: boolean;
}) {
  const active = cur === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={clsx(
        "cursor-pointer select-none px-4 py-3 hover:text-slate-800",
        right && "text-right",
      )}
    >
      <span className={clsx("inline-flex items-center gap-0.5", right && "w-full justify-end")}>
        {label}
        <span className={clsx("text-[10px]", active ? "text-brand-600" : "text-slate-300")}>
          {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
    </th>
  );
}

// ── Bulk action bar ───────────────────────────────────────────────────────────

function BulkActionBar({
  count, categories, onApply, onClear, loading, error,
}: {
  count: number; categories: Category[];
  onApply: (field: string, value: string) => void;
  onClear: () => void; loading: boolean; error: string | null;
}) {
  const [field, setField] = useState("");
  const [value, setValue] = useState("");

  const VALUE_OPTIONS: Record<string, { value: string; label: string }[]> = {
    status:    [
      { value: "active",   label: "Active" },
      { value: "draft",    label: "Draft" },
      { value: "archived", label: "Archived" },
    ],
    category:  categories.map(c => ({ value: c.name, label: c.name })),
    tax_class: [
      { value: "standard", label: "Standard" },
      { value: "exempt",   label: "Tax exempt" },
    ],
    age_restricted: [
      { value: "true",  label: "Restricted (18+)" },
      { value: "false", label: "Not restricted" },
    ],
  };

  const canApply = field && value && !loading;

  return (
    <div className="border-b border-brand-200 bg-brand-50 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-brand-800">
          {count} product{count !== 1 ? "s" : ""} selected
        </span>
        <span className="text-brand-300 text-xs">|</span>
        <select
          value={field}
          onChange={e => { setField(e.target.value); setValue(""); }}
          className="rounded-md border border-brand-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Set field…</option>
          <option value="status">Status</option>
          <option value="category">Category</option>
          <option value="tax_class">Tax class</option>
          <option value="age_restricted">Age restriction</option>
        </select>
        {field && (
          <select
            value={value}
            onChange={e => setValue(e.target.value)}
            className="rounded-md border border-brand-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Choose value…</option>
            {(VALUE_OPTIONS[field] ?? []).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          disabled={!canApply}
          onClick={() => { if (canApply) { onApply(field, value); setValue(""); setField(""); } }}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {loading ? "Updating…" : "Apply to selected"}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto text-xs font-medium text-brand-700 hover:underline"
        >
          Clear selection
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

// ── Products Tab ──────────────────────────────────────────────────────────────

function ProductsTab({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [products, setProducts]     = useState<Product[]>([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  // Server-side filters
  const [filterStatus, setFilterStatus]     = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [search, setSearch]                 = useState<string>("");
  const [debouncedQ, setDebouncedQ]         = useState<string>("");

  // Client-side filters (applied after fetch)
  const [filterTaxClass, setFilterTaxClass]         = useState<string>("");
  const [filterBrand, setFilterBrand]               = useState<string>("");
  const [filterAgeRestricted, setFilterAgeRestricted] = useState<boolean>(false);
  const [priceMin, setPriceMin]                     = useState<string>("");
  const [priceMax, setPriceMax]                     = useState<string>("");
  const [showMoreFilters, setShowMoreFilters]        = useState<boolean>(false);

  // Sort
  const [sortCol, setSortCol] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showPrintLabels, setShowPrintLabels] = useState(false);

  // Bulk update
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError]     = useState<string | null>(null);

  // Import / export
  const [showImport, setShowImport]       = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [duplicating, setDuplicating]     = useState<string | null>(null);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [archiving, setArchiving]   = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Derived counts (from raw API results)
  const activeCount     = products.filter(p => p.status === "active").length;
  const draftCount      = products.filter(p => p.status === "draft").length;
  const archivedCount   = products.filter(p => p.status === "archived").length;
  const restrictedCount = products.filter(p => p.age_restricted === 1).length;

  const hasFilters = Boolean(
    filterStatus || filterCategory || debouncedQ ||
    filterTaxClass || filterBrand || filterAgeRestricted || priceMin || priceMax,
  );

  const filterSummary = [
    filterStatus         ? `Status: ${filterStatus}`        : null,
    filterCategory       ? `Category: ${filterCategory}`    : null,
    debouncedQ           ? `Search: "${debouncedQ}"`        : null,
    filterTaxClass       ? `Tax: ${filterTaxClass}`         : null,
    filterBrand          ? `Brand: "${filterBrand}"`        : null,
    filterAgeRestricted  ? "Age restricted only"            : null,
    priceMin && priceMax ? `Price: $${priceMin}–$${priceMax}` : priceMin ? `Price ≥ $${priceMin}` : priceMax ? `Price ≤ $${priceMax}` : null,
  ].filter(Boolean);

  const clearFilters = () => {
    setFilterStatus(""); setFilterCategory(""); setSearch(""); setDebouncedQ("");
    setFilterTaxClass(""); setFilterBrand(""); setFilterAgeRestricted(false);
    setPriceMin(""); setPriceMax("");
  };

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Client-side filter + sort applied after API fetch
  const visibleProducts = useMemo<Product[]>(() => {
    let result = products;
    if (filterTaxClass)      result = result.filter(p => p.tax_class === filterTaxClass);
    if (filterBrand)         result = result.filter(p => (p.brand ?? "").toLowerCase().includes(filterBrand.toLowerCase()));
    if (filterAgeRestricted) result = result.filter(p => p.age_restricted === 1);
    if (priceMin)            result = result.filter(p => p.price_cents >= parseFloat(priceMin) * 100);
    if (priceMax)            result = result.filter(p => p.price_cents <= parseFloat(priceMax) * 100);
    return [...result].sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortCol) {
        case "price_cents": av = a.price_cents; bv = b.price_cents; break;
        case "sku":         av = a.sku.toLowerCase(); bv = b.sku.toLowerCase(); break;
        case "category":    av = a.category.toLowerCase(); bv = b.category.toLowerCase(); break;
        case "status":      av = a.status; bv = b.status; break;
        default:            av = a.name.toLowerCase(); bv = b.name.toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ?  1 : -1;
      return 0;
    });
  }, [products, filterTaxClass, filterBrand, filterAgeRestricted, priceMin, priceMax, sortCol, sortDir]);

  const selectedProducts = visibleProducts.filter(p => selectedIds.has(p.id));
  const allSelected      = visibleProducts.length > 0 && visibleProducts.every(p => selectedIds.has(p.id));
  const someSelected     = selectedIds.size > 0;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set<string>());
    } else {
      setSelectedIds(new Set<string>(visibleProducts.map(p => p.id)));
    }
  };

  function handleSort(col: string) {
    if (col === sortCol) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (filterStatus)   params.set("status",   filterStatus);
      if (filterCategory) params.set("category", filterCategory);
      if (debouncedQ)     params.set("q",        debouncedQ);
      const data = await apiGet<ProductsResponse>(`/api/v1/catalog?${params}`);
      setProducts(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load products.");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterCategory, debouncedQ]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (body: Record<string, unknown>) => {
    await apiPost("/api/v1/catalog", body);
    await load();
  };

  const handleEdit = async (body: Record<string, unknown>) => {
    if (!editTarget) return;
    await apiPatch(`/api/v1/catalog/${editTarget.id}`, body);
    await load();
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true); setActionError(null);
    try {
      await apiDelete(`/api/v1/catalog/${archiveTarget.id}`);
      setArchiveTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiResponseError ? err.message : "Archive failed.");
    } finally {
      setArchiving(false);
    }
  };

  const handleBulkUpdate = async (field: string, value: string) => {
    setBulkLoading(true); setBulkError(null);
    try {
      const parsed = field === "age_restricted" ? value === "true" : value;
      await Promise.all([...selectedIds].map(id =>
        apiPatch(`/api/v1/catalog/${id}`, { [field]: parsed }),
      ));
      setSelectedIds(new Set());
      await load();
    } catch {
      setBulkError("Some updates failed — check individual products.");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleExportCSV = () => {
    const headers = ["SKU", "Name", "Brand", "Category", "Price ($)", "Cost ($)", "MSRP ($)", "Tax Class", "Status", "Barcode", "Age Restricted"];
    const rows = visibleProducts.map(p => [
      p.sku, p.name, p.brand ?? "", p.category,
      (p.price_cents / 100).toFixed(2),
      p.raw_cost_price_cents != null ? (p.raw_cost_price_cents / 100).toFixed(2) : "",
      p.msrp_cents != null ? (p.msrp_cents / 100).toFixed(2) : "",
      p.tax_class, p.status, p.barcode ?? "",
      p.age_restricted === 1 ? "yes" : "no",
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `catalog-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDuplicate = async (id: string) => {
    setDuplicating(id);
    try {
      await apiPost(`/api/v1/catalog/${id}/duplicate`, {});
      await load();
    } catch { /* silent — row button reverts visually */ }
    finally { setDuplicating(null); }
  };

  return (
    <>
      <Card className="overflow-hidden p-0">
        {/* Metrics */}
        <div className="grid gap-2 border-b border-slate-200 bg-slate-100 p-3 sm:grid-cols-4">
          <CatalogMetric label="Visible products" value={visibleProducts.length} helper={`${total} total`} tone={hasFilters ? "neutral" : "muted"} active={hasFilters} />
          <CatalogMetric label="Active"           value={activeCount}            helper={`${draftCount} draft`}    tone="success"     active={filterStatus === "active"} />
          <CatalogMetric label="Archived"         value={archivedCount}          helper="Hidden from sale"          tone="muted"       active={filterStatus === "archived"} />
          <CatalogMetric label="Age restricted"   value={restrictedCount}        helper="ID check needed"           tone="restricted"  active={restrictedCount > 0} />
        </div>

        {/* Primary toolbar */}
        <div className="grid gap-3 border-b border-slate-200 px-4 py-3 lg:grid-cols-[minmax(220px,1fr)_auto_auto_auto_auto_auto_auto]">
          <div className="min-w-0">
            <label htmlFor="catalog-search" className="sr-only">Search products</label>
            <input
              id="catalog-search"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, SKU, barcode…"
              className="min-h-[40px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-500 sm:min-w-[140px]">
            Status
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="min-h-[40px] rounded-md border border-slate-200 px-2 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-500 sm:min-w-[160px]">
            Category
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              className="min-h-[40px] rounded-md border border-slate-200 px-2 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600">
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setShowMoreFilters(v => !v)}
            className={clsx(
              "min-h-[40px] self-end rounded-md border px-3 py-2 text-sm font-medium transition-colors",
              showMoreFilters
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-slate-200 text-slate-700 hover:bg-slate-50",
            )}
          >
            {showMoreFilters ? "▲ Filters" : "▼ Filters"}
            {(filterTaxClass || filterBrand || filterAgeRestricted || priceMin || priceMax) && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[10px] text-white">
                {[filterTaxClass, filterBrand, filterAgeRestricted, priceMin || priceMax].filter(Boolean).length}
              </span>
            )}
          </button>
          {/* ⋯ actions dropdown */}
          <div className="relative self-end">
            <button
              type="button"
              onClick={() => setShowActionsMenu(v => !v)}
              className="min-h-[40px] rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              aria-label="More actions"
            >
              ⋯
            </button>
            {showActionsMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowActionsMenu(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
                  <button type="button"
                    onClick={() => { handleExportCSV(); setShowActionsMenu(false); }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">
                    ↓ Export CSV
                  </button>
                  <button type="button"
                    onClick={() => { setShowImport(true); setShowActionsMenu(false); }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">
                    ↑ Import CSV
                  </button>
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={() => setShowPrintLabels(true)}
            className="min-h-[40px] self-end rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Labels{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
          </button>
          <button type="button" onClick={() => { setShowCreate(true); setActionError(null); }}
            className="min-h-[40px] self-end rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            + New product
          </button>
        </div>

        {/* Expanded filter panel */}
        {showMoreFilters && (
          <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Tax class
              <select value={filterTaxClass} onChange={e => setFilterTaxClass(e.target.value)}
                className="min-h-[36px] rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600">
                <option value="">All tax classes</option>
                <option value="standard">Standard</option>
                <option value="exempt">Tax exempt</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Brand
              <input type="text" value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
                placeholder="e.g. Acme"
                className="min-h-[36px] rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600" />
            </label>
            <div className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Price range ($)
              <div className="flex items-center gap-1.5">
                <input type="number" min="0" step="0.01" value={priceMin} onChange={e => setPriceMin(e.target.value)}
                  placeholder="Min"
                  className="min-h-[36px] w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600" />
                <span className="shrink-0 text-slate-400">–</span>
                <input type="number" min="0" step="0.01" value={priceMax} onChange={e => setPriceMax(e.target.value)}
                  placeholder="Max"
                  className="min-h-[36px] w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600" />
              </div>
            </div>
            <div className="flex flex-col justify-end gap-1 text-xs font-medium text-slate-500">
              Age restriction
              <label className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm">
                <input type="checkbox" checked={filterAgeRestricted} onChange={e => setFilterAgeRestricted(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                <span className="text-slate-700">Age restricted only</span>
              </label>
            </div>
          </div>
        )}

        {/* Bulk action bar */}
        {someSelected && (
          <BulkActionBar
            count={selectedIds.size}
            categories={categories}
            onApply={handleBulkUpdate}
            onClear={() => setSelectedIds(new Set())}
            loading={bulkLoading}
            error={bulkError}
          />
        )}

        {actionError && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2">
            <p className="text-sm text-red-700">{actionError}</p>
          </div>
        )}

        {/* Active-filter pills */}
        {hasFilters && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-brand-50 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-700">Filtered</span>
            {filterSummary.map(label => (
              <span key={label} className="rounded-full border border-brand-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-700">
                {label}
              </span>
            ))}
            <button type="button" onClick={clearFilters} className="ml-auto text-xs font-medium text-brand-700 hover:underline">
              Clear all
            </button>
          </div>
        )}

        {loading ? (
          <TableSkeleton headers={["", "Product", "SKU", "Category", "Price", "Status", ""]} rows={8} />
        ) : error ? (
          <div className="px-4 py-6">
            <p role="alert" className="text-sm text-red-700">{error}</p>
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">No products found.</p>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="mt-2 text-xs text-brand-600 hover:underline">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <th className="px-4 py-3">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                        aria-label="Select all products" className="h-4 w-4 rounded border-slate-300" />
                    </th>
                    <SortTh col="name"        label="Product"  cur={sortCol} dir={sortDir} onSort={handleSort} />
                    <SortTh col="sku"         label="SKU"      cur={sortCol} dir={sortDir} onSort={handleSort} />
                    <SortTh col="category"    label="Category" cur={sortCol} dir={sortDir} onSort={handleSort} />
                    <SortTh col="price_cents" label="Price"    cur={sortCol} dir={sortDir} onSort={handleSort} right />
                    <SortTh col="status"      label="Status"   cur={sortCol} dir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleProducts.map(p => {
                    const style = productStatusStyle(p.status);
                    const isSelected = selectedIds.has(p.id);
                    return (
                      <tr key={p.id} className={clsx("border-l-4 transition-colors", style.row, isSelected && "ring-1 ring-inset ring-brand-200")}>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(p.id)}
                            aria-label={`Select ${p.name}`} className="h-4 w-4 rounded border-slate-300" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            {p.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.image_url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" aria-hidden="true" />
                            ) : (
                              <span className={clsx(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white",
                                p.status === "active" ? "bg-brand-600" : p.status === "draft" ? "bg-warning-500" : "bg-slate-400",
                              )} aria-hidden="true">
                                {p.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className={clsx("font-medium leading-snug", p.status === "archived" ? "text-slate-600" : "text-slate-950")}>{p.name}</p>
                              <p className="text-xs text-slate-400">
                                {p.brand ?? ""}
                                {p.raw_cost_price_cents != null && (
                                  <span className={p.brand ? "ml-1.5" : ""}>cost {centsToDisplay(p.raw_cost_price_cents)}</span>
                                )}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{p.sku}</td>
                        <td className="px-4 py-3 text-slate-600">{p.category}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900">{centsToDisplay(p.price_cents)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Badge variant={statusBadge(p.status)}>
                              {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                            </Badge>
                            {p.age_restricted === 1 && (
                              <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-xs font-medium text-orange-700 ring-1 ring-orange-200">18+</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button type="button" onClick={() => router.push(`/catalog/${p.id}`)}
                              className="min-h-[32px] rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
                              View
                            </button>
                            <button type="button" onClick={() => { setEditTarget(p); setActionError(null); }}
                              className="min-h-[32px] rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                              Edit
                            </button>
                            <button type="button"
                              onClick={() => void handleDuplicate(p.id)}
                              disabled={duplicating === p.id}
                              title="Duplicate product (creates a Draft copy)"
                              className="min-h-[32px] rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40">
                              {duplicating === p.id ? "…" : "Copy"}
                            </button>
                            {p.status !== "archived" && (
                              <button type="button" onClick={() => { setArchiveTarget(p); setActionError(null); }}
                                className="min-h-[32px] rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
                                Archive
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 md:hidden">
              {visibleProducts.map(p => (
                <ProductListCard
                  key={p.id}
                  product={p}
                  onEdit={() => { setEditTarget(p); setActionError(null); }}
                  onArchive={() => { setArchiveTarget(p); setActionError(null); }}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              <span>
                Showing {visibleProducts.length} of {total} products
                {someSelected && <span className="ml-2 font-medium text-brand-600">· {selectedIds.size} selected</span>}
              </span>
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="font-medium text-brand-600 hover:underline">
                  Clear filters
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      {/* Modals */}
      {showImport && (
        <ImportCSVModal
          onDone={async () => { await load(); }}
          onClose={() => setShowImport(false)}
        />
      )}
      {showPrintLabels && (
        <PrintLabelsModal selected={selectedProducts} onClose={() => setShowPrintLabels(false)} />
      )}
      {showCreate && (
        <ProductFormModal categories={categories} onSave={handleCreate} onClose={() => setShowCreate(false)} />
      )}
      {editTarget && (
        <ProductFormModal initial={editTarget} categories={categories} onSave={handleEdit} onClose={() => setEditTarget(null)} />
      )}
      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setArchiveTarget(null)}>
          <div className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-950">Archive &ldquo;{archiveTarget.name}&rdquo;?</h2>
            <p className="mt-2 text-sm text-slate-600">
              The product will be set to archived and hidden from active views. You can restore it by editing the status.
            </p>
            {actionError && <p className="mt-3 text-sm text-red-700">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setArchiveTarget(null)}
                className="min-h-[40px] rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={handleArchive} disabled={archiving}
                className="min-h-[40px] rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
                {archiving ? "Archiving..." : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CatalogMetric({
  label,
  value,
  helper,
  tone = "neutral",
  active = false,
}: {
  label: string;
  value: number;
  helper: string;
  tone?: "neutral" | "success" | "warning" | "muted" | "restricted";
  active?: boolean;
}) {
  return (
    <div className={clsx("rounded-md border px-4 py-3 transition-colors", metricToneClass(tone), active && "ring-2 ring-brand-200")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-slate-950">{value}</span>
        <span className="text-xs text-slate-500">{helper}</span>
      </div>
    </div>
  );
}

function ProductListCard({
  product,
  onEdit,
  onArchive,
}: {
  product: Product;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const style = productStatusStyle(product.status);
  return (
    <article className={clsx("space-y-3 border-l-4 px-4 py-4", style.card)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", style.dot)} aria-hidden="true" />
          <div className="min-w-0">
          <h3 className={clsx("truncate text-sm font-semibold", product.status === "archived" ? "text-slate-600" : "text-slate-950")}>{product.name}</h3>
          <p className="mt-1 font-mono text-xs text-slate-500">{product.sku}</p>
          </div>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">
          {centsToDisplay(product.price_cents)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusBadge(product.status)}>{product.status.charAt(0).toUpperCase() + product.status.slice(1)}</Badge>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{product.category}</span>
        {product.brand && <span className="text-xs text-slate-500">{product.brand}</span>}
        {product.age_restricted === 1 && (
          <span className="rounded-md bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700 ring-1 ring-orange-200">18+</span>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onEdit} className="min-h-[36px] rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100">
          Edit
        </button>
        {product.status !== "archived" && (
          <button type="button" onClick={onArchive} className="min-h-[36px] rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Archive
          </button>
        )}
      </div>
    </article>
  );
}

// ── Categories Tab ────────────────────────────────────────────────────────────

function CategoriesTab() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const [newName, setNewName]       = useState("");
  const [creating, setCreating]     = useState(false);
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true); setCreateError(null);
    try {
      await apiPost("/api/v1/catalog/categories", { name: newName.trim() });
      setNewName(""); await load();
    } catch (err) {
      setCreateError(err instanceof ApiResponseError ? err.message : "Create failed.");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (c: Category) => { setEditTarget(c); setEditName(c.name); setActionError(null); };

  const handleEditSave = async () => {
    if (!editTarget || !editName.trim()) return;
    setEditSaving(true); setActionError(null);
    try {
      await apiPatch(`/api/v1/catalog/categories/${editTarget.id}`, { name: editName.trim() });
      setEditTarget(null); await load();
    } catch (err) {
      setActionError(err instanceof ApiResponseError ? err.message : "Save failed.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setActionError(null);
    try {
      await apiDelete(`/api/v1/catalog/categories/${deleteTarget.id}`);
      setDeleteTarget(null); await load();
    } catch (err) {
      setActionError(err instanceof ApiResponseError ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <TableSkeleton headers={["Name", "Slug", "Products", ""]} rows={6} />;
  if (error)   return <p role="alert" className="py-6 text-sm text-red-700">{error}</p>;

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Product categories</h2>
          <p className="text-sm text-slate-500">{categories.length} {categories.length === 1 ? "category" : "categories"}</p>
        </div>

        {actionError && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2">
            <p className="text-sm text-red-700">{actionError}</p>
          </div>
        )}

        {categories.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">No categories yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50">
                {editTarget?.id === c.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="min-h-[40px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                      autoFocus
                    />
                    <button type="button" onClick={handleEditSave} disabled={editSaving} className="min-h-[40px] rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60">
                      {editSaving ? "..." : "Save"}
                    </button>
                    <button type="button" onClick={() => setEditTarget(null)} className="min-h-[40px] rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-medium text-slate-950">{c.name}</span>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => startEdit(c)} className="min-h-[32px] rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100">Edit</button>
                      <button type="button" onClick={() => { setDeleteTarget(c); setActionError(null); }} className="min-h-[32px] rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Add category inline form */}
        <form onSubmit={handleCreate} className="flex items-center gap-2 border-t border-slate-200 px-4 py-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New category name..."
            className="min-h-[40px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
          <button type="submit" disabled={creating || !newName.trim()} className="min-h-[40px] rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {creating ? "Adding..." : "Add"}
          </button>
        </form>
        {createError && <p className="px-4 pb-2 text-xs text-red-700">{createError}</p>}
      </Card>

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-950">Delete &ldquo;{deleteTarget.name}&rdquo;?</h2>
            <p className="mt-2 text-sm text-slate-600">
              Deleting a category won&apos;t remove products, but they will no longer be grouped under this category.
            </p>
            {actionError && <p className="mt-3 text-sm text-red-700">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="min-h-[40px] rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleDelete} disabled={deleting} className="min-h-[40px] rounded-md bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-60">
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "products" | "categories";

export default function CatalogPage() {
  const [tab, setTab] = useState<Tab>("products");
  const [categories, setCategories] = useState<Category[]>([]);

  // Pre-load categories so ProductsTab can use them for the filter dropdown
  useEffect(() => {
    apiGet<CategoriesResponse>("/api/v1/catalog/categories")
      .then((d) => setCategories(d.items ?? []))
      .catch(() => {/* non-fatal */});
  }, []);

  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? "border-blue-600 text-blue-600"
        : "border-transparent text-slate-500 hover:text-slate-700"
    }`;

  return (
    <EnterpriseShell
      active="catalog"
      title="Catalog"
      subtitle="Products and category management"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 sm:px-6">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200">
          <button type="button" onClick={() => setTab("products")} className={tabCls("products")}>
            Products
          </button>
          <button type="button" onClick={() => setTab("categories")} className={tabCls("categories")}>
            Categories
          </button>
        </div>

        {tab === "products"   && <ProductsTab   categories={categories} />}
        {tab === "categories" && <CategoriesTab />}
      </div>
    </EnterpriseShell>
  );
}
