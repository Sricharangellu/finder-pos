"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/Button";
import { apiPatch, ApiResponseError } from "@/api-client/client";
import type { CatalogProduct } from "@/api-client/types";

// ── Shared primitives ─────────────────────────────────────────────────────────

const FIELD = "w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600";

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1">
      <label className="block text-xs font-medium text-slate-500">{children}</label>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h3 className="text-sm font-semibold text-[#111]">{title}</h3>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Price helpers ─────────────────────────────────────────────────────────────

function calcPriceFields(retail: number, cost: number) {
  if (retail <= 0) return { markup: 0, margin: 0 };
  const markup = cost > 0 ? ((retail - cost) / cost) * 100 : 0;
  const margin = ((retail - cost) / retail) * 100;
  return { markup, margin };
}

// ── Tags chip input ───────────────────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const newTags = raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t && !tags.includes(t));
    if (newTags.length) onChange([...tags, ...newTags]);
    setDraft("");
  }

  return (
    <div className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 focus-within:border-brand-600 focus-within:ring-1 focus-within:ring-brand-600">
      {tags.map((t) => (
        <span
          key={t}
          className="flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-medium text-brand-600"
        >
          {t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="text-brand-600/60 hover:text-brand-600"
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-[120px] flex-1 bg-transparent text-sm text-[#111] outline-none placeholder:text-slate-400"
        placeholder={tags.length === 0 ? "Type a tag and press Enter or comma…" : "Add more…"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => { if (draft.trim()) addTag(draft); }}
      />
    </div>
  );
}

// ── Image upload area ─────────────────────────────────────────────────────────

function ImageUploadArea({
  imageUrl,
  onUrlChange,
}: {
  imageUrl: string;
  onUrlChange: (url: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [showUrl, setShowUrl] = useState(!!imageUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      {imageUrl && (
        <div className="flex flex-wrap gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="relative group">
            <img
              src={imageUrl}
              alt="Product"
              className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
            />
            <button
              type="button"
              onClick={() => onUrlChange("")}
              className="absolute -top-1 -right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs shadow"
              aria-label="Remove image"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          // In production this would upload the file; here we accept URL drops
          const url = e.dataTransfer.getData("text/plain");
          if (url) onUrlChange(url);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors ${
          dragging
            ? "border-brand-600 bg-brand-600/5"
            : "border-slate-200 bg-slate-50 hover:border-slate-300"
        }`}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <div className="text-center">
          <p className="text-xs text-slate-500">Drag images here, or</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-1 text-xs font-medium text-brand-600 hover:underline"
          >
            Choose images
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" multiple />
        </div>
        <p className="text-[11px] text-slate-400">Drag outside thumbnail to delete</p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowUrl((v) => !v)}
          className="text-[11px] text-slate-400 hover:text-slate-600"
        >
          {showUrl ? "Hide URL field" : "Or paste image URL"}
        </button>
      </div>
      {showUrl && (
        <input
          type="url"
          className={FIELD}
          value={imageUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://…"
        />
      )}
    </div>
  );
}

// ── Customer Input Fields ─────────────────────────────────────────────────────

type InputFieldType = "text" | "date";

interface CustomerInputField {
  id: string;
  label: string;
  type: InputFieldType;
  required: boolean;
}

function CustomerInputFields() {
  const [fields, setFields] = useState<CustomerInputField[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: "", type: "text" as InputFieldType });

  const add = () => {
    if (!draft.label.trim()) return;
    setFields((f) => [
      ...f,
      { id: `field_${Date.now()}`, label: draft.label.trim(), type: draft.type, required: false },
    ]);
    setDraft({ label: "", type: "text" });
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {fields.length === 0 && !adding && (
        <p className="text-sm text-slate-400">This product has no customer input fields</p>
      )}
      {fields.map((f) => (
        <div key={f.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
          <div className="flex-1">
            <p className="text-sm font-medium text-[#111]">{f.label}</p>
            <p className="text-[11px] text-slate-400 capitalize">{f.type} field</p>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
              checked={f.required}
              onChange={(e) => setFields((prev) => prev.map((x) => x.id === f.id ? { ...x, required: e.target.checked } : x))}
            />
            Required
          </label>
          <button
            type="button"
            onClick={() => setFields((prev) => prev.filter((x) => x.id !== f.id))}
            className="text-xs text-red-400 hover:text-red-600"
            aria-label="Remove field"
          >
            Remove
          </button>
        </div>
      ))}

      {adding ? (
        <div className="space-y-2 rounded-lg border border-brand-600/20 bg-brand-600/5 p-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              autoFocus
              className={FIELD}
              placeholder="Field label…"
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setAdding(false); }}
            />
            <select className={FIELD} value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as InputFieldType }))}>
              <option value="text">Text field</option>
              <option value="date">Date picker</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={add}>Add field</Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
        >
          <span className="text-base leading-none">+</span> Add an input field
        </button>
      )}
    </div>
  );
}

// ── GeneralTab ────────────────────────────────────────────────────────────────

export function GeneralTab({
  product,
  onSaved,
}: {
  product: CatalogProduct;
  onSaved: (p: CatalogProduct) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialRetail = product.price_cents / 100;
  const initialCost = (product.raw_cost_price_cents ?? 0) / 100;
  const { markup: initMarkup, margin: initMargin } = calcPriceFields(initialRetail, initialCost);

  const [form, setForm] = useState({
    name: product.name,
    brand: product.brand ?? "",
    description: product.description ?? "",
    category: product.category,
    image_url: product.image_url ?? "",
    tax_class: product.tax_class as "standard" | "exempt",
    status: product.status as "active" | "draft" | "archived",
    sell_pos: product.status === "active",
    sell_online: !!(product.ecommerce ?? 0),
    // price
    retail: String(initialRetail.toFixed(2)),
    cost: String(initialCost.toFixed(2)),
    msrp: product.msrp_cents != null ? String((product.msrp_cents / 100).toFixed(2)) : "",
    markup: initMarkup > 0 ? String(initMarkup.toFixed(2)) : "",
    margin: initMargin > 0 ? String(initMargin.toFixed(2)) : "",
    // dimensions (stored in mm/g, displayed in in/lb)
    weight: product.weight_grams != null ? String((product.weight_grams / 453.592).toFixed(2)) : "",
    length: product.length_mm != null ? String((product.length_mm / 25.4).toFixed(2)) : "",
    width: product.width_mm != null ? String((product.width_mm / 25.4).toFixed(2)) : "",
    height: product.height_mm != null ? String((product.height_mm / 25.4).toFixed(2)) : "",
  });

  const [tags, setTags] = useState<string[]>(
    product.tags ? product.tags.split(",").map((t) => t.trim()).filter(Boolean) : []
  );

  function set<K extends keyof typeof form>(key: K, val: string | boolean) {
    setForm((f) => ({ ...f, [key]: val }));
    setError(null);
  }

  function onRetailChange(val: string) {
    const retail = parseFloat(val) || 0;
    const cost = parseFloat(form.cost) || 0;
    const { markup, margin } = calcPriceFields(retail, cost);
    setForm((f) => ({
      ...f,
      retail: val,
      markup: markup > 0 ? markup.toFixed(2) : "",
      margin: margin > 0 ? margin.toFixed(2) : "",
    }));
  }

  function onCostChange(val: string) {
    const cost = parseFloat(val) || 0;
    const retail = parseFloat(form.retail) || 0;
    const { markup, margin } = calcPriceFields(retail, cost);
    setForm((f) => ({
      ...f,
      cost: val,
      markup: markup > 0 ? markup.toFixed(2) : "",
      margin: margin > 0 ? margin.toFixed(2) : "",
    }));
  }

  function onMarkupChange(val: string) {
    const markupPct = parseFloat(val) || 0;
    const cost = parseFloat(form.cost) || 0;
    if (cost > 0) {
      const retail = cost * (1 + markupPct / 100);
      const margin = (markupPct / (1 + markupPct / 100)).toFixed(2);
      setForm((f) => ({ ...f, markup: val, retail: retail.toFixed(2), margin }));
    } else {
      setForm((f) => ({ ...f, markup: val }));
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const retailCents = Math.round((parseFloat(form.retail) || 0) * 100);
      if (retailCents <= 0) throw new Error("Retail price must be greater than 0");
      const updated = await apiPatch<CatalogProduct>(`/api/v1/catalog/${product.id}`, {
        name: form.name.trim(),
        brand: form.brand.trim() || undefined,
        description: form.description.trim() || undefined,
        category: form.category.trim(),
        image_url: form.image_url.trim() || undefined,
        tax_class: form.tax_class,
        status: form.sell_pos ? "active" : "draft",
        ecommerce: form.sell_online ? 1 : 0,
        tags: tags.join(", ") || undefined,
        price_cents: retailCents,
        msrp_cents: form.msrp ? Math.round(parseFloat(form.msrp) * 100) : undefined,
        raw_cost_price_cents: form.cost ? Math.round(parseFloat(form.cost) * 100) : undefined,
        weight_grams: form.weight ? Math.round(parseFloat(form.weight) * 453.592) : undefined,
        length_mm: form.length ? Math.round(parseFloat(form.length) * 25.4) : undefined,
        width_mm: form.width ? Math.round(parseFloat(form.width) * 25.4) : undefined,
        height_mm: form.height ? Math.round(parseFloat(form.height) * 25.4) : undefined,
      });
      onSaved(updated);
    } catch (e) {
      setError(
        e instanceof ApiResponseError ? e.message : e instanceof Error ? e.message : "Save failed."
      );
    } finally {
      setSaving(false);
    }
  }

  const marginNum = parseFloat(form.margin) || 0;

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* ── General Information ────────────────────────────────────────────── */}
      <Section title="General Information">
        <div className="space-y-4">

          {/* Name + Brand */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <input
                className={FIELD}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Product name"
              />
            </div>
            <div>
              <Label>Brand</Label>
              <input
                className={FIELD}
                value={form.brand}
                onChange={(e) => set("brand", e.target.value)}
                placeholder="e.g. Acme"
                list="brand-suggestions"
              />
            </div>
          </div>

          {/* Description + AI button */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-slate-500">Description</label>
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3L14.5 8.5 20 11 14.5 13.5 12 19 9.5 13.5 4 11 9.5 8.5Z"/></svg>
                Generate with AI
              </button>
            </div>
            <textarea
              rows={3}
              className={FIELD + " resize-none"}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Product description…"
            />
          </div>

          {/* Tags */}
          <div>
            <Label hint="Keywords for filtering — press Enter or comma to add">Tags</Label>
            <TagInput tags={tags} onChange={setTags} />
          </div>

          {/* Product categories */}
          <div>
            <Label>Product categories</Label>
            <input
              className={FIELD}
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              placeholder="e.g. Tobacco, Beverages…"
            />
          </div>

          {/* Sell toggles */}
          <div className="flex flex-wrap gap-x-8 gap-y-3 pt-1">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                checked={form.sell_pos}
                onChange={(e) => set("sell_pos", e.target.checked)}
              />
              <span className="text-sm text-[#111]">Sell on point-of-sale</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                checked={form.sell_online}
                onChange={(e) => set("sell_online", e.target.checked)}
              />
              <span className="text-sm text-[#111]">Sell online</span>
            </label>
          </div>

          {/* Images */}
          <div>
            <Label hint="Drag to reorder · Drag outside thumbnail to delete">Upload images</Label>
            <ImageUploadArea
              imageUrl={form.image_url}
              onUrlChange={(url) => set("image_url", url)}
            />
          </div>
        </div>
      </Section>

      {/* ── Price ─────────────────────────────────────────────────────────── */}
      <Section title="Price">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2.5 text-left">Price point</th>
                <th className="px-3 py-2.5 text-right">Supply price</th>
                <th className="px-3 py-2.5 text-right">Markup %</th>
                <th className="px-3 py-2.5 text-right">Margin %</th>
                <th className="px-3 py-2.5 text-right">Retail price (excl. tax)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-50">
                <td className="px-3 py-3 text-slate-500 text-xs">General Price Book (All Products)</td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-slate-400 text-xs">$</span>
                    <input
                      type="number" step="0.01" min="0"
                      className="w-24 rounded border border-slate-200 px-2 py-1.5 text-right text-sm outline-none focus:border-brand-600"
                      value={form.cost}
                      onChange={(e) => onCostChange(e.target.value)}
                    />
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <input
                      type="number" step="0.01" min="0"
                      className="w-20 rounded border border-slate-200 px-2 py-1.5 text-right text-sm outline-none focus:border-brand-600"
                      value={form.markup}
                      onChange={(e) => onMarkupChange(e.target.value)}
                      placeholder="0.00"
                    />
                    <span className="text-slate-400 text-xs">%</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-right">
                  <span
                    className={`text-sm font-semibold ${
                      marginNum >= 30
                        ? "text-emerald-600"
                        : marginNum > 0
                        ? "text-amber-600"
                        : "text-slate-400"
                    }`}
                  >
                    {form.margin ? `${parseFloat(form.margin).toFixed(1)}%` : "—"}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-slate-400 text-xs">$</span>
                    <input
                      type="number" step="0.01" min="0"
                      className="w-24 rounded border border-slate-200 px-2 py-1.5 text-right text-sm font-semibold outline-none focus:border-brand-600"
                      value={form.retail}
                      onChange={(e) => onRetailChange(e.target.value)}
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Tax ───────────────────────────────────────────────────────────── */}
      <Section title="Tax">
        <div className="space-y-5">
          {/* Non-delivery sales */}
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Non-delivery sales</p>
            <div className="overflow-hidden rounded-lg border border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left">Outlet</th>
                    <th className="px-4 py-2.5 text-left">Tax</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-4 py-3 text-sm text-slate-700">Main Outlet</td>
                    <td className="px-4 py-3">
                      <select
                        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-brand-600"
                        value={form.tax_class}
                        onChange={(e) => set("tax_class", e.target.value as "standard" | "exempt")}
                      >
                        <option value="standard">Default tax for outlet</option>
                        <option value="exempt">Tax exempt</option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Delivery sales */}
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Delivery sales</p>
            <p className="mb-2 text-[11px] text-slate-400">
              If a product has no tax category assigned, it is subject to the default tax rate of the destination.
            </p>
            <select className="w-64 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600">
              <option value="">No tax category</option>
              <option value="standard">Standard tax rate</option>
              <option value="reduced">Reduced rate</option>
              <option value="exempt">Tax exempt</option>
            </select>
          </div>
        </div>
      </Section>

      {/* ── Online Customer Input Fields ───────────────────────────────────── */}
      <Section title="Online Customer Input Fields">
        <CustomerInputFields />
      </Section>

      {/* ── Weight and Dimensions ─────────────────────────────────────────── */}
      <Section title="Weight and Dimensions">
        <p className="mb-3 text-xs text-slate-400">Used to calculate shipping costs at checkout.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Weight", "weight", "lb"],
              ["Length", "length", "in"],
              ["Width", "width", "in"],
              ["Height", "height", "in"],
            ] as const
          ).map(([lbl, key, unit]) => (
            <div key={key}>
              <Label>
                {lbl} ({unit})
              </Label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={FIELD}
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
                placeholder="0.00"
              />
            </div>
          ))}
        </div>
      </Section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <Button size="sm" variant="secondary" onClick={() => window.history.back()}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={saving} onClick={() => void handleSave()}>
          Save
        </Button>
      </div>
    </div>
  );
}
