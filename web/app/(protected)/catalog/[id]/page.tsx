"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { apiGet, apiPatch, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { CatalogProduct } from "@/api-client/types";

// ─── Local types ──────────────────────────────────────────────────────────────

interface LocationStock {
  location_id: string;
  location_code: string;
  location_name: string;
  quantity_on_hand: number;
  quantity_committed: number;
  quantity_available: number;
  average_cost_cents: number;
}

interface ProductStock {
  product_id: string;
  locations: LocationStock[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE = { active: "green", draft: "yellow", archived: "gray" } as const;

const TOBACCO_TYPES = [
  { value: "", label: "None (not tobacco/vape)" },
  { value: "cigarette", label: "Cigarette" },
  { value: "cigar", label: "Cigar / Cigarillo" },
  { value: "smokeless", label: "Smokeless / Chewing" },
  { value: "ecigarette", label: "E-Cigarette / Vape" },
] as const;

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
] as const;

type TobaccoType = "" | "cigarette" | "cigar" | "smokeless" | "ecigarette";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [stock, setStock] = useState<ProductStock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingCompliance, setSavingCompliance] = useState(false);
  const [complianceSaveError, setComplianceSaveError] = useState<string | null>(null);

  const [complianceForm, setComplianceForm] = useState<{
    tobacco_type: TobaccoType;
    flavored: boolean;
    menthol: boolean;
    msa_reportable: boolean;
    restricted_states: string[];
  }>({
    tobacco_type: "",
    flavored: false,
    menthol: false,
    msa_reportable: false,
    restricted_states: [],
  });

  // Edit form state (mirrors editable CatalogProduct fields)
  const [form, setForm] = useState({
    name: "",
    sku: "",
    price_cents: "",
    description: "",
    brand: "",
    barcode: "",
    category: "",
    tax_class: "standard" as "standard" | "exempt",
    status: "active" as "active" | "draft" | "archived",
    weight_grams: "",
    length_mm: "",
    width_mm: "",
    height_mm: "",
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [prod, stk] = await Promise.all([
        apiGet<CatalogProduct>(`/api/v1/catalog/${id}`),
        apiGet<ProductStock>(`/api/v1/catalog/${id}/stock`).catch(() => null),
      ]);
      setProduct(prod);
      setStock(stk);
      setForm({
        name: prod.name,
        sku: prod.sku,
        price_cents: String(prod.price_cents / 100),
        description: prod.description ?? "",
        brand: prod.brand ?? "",
        barcode: prod.barcode ?? "",
        category: prod.category,
        tax_class: prod.tax_class,
        status: prod.status,
        weight_grams: prod.weight_grams != null ? String(prod.weight_grams) : "",
        length_mm: prod.length_mm != null ? String(prod.length_mm) : "",
        width_mm: prod.width_mm != null ? String(prod.width_mm) : "",
        height_mm: prod.height_mm != null ? String(prod.height_mm) : "",
      });
      setComplianceForm({
        tobacco_type: (prod.tobacco_type ?? "") as TobaccoType,
        flavored: !!prod.flavored,
        menthol: !!prod.menthol,
        msa_reportable: !!prod.msa_reportable,
        restricted_states: prod.restricted_states ?? [],
      });
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load product.");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!product) return;
    setSaving(true); setSaveError(null);
    try {
      const priceCents = Math.round(parseFloat(form.price_cents) * 100);
      if (isNaN(priceCents)) throw new Error("Invalid price");
      const patch: Partial<CatalogProduct> = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        price_cents: priceCents,
        description: form.description.trim() || undefined,
        brand: form.brand.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        category: form.category.trim(),
        tax_class: form.tax_class,
        status: form.status,
        weight_grams: form.weight_grams ? Number(form.weight_grams) : undefined,
        length_mm: form.length_mm ? Number(form.length_mm) : undefined,
        width_mm: form.width_mm ? Number(form.width_mm) : undefined,
        height_mm: form.height_mm ? Number(form.height_mm) : undefined,
      };
      const updated = await apiPatch<CatalogProduct>(`/api/v1/catalog/${id}`, patch);
      setProduct(updated);
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof ApiResponseError ? e.message : "Save failed.");
    } finally { setSaving(false); }
  };

  const saveCompliance = async () => {
    if (!product) return;
    setSavingCompliance(true); setComplianceSaveError(null);
    try {
      const updated = await apiPatch<CatalogProduct>(`/api/v1/catalog/${id}/compliance`, {
        tobacco_type: complianceForm.tobacco_type || null,
        flavored: complianceForm.flavored ? 1 : 0,
        menthol: complianceForm.menthol ? 1 : 0,
        msa_reportable: complianceForm.msa_reportable ? 1 : 0,
        restricted_states: complianceForm.restricted_states,
      });
      setProduct(updated);
    } catch (e) {
      setComplianceSaveError(e instanceof ApiResponseError ? e.message : "Failed to save compliance flags.");
    } finally { setSavingCompliance(false); }
  };

  const totalOnHand = stock?.locations.reduce((s, l) => s + l.quantity_on_hand, 0) ?? 0;
  const totalAvailable = stock?.locations.reduce((s, l) => s + l.quantity_available, 0) ?? 0;

  if (loading) {
    return (
      <EnterpriseShell active="catalog" title="Product" contentClassName="overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      </EnterpriseShell>
    );
  }

  if (error || !product) {
    return (
      <EnterpriseShell active="catalog" title="Product" contentClassName="overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
          <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3">{error ?? "Product not found."}</p>
          <Button variant="secondary" size="sm" onClick={() => router.back()} className="mt-4">← Back</Button>
        </div>
      </EnterpriseShell>
    );
  }

  return (
    <EnterpriseShell active="catalog" title={product.name} subtitle={product.sku} contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-5 sm:px-6">

        {/* Header bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Back to catalog"
            >
              ←
            </button>
            <Badge variant={STATUS_BADGE[product.status]}>{product.status}</Badge>
            <Badge variant="gray">{product.tax_class === "exempt" ? "Tax exempt" : "Standard tax"}</Badge>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setSaveError(null); }}>Cancel</Button>
                <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>Save changes</Button>
              </>
            ) : (
              <Button size="sm" variant="primary" onClick={() => setEditing(true)}>Edit product</Button>
            )}
          </div>
        </div>

        {saveError && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3">{saveError}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Main info */}
          <div className="lg:col-span-2 space-y-5">
            <Card>
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Product details</h2>
              {editing ? (
                <div className="space-y-4">
                  <Field label="Name">
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="SKU">
                      <input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono" />
                    </Field>
                    <Field label="Barcode">
                      <input value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono" />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Price ($)">
                      <input type="number" step="0.01" min="0" value={form.price_cents}
                        onChange={e => setForm(f => ({ ...f, price_cents: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                    </Field>
                    <Field label="Category">
                      <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Tax class">
                      <select value={form.tax_class} onChange={e => setForm(f => ({ ...f, tax_class: e.target.value as "standard" | "exempt" }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                        <option value="standard">Standard</option>
                        <option value="exempt">Exempt</option>
                      </select>
                    </Field>
                    <Field label="Status">
                      <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as "active" | "draft" | "archived" }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                        <option value="active">Active</option>
                        <option value="draft">Draft</option>
                        <option value="archived">Archived</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Brand">
                    <input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                  </Field>
                  <Field label="Description">
                    <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none" />
                  </Field>
                </div>
              ) : (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <DetailRow label="Name" value={product.name} />
                  <DetailRow label="SKU" value={<span className="font-mono">{product.sku}</span>} />
                  <DetailRow label="Barcode" value={product.barcode ? <span className="font-mono">{product.barcode}</span> : "—"} />
                  <DetailRow label="Category" value={product.category} />
                  <DetailRow label="Price" value={<span className="font-semibold">{formatMoney(product.price_cents)}</span>} />
                  <DetailRow label="Tax class" value={product.tax_class} />
                  <DetailRow label="Brand" value={product.brand ?? "—"} />
                  <DetailRow label="Status" value={<Badge variant={STATUS_BADGE[product.status]}>{product.status}</Badge>} />
                  {product.description && (
                    <div className="col-span-2">
                      <dt className="text-xs font-medium text-gray-500 mb-1">Description</dt>
                      <dd className="text-gray-900">{product.description}</dd>
                    </div>
                  )}
                </dl>
              )}
            </Card>

            {/* Dimensions */}
            <Card>
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Dimensions & weight</h2>
              {editing ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {([["Length (mm)", "length_mm"], ["Width (mm)", "width_mm"], ["Height (mm)", "height_mm"], ["Weight (g)", "weight_grams"]] as const).map(([label, key]) => (
                    <Field key={key} label={label}>
                      <input type="number" min="0" value={form[key]}
                        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                    </Field>
                  ))}
                </div>
              ) : (
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <DetailRow label="Length" value={product.length_mm != null ? `${product.length_mm} mm` : "—"} />
                  <DetailRow label="Width" value={product.width_mm != null ? `${product.width_mm} mm` : "—"} />
                  <DetailRow label="Height" value={product.height_mm != null ? `${product.height_mm} mm` : "—"} />
                  <DetailRow label="Weight" value={product.weight_grams != null ? `${product.weight_grams} g` : "—"} />
                </dl>
              )}
            </Card>

            {/* Compliance */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-900">Compliance</h2>
                <Button size="sm" variant="primary" loading={savingCompliance} onClick={() => void saveCompliance()}>
                  Save compliance
                </Button>
              </div>
              {complianceSaveError && (
                <p role="alert" className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-3">{complianceSaveError}</p>
              )}
              <div className="space-y-4">
                <Field label="Tobacco / vape type">
                  <select
                    value={complianceForm.tobacco_type}
                    onChange={e => setComplianceForm(f => ({ ...f, tobacco_type: e.target.value as TobaccoType }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    {TOBACCO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <div className="space-y-2">
                  {(["flavored", "menthol", "msa_reportable"] as const).map((key) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={complianceForm[key]}
                        onChange={e => setComplianceForm(f => ({ ...f, [key]: e.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 capitalize">{key.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    Restricted states ({complianceForm.restricted_states.length} selected)
                  </p>
                  <div className="grid grid-cols-5 gap-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 p-2">
                    {US_STATES.map((st) => (
                      <label key={st} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={complianceForm.restricted_states.includes(st)}
                          onChange={e => setComplianceForm(f => ({
                            ...f,
                            restricted_states: e.target.checked
                              ? [...f.restricted_states, st]
                              : f.restricted_states.filter(s => s !== st),
                          }))}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-xs text-gray-600">{st}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {product.restricted_states && product.restricted_states.length > 0 && (
                  <p className="text-xs text-red-600">
                    <span aria-hidden="true">&#9888; </span>
                    Currently blocked in: {product.restricted_states.join(", ")}
                  </p>
                )}
              </div>
            </Card>
          </div>

          {/* Right sidebar */}
          <div className="space-y-5">

            {/* Stock summary */}
            <Card>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Stock</h2>
              <div className="flex gap-6 mb-4">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{totalOnHand}</p>
                  <p className="text-xs text-gray-400">On hand</p>
                </div>
                <div>
                  <p className={`text-2xl font-bold ${totalAvailable <= 0 ? "text-red-600" : "text-green-700"}`}>{totalAvailable}</p>
                  <p className="text-xs text-gray-400">Available</p>
                </div>
              </div>
              {stock && stock.locations.length > 0 && (
                <div className="space-y-2">
                  {stock.locations.map(loc => (
                    <div key={loc.location_id} className="rounded-lg bg-gray-50 px-3 py-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-gray-700">{loc.location_name}</span>
                        <span className={`text-xs font-semibold ${loc.quantity_available <= 0 ? "text-red-600" : "text-gray-900"}`}>{loc.quantity_available} avail.</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 flex gap-3">
                        <span>{loc.quantity_on_hand} on hand</span>
                        <span>{loc.quantity_committed} committed</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Pricing */}
            <Card>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Pricing</h2>
              <dl className="space-y-2 text-sm">
                <DetailRow label="Retail price" value={<span className="font-semibold">{formatMoney(product.price_cents)}</span>} />
              </dl>
            </Card>

            {/* Metadata */}
            <Card>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Info</h2>
              <dl className="space-y-2 text-xs text-gray-500">
                <div>
                  <dt className="font-medium">Product ID</dt>
                  <dd className="font-mono truncate">{product.id}</dd>
                </div>
                <div>
                  <dt className="font-medium">Created</dt>
                  <dd>{new Date(product.createdAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt className="font-medium">Updated</dt>
                  <dd>{new Date(product.updatedAt).toLocaleDateString()}</dd>
                </div>
              </dl>
            </Card>
          </div>
        </div>
      </div>
    </EnterpriseShell>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-gray-900 mt-0.5">{value}</dd>
    </div>
  );
}
