"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPut, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { CatalogProduct } from "@/api-client/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OnlineSettings {
  online: boolean;
  online_price_cents: number | null;
  online_title: string | null;
  online_description: string | null;
  seo_slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
  images: string[];
}

interface VariantOnlineStatus {
  id: string;
  name: string;
  variant_label: string | null;
  sku: string;
  price_cents: number;
  online: boolean;
}

const FLD = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none";
const AREA = `${FLD} min-h-[80px] resize-y`;

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-1 disabled:opacity-40 ${on ? "bg-brand-600" : "bg-slate-200"}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <p className="text-sm font-semibold text-[#111]">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      </div>
      <div className="space-y-3 px-5 py-4">{children}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{children}</label>;
}

// ── Image row ─────────────────────────────────────────────────────────────────

function ImageRow({ url, onRemove }: { url: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="h-10 w-10 shrink-0 rounded-md bg-slate-200 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      </div>
      <p className="flex-1 truncate text-xs text-slate-500">{url}</p>
      <button type="button" onClick={onRemove} className="text-slate-400 hover:text-red-500">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── EcommerceTab ──────────────────────────────────────────────────────────────

export function EcommerceTab({ product }: { product: CatalogProduct }) {
  const [settings, setSettings] = useState<OnlineSettings>({
    online: !!(product.ecommerce),
    online_price_cents: null,
    online_title: null,
    online_description: null,
    seo_slug: slugify(product.name),
    seo_title: null,
    seo_description: null,
    images: product.image_url ? [product.image_url] : [],
  });
  const [variants, setVariants] = useState<VariantOnlineStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [loadingVariants, setLoadingVariants] = useState(false);

  // Load existing online settings
  useEffect(() => {
    apiGet<OnlineSettings>(`/api/v1/ecommerce/products/${product.id}`)
      .then((data) => setSettings((s) => ({ ...s, ...data })))
      .catch(() => {});
  }, [product.id]);

  // Load variants if this is a master
  const loadVariants = useCallback(async () => {
    setLoadingVariants(true);
    try {
      const res = await apiGet<{ items: CatalogProduct[] }>(`/api/v1/catalog/${product.id}/variants`);
      setVariants(res.items.map((v) => ({
        id: v.id,
        name: v.name,
        variant_label: v.variant_label ?? null,
        sku: v.sku,
        price_cents: v.price_cents,
        online: !!(v.ecommerce),
      })));
    } catch { /* noop */ }
    finally { setLoadingVariants(false); }
  }, [product.id]);

  useEffect(() => { void loadVariants(); }, [loadVariants]);

  const set = <K extends keyof OnlineSettings>(k: K, v: OnlineSettings[K]) => {
    setSettings((s) => ({ ...s, [k]: v }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      await apiPut(`/api/v1/ecommerce/products/${product.id}/online`, settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Save failed.");
    } finally { setSaving(false); }
  };

  const toggleVariant = async (variantId: string, online: boolean) => {
    setVariants((prev) => prev.map((v) => v.id === variantId ? { ...v, online } : v));
    await apiPut(`/api/v1/ecommerce/products/${variantId}/online`, { online }).catch(() => {});
  };

  const storeUrl = `/store/${product.id}`;
  const displayPrice = settings.online_price_cents ?? product.price_cents;
  const inStoreDiff = settings.online_price_cents != null && settings.online_price_cents !== product.price_cents;

  return (
    <div className="space-y-4">

      {/* ── Online status banner ─────────────────────────────────────────── */}
      <div className={`flex items-center justify-between rounded-xl border px-5 py-4 shadow-sm ${settings.online ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
        <div>
          <p className="text-sm font-semibold text-[#111]">
            {settings.online ? "Listed on website" : "Not listed on website"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {settings.online
              ? "Customers can find and purchase this product online."
              : "Toggle on to make this product visible in your online store."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {settings.online && (
            <a
              href={storeUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Preview
            </a>
          )}
          <Toggle on={settings.online} onChange={(v) => set("online", v)} />
        </div>
      </div>

      {settings.online && (
        <>
          {/* ── Online pricing ───────────────────────────────────────────── */}
          <Section title="Online Pricing" hint="Override your in-store price for the web channel.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel>Online Price ($)</FieldLabel>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={FLD}
                  value={settings.online_price_cents != null ? (settings.online_price_cents / 100).toFixed(2) : ""}
                  onChange={(e) => set("online_price_cents", e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null)}
                  placeholder={`${(product.price_cents / 100).toFixed(2)} (same as in-store)`}
                />
                {inStoreDiff && (
                  <p className={`mt-1 text-xs ${displayPrice < product.price_cents ? "text-emerald-600" : "text-amber-600"}`}>
                    {displayPrice < product.price_cents
                      ? `${formatMoney(product.price_cents - displayPrice)} below in-store price`
                      : `${formatMoney(displayPrice - product.price_cents)} above in-store price`}
                  </p>
                )}
              </div>
              <div>
                <FieldLabel>Display Price</FieldLabel>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-[#111]">
                  {formatMoney(displayPrice)}
                  {inStoreDiff && (
                    <span className="ml-2 text-xs font-normal text-slate-400">overrides {formatMoney(product.price_cents)}</span>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {/* ── Online listing details ───────────────────────────────────── */}
          <Section title="Listing Details" hint="Customize how this product appears to customers online.">
            <div>
              <FieldLabel>Display Title</FieldLabel>
              <input
                className={FLD}
                value={settings.online_title ?? ""}
                onChange={(e) => set("online_title", e.target.value || null)}
                placeholder={product.name}
              />
              <p className="mt-1 text-[11px] text-slate-400">Leave blank to use the product name: <em>{product.name}</em></p>
            </div>
            <div>
              <FieldLabel>Online Description</FieldLabel>
              <textarea
                className={AREA}
                value={settings.online_description ?? ""}
                onChange={(e) => set("online_description", e.target.value || null)}
                placeholder="Describe this product for online customers…"
              />
            </div>
          </Section>

          {/* ── Images ──────────────────────────────────────────────────── */}
          <Section title="Product Images" hint="Images shown to customers in the online store (up to 5).">
            <div className="space-y-2">
              {settings.images.map((url, i) => (
                <ImageRow
                  key={i}
                  url={url}
                  onRemove={() => set("images", settings.images.filter((_, idx) => idx !== i))}
                />
              ))}
            </div>
            {settings.images.length < 5 && (
              <div className="flex gap-2">
                <input
                  className={`${FLD} flex-1`}
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newImageUrl.trim()) {
                      set("images", [...settings.images, newImageUrl.trim()]);
                      setNewImageUrl("");
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!newImageUrl.trim()}
                  onClick={() => { set("images", [...settings.images, newImageUrl.trim()]); setNewImageUrl(""); }}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            )}
          </Section>

          {/* ── SEO ─────────────────────────────────────────────────────── */}
          <Section title="SEO & URL" hint="Control how search engines and the URL display this product.">
            <div>
              <FieldLabel>URL Slug</FieldLabel>
              <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 focus-within:border-brand-600">
                <span className="shrink-0 bg-slate-50 px-3 py-2 text-xs text-slate-400 border-r border-slate-200">/store/</span>
                <input
                  className="flex-1 px-3 py-2 text-sm outline-none"
                  value={settings.seo_slug ?? ""}
                  onChange={(e) => set("seo_slug", e.target.value)}
                  placeholder={slugify(product.name)}
                />
              </div>
            </div>
            <div>
              <FieldLabel>Meta Title</FieldLabel>
              <input
                className={FLD}
                value={settings.seo_title ?? ""}
                onChange={(e) => set("seo_title", e.target.value || null)}
                placeholder={settings.online_title ?? product.name}
                maxLength={60}
              />
              <p className="mt-1 text-[11px] text-slate-400">{(settings.seo_title ?? "").length}/60 characters</p>
            </div>
            <div>
              <FieldLabel>Meta Description</FieldLabel>
              <textarea
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none min-h-[60px] resize-y"
                value={settings.seo_description ?? ""}
                onChange={(e) => set("seo_description", e.target.value || null)}
                placeholder="Brief description for search engines…"
                maxLength={160}
              />
              <p className="mt-1 text-[11px] text-slate-400">{(settings.seo_description ?? "").length}/160 characters</p>
            </div>

            {/* SERP preview */}
            {(settings.seo_title || settings.seo_description) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Search preview</p>
                <p className="text-sm font-medium text-blue-600 truncate">{settings.seo_title ?? settings.online_title ?? product.name}</p>
                <p className="text-xs text-emerald-700">yourstore.com/store/{settings.seo_slug ?? slugify(product.name)}</p>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{settings.seo_description ?? settings.online_description ?? product.name}</p>
              </div>
            )}
          </Section>

          {/* ── Variants online status ───────────────────────────────────── */}
          {variants.length > 0 && (
            <Section title="Variant Visibility" hint="Control which variants customers can see and purchase online.">
              {loadingVariants ? (
                <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-100"/>)}</div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                  {variants.map((v) => (
                    <div key={v.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#111] truncate">{v.name}</p>
                        <p className="text-xs text-slate-400">{v.sku} · {formatMoney(v.price_cents)}</p>
                      </div>
                      {v.variant_label && (
                        <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-600 shrink-0">
                          {v.variant_label}
                        </span>
                      )}
                      <Toggle on={v.online} onChange={(val) => void toggleVariant(v.id, val)} />
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}
        </>
      )}

      {/* ── Save bar ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <span className="text-sm font-medium text-emerald-600">Saved</span>}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Save online settings"}
        </button>
      </div>
    </div>
  );
}
