"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { apiGet, apiPost, apiPatch, ApiResponseError } from "@/api-client/client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProductImage {
  id: string;
  product_id: string;
  url: string;
  alt: string | null;
  sort_order: number;
  is_primary: boolean;
  created_at: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImagesTab({ productId }: { productId: string }) {
  const [images, setImages]   = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [altInput, setAltInput] = useState("");
  const [urlError, setUrlError] = useState("");

  const urlRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await apiGet<{ items: ProductImage[] }>(`/api/v1/catalog/${productId}/images`);
      setImages(d.items ?? []);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load images.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const openAdd = () => {
    setUrlInput(""); setAltInput(""); setUrlError(""); setShowAdd(true);
    setTimeout(() => urlRef.current?.focus(), 50);
  };

  const addImage = async () => {
    if (!urlInput.trim()) { setUrlError("URL is required"); return; }
    try { new URL(urlInput.trim()); } catch { setUrlError("Enter a valid URL (e.g. https://…)"); return; }
    setBusy(true);
    try {
      await apiPost(`/api/v1/catalog/${productId}/images`, { url: urlInput.trim(), alt: altInput.trim() || null });
      setShowAdd(false); setUrlInput(""); setAltInput("");
      await load();
    } catch (e) {
      setUrlError(e instanceof ApiResponseError ? e.message : "Failed to add image.");
    } finally { setBusy(false); }
  };

  const setPrimary = async (img: ProductImage) => {
    if (img.is_primary) return;
    setBusy(true);
    try {
      await apiPatch(`/api/v1/catalog/${productId}/images/${img.id}`, { is_primary: true });
      await load();
    } finally { setBusy(false); }
  };

  const removeImage = async (img: ProductImage) => {
    if (!confirm("Remove this image from the product?")) return;
    setBusy(true);
    try {
      await fetch(`/api/v1/catalog/${productId}/images/${img.id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  };

  if (loading) return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {[1, 2, 3].map((i) => <div key={i} className="aspect-square animate-pulse rounded-xl bg-slate-100" />)}
    </div>
  );

  if (error) return <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;

  return (
    <div className="space-y-5">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-700">Product Images</p>
          <p className="text-xs text-slate-400">{images.length} image{images.length !== 1 ? "s" : ""} · Add via URL</p>
        </div>
        <Button size="sm" variant="secondary" onClick={openAdd}>+ Add image</Button>
      </div>

      {/* ── Add image form ─────────────────────────────────────────────────── */}
      {showAdd && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Add Image via URL</p>
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Image URL *</label>
              <input
                ref={urlRef}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); setUrlError(""); }}
                placeholder="https://example.com/image.jpg"
              />
              {urlError && <p className="mt-1 text-xs text-red-600">{urlError}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Alt text</label>
              <input
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                value={altInput}
                onChange={(e) => setAltInput(e.target.value)}
                placeholder="Describe the image"
              />
            </div>
          </div>
          {urlInput && !urlError && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urlInput} alt="Preview" className="max-h-40 w-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={addImage} disabled={busy || !urlInput.trim()}>
              {busy ? "Adding…" : "Add image"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Image grid ─────────────────────────────────────────────────────── */}
      {images.length === 0 && !showAdd ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-16 text-center">
          <svg className="mx-auto mb-3 h-10 w-10 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
          <p className="text-sm text-slate-400">No images yet</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={openAdd}>Add first image</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img) => (
            <div key={img.id} className={`group relative overflow-hidden rounded-xl border-2 bg-white shadow-sm transition-all ${img.is_primary ? "border-brand-600" : "border-slate-200 hover:border-slate-300"}`}>
              {/* Image */}
              <div className="aspect-square overflow-hidden bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.alt ?? "Product image"}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  onError={(e) => {
                    const el = e.target as HTMLImageElement;
                    el.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23f1f5f9'/%3E%3Ctext x='50' y='55' text-anchor='middle' fill='%2394a3b8' font-size='12'%3ENo preview%3C/text%3E%3C/svg%3E";
                  }}
                />
              </div>

              {/* Primary badge */}
              {img.is_primary && (
                <div className="absolute left-2 top-2">
                  <Badge variant="blue">Primary</Badge>
                </div>
              )}

              {/* Actions overlay on hover */}
              <div className="absolute inset-x-0 bottom-0 flex translate-y-full flex-col gap-1 bg-white/95 p-2 shadow-md transition-transform group-hover:translate-y-0">
                {img.alt && <p className="truncate text-[11px] text-slate-400">"{img.alt}"</p>}
                <div className="flex gap-1">
                  {!img.is_primary && (
                    <button
                      type="button"
                      onClick={() => void setPrimary(img)}
                      disabled={busy}
                      className="flex-1 rounded border border-brand-600/30 py-1 text-[11px] font-medium text-brand-600 hover:bg-brand-600/5 disabled:opacity-40"
                    >
                      Set primary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void removeImage(img)}
                    disabled={busy}
                    className="flex-1 rounded border border-red-200 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Add placeholder */}
          <button
            type="button"
            onClick={openAdd}
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-white text-slate-400 transition-colors hover:border-brand-600 hover:text-brand-600"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span className="text-xs font-medium">Add image</span>
          </button>
        </div>
      )}
    </div>
  );
}
