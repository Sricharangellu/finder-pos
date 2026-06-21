"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { clsx } from "clsx";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { apiGet, apiPatch, ApiResponseError } from "@/api-client/client";
import { useToast } from "@/components/Toast";
import type { Product, ProductStatus, TaxClass } from "@/api-client/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComplianceFlags {
  tobacco_type: string | null;
  flavored: boolean;
  menthol: boolean;
  msa_reportable: boolean;
  age_restricted: boolean;
  min_age: number;
  restricted_states: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const TOBACCO_OPTIONS = [
  { value: "", label: "— none —" },
  { value: "cigarette", label: "Cigarette" },
  { value: "cigar", label: "Cigar" },
  { value: "smokeless", label: "Smokeless" },
  { value: "e-cigarette", label: "E-Cigarette" },
  { value: "pipe", label: "Pipe" },
  { value: "hookah", label: "Hookah" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function centsToDisplay(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadgeVariant(s: ProductStatus): "green" | "yellow" | "gray" {
  if (s === "active") return "green";
  if (s === "draft") return "yellow";
  return "gray";
}

function defaultCompliance(): ComplianceFlags {
  return {
    tobacco_type: null,
    flavored: false,
    menthol: false,
    msa_reportable: false,
    age_restricted: false,
    min_age: 21,
    restricted_states: [],
  };
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ product }: { product: Product }) {
  const inputCls = "w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900";
  const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500";

  return (
    <Card>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className={labelCls}>SKU</p>
          <p className={inputCls}>{product.sku}</p>
        </div>
        <div>
          <p className={labelCls}>Category</p>
          <p className={inputCls}>{product.category}</p>
        </div>
        <div>
          <p className={labelCls}>Price</p>
          <p className={inputCls}>{centsToDisplay(product.price_cents)}</p>
        </div>
        <div>
          <p className={labelCls}>Tax class</p>
          <p className={inputCls}>{product.tax_class}</p>
        </div>
        {product.brand && (
          <div>
            <p className={labelCls}>Brand</p>
            <p className={inputCls}>{product.brand}</p>
          </div>
        )}
        {product.barcode && (
          <div>
            <p className={labelCls}>Barcode</p>
            <p className={`${inputCls} font-mono`}>{product.barcode}</p>
          </div>
        )}
        {product.description && (
          <div className="sm:col-span-2">
            <p className={labelCls}>Description</p>
            <p className={inputCls}>{product.description}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Pricing History Tab (placeholder) ────────────────────────────────────────

function PricingHistoryTab() {
  return (
    <Card>
      <p className="text-sm text-slate-500">Pricing history coming soon.</p>
    </Card>
  );
}

// ── Compliance Tab ────────────────────────────────────────────────────────────

function ComplianceTab({
  productId,
  initial,
}: {
  productId: string;
  initial: ComplianceFlags;
}) {
  const { addToast } = useToast();
  const [flags, setFlags] = useState<ComplianceFlags>(initial);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ComplianceFlags>(k: K, v: ComplianceFlags[K]) =>
    setFlags((f) => ({ ...f, [k]: v }));

  const toggleState = (abbr: string) =>
    setFlags((f) => {
      const has = f.restricted_states.includes(abbr);
      return {
        ...f,
        restricted_states: has
          ? f.restricted_states.filter((s) => s !== abbr)
          : [...f.restricted_states, abbr],
      };
    });

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPatch(`/api/v1/catalog/${productId}/compliance`, flags);
      addToast({ title: "Compliance settings saved", variant: "success" });
    } catch (err) {
      addToast({
        title: err instanceof ApiResponseError ? err.message : "Failed to save compliance settings",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-600";
  const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500";
  const checkLabelCls = "flex cursor-pointer items-start gap-2 text-sm text-slate-700";
  const checkboxCls = "mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500";

  return (
    <Card>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Left — Tobacco Classification */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-950">Tobacco Classification</h3>

          <div>
            <label className={labelCls} htmlFor="tobacco-type">Tobacco type</label>
            <select
              id="tobacco-type"
              value={flags.tobacco_type ?? ""}
              onChange={(e) => set("tobacco_type", e.target.value || null)}
              className={inputCls}
            >
              {TOBACCO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <label className={checkLabelCls}>
            <input
              type="checkbox"
              className={checkboxCls}
              checked={flags.flavored}
              onChange={(e) => set("flavored", e.target.checked)}
            />
            <span>
              <span className="font-medium">Flavored</span>
              <span className="block text-xs text-slate-400">Product contains flavoring agents</span>
            </span>
          </label>

          <label className={checkLabelCls}>
            <input
              type="checkbox"
              className={checkboxCls}
              checked={flags.menthol}
              onChange={(e) => set("menthol", e.target.checked)}
            />
            <span>
              <span className="font-medium">Menthol</span>
              <span className="block text-xs text-slate-400">Menthol product</span>
            </span>
          </label>

          <label className={checkLabelCls}>
            <input
              type="checkbox"
              className={checkboxCls}
              checked={flags.msa_reportable}
              onChange={(e) => set("msa_reportable", e.target.checked)}
            />
            <span>
              <span className="font-medium">MSA reportable</span>
              <span className="block text-xs text-slate-400">Include in monthly MSA sales report</span>
            </span>
          </label>
        </div>

        {/* Right — Age & Geographic Restrictions */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-950">Age & Geographic Restrictions</h3>

          <div className="space-y-3">
            <label className={checkLabelCls}>
              <input
                type="checkbox"
                className={checkboxCls}
                checked={flags.age_restricted}
                onChange={(e) => set("age_restricted", e.target.checked)}
              />
              <span>
                <span className="font-medium">Age restricted</span>
              </span>
            </label>

            {flags.age_restricted && (
              <div className="ml-6">
                <label className={labelCls} htmlFor="min-age">Minimum age</label>
                <input
                  id="min-age"
                  type="number"
                  min={18}
                  max={21}
                  value={flags.min_age}
                  onChange={(e) => set("min_age", Math.min(21, Math.max(18, parseInt(e.target.value, 10) || 18)))}
                  className={`${inputCls} w-24`}
                />
                <p className="mt-1 text-xs text-slate-400">Cashiers will be prompted to verify ID at checkout</p>
              </div>
            )}
          </div>

          <div>
            <p className={labelCls}>Restricted states (block sales)</p>
            <div className="h-40 overflow-y-auto rounded-md border border-slate-200 bg-white p-2">
              <div className="grid grid-cols-4 gap-1">
                {US_STATES.map((abbr) => (
                  <label
                    key={abbr}
                    className={clsx(
                      "flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs font-medium transition-colors",
                      flags.restricted_states.includes(abbr)
                        ? "bg-red-50 text-red-700"
                        : "text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-3 w-3 rounded border-slate-300 text-red-600 focus:ring-red-500"
                      checked={flags.restricted_states.includes(abbr)}
                      onChange={() => toggleState(abbr)}
                    />
                    {abbr}
                  </label>
                ))}
              </div>
            </div>

            {flags.restricted_states.length > 0 && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>Sales blocked in {flags.restricted_states.length} state{flags.restricted_states.length === 1 ? "" : "s"}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="min-h-[40px] rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save compliance settings"}
        </button>
      </div>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "overview" | "pricing_history" | "compliance";

export default function CatalogDetailPage() {
  const params = useParams();
  const id = String(params.id);

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const complianceFromProduct = useCallback((p: Product): ComplianceFlags => {
    const d = defaultCompliance();
    const ext = p as any;
    return {
      tobacco_type: ext.tobacco_type != null ? String(ext.tobacco_type) : d.tobacco_type,
      flavored: ext.flavored != null ? !!ext.flavored : d.flavored,
      menthol: ext.menthol != null ? !!ext.menthol : d.menthol,
      msa_reportable: ext.msa_reportable != null ? !!ext.msa_reportable : d.msa_reportable,
      age_restricted: p.age_restricted === 1,
      min_age: ext.min_age != null ? Number(ext.min_age) : d.min_age,
      restricted_states: Array.isArray(ext.restricted_states) ? ext.restricted_states : d.restricted_states,
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    apiGet<Product>(`/api/v1/catalog/${id}`)
      .then((p) => {
        setProduct(p);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof ApiResponseError ? err.message : "Failed to load product.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const tabCls = (t: Tab) =>
    clsx(
      "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
      tab === t
        ? "border-blue-600 text-blue-600"
        : "border-transparent text-slate-500 hover:text-slate-700"
    );

  return (
    <EnterpriseShell
      active="catalog"
      title={product ? product.name : "Product Detail"}
      subtitle={product ? `SKU: ${product.sku}` : "Loading…"}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">
        {loading ? (
          <p className="text-sm text-slate-500" aria-busy="true">Loading…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-red-700">{error}</p>
        ) : product ? (
          <>
            {/* Product header */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-slate-950">{product.name}</h1>
                {product.brand && <p className="text-sm text-slate-400">{product.brand}</p>}
              </div>
              <Badge variant={statusBadgeVariant(product.status)}>
                {product.status.charAt(0).toUpperCase() + product.status.slice(1)}
              </Badge>
              {product.age_restricted === 1 && (
                <span className="rounded-md bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700 ring-1 ring-orange-200">18+</span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-slate-200">
              <button type="button" onClick={() => setTab("overview")} className={tabCls("overview")}>
                Overview
              </button>
              <button type="button" onClick={() => setTab("pricing_history")} className={tabCls("pricing_history")}>
                Pricing History
              </button>
              <button type="button" onClick={() => setTab("compliance")} className={tabCls("compliance")}>
                Compliance
              </button>
            </div>

            {tab === "overview" && <OverviewTab product={product} />}
            {tab === "pricing_history" && <PricingHistoryTab />}
            {tab === "compliance" && (
              <ComplianceTab
                productId={id}
                initial={complianceFromProduct(product)}
              />
            )}
          </>
        ) : null}
      </div>
    </EnterpriseShell>
  );
}
