"use client";

/**
 * FE-47: Price Book page — view and manage outlet-specific price overrides.
 * Uses the customer_product_prices table via /customers/:id/product-prices.
 * Shows a searchable product grid; inline price editing per outlet/customer.
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { apiGet, apiPost, safeLoad } from "@/api-client/client";
import { formatMoney } from "@/lib/money";

interface Product { id: string; sku: string; name: string; price_cents: number; category: string; }
interface Customer { id: string; name: string; email: string | null; }
interface PriceOverride { product_id: string; price_cents: number; updated_at: number; }

export default function PriceBookPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [editing, setEditing] = useState<{ productId: string; value: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // Load products
  useEffect(() => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: Product[] }>("/api/v1/catalog?pageSize=200")
        .then((r) => setProducts(r.items ?? []))
        .finally(() => setLoading(false)),
    );
    safeLoad(
      apiGet<{ items: Customer[] }>("/api/v1/customers?pageSize=200")
        .then((r) => setCustomers(r.items ?? [])),
    );
  }, []);

  // Load price overrides when customer changes
  useEffect(() => {
    if (!selectedCustomer) { setOverrides(new Map()); return; }
    safeLoad(
      apiGet<{ items: PriceOverride[] }>(`/api/v1/customers/${selectedCustomer}/product-prices`)
        .then((r) => {
          const map = new Map<string, number>();
          for (const o of r.items ?? []) map.set(o.product_id, o.price_cents);
          setOverrides(map);
        }),
    );
  }, [selectedCustomer]);

  const handleSave = async (productId: string) => {
    if (!selectedCustomer || !editing || editing.productId !== productId) return;
    const cents = Math.round(parseFloat(editing.value) * 100);
    if (isNaN(cents) || cents < 0) return;
    setSaving(true);
    try {
      await apiPost(`/api/v1/customers/${selectedCustomer}/product-prices`, {
        productId,
        priceCents: cents,
      });
      setOverrides((prev) => new Map(prev).set(productId, cents));
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const filtered = products.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <EnterpriseShell active="catalog" title="Price Book" subtitle="Customer-specific price overrides">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedCustomer}
            onChange={(e) => setSelectedCustomer(e.target.value)}
            className="h-8 rounded border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-brand-600"
          >
            <option value="">Select customer to edit prices</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-48 rounded border border-slate-200 px-3 text-[13px] outline-none focus:border-brand-600"
          />
          {!selectedCustomer && (
            <p className="text-xs text-[var(--color-text-secondary)]">
              Select a customer above to view and edit their custom prices.
            </p>
          )}
        </div>

        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-table-border)] text-xs text-[var(--color-text-secondary)]">
                <th className="pb-2 text-left">SKU</th>
                <th className="pb-2 text-left">Product</th>
                <th className="pb-2 text-left">Category</th>
                <th className="pb-2 text-right">Standard Price</th>
                <th className="pb-2 text-right">Custom Price</th>
                <th className="pb-2 text-right">Discount</th>
                {selectedCustomer && <th className="pb-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-table-border)]">
              {loading ? (
                [1,2,3,4,5].map(i => (
                  <tr key={i}>
                    {[1,2,3,4,5,6].map(j => (
                      <td key={j} className="py-2"><div className="h-4 animate-pulse rounded bg-gray-100" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.map((p) => {
                const override = overrides.get(p.id);
                const isEditing = editing?.productId === p.id;
                const discountPct = override && override < p.price_cents
                  ? Math.round((1 - override / p.price_cents) * 100)
                  : null;
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="py-2 font-mono text-xs text-[var(--color-text-secondary)]">{p.sku}</td>
                    <td className="py-2 font-medium text-[var(--color-text-primary)]">{p.name}</td>
                    <td className="py-2 text-[var(--color-text-secondary)] capitalize">{p.category}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--color-text-secondary)]">{formatMoney(p.price_cents)}</td>
                    <td className="py-2 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          autoFocus
                          min="0"
                          step="0.01"
                          value={editing.value}
                          onChange={(e) => setEditing({ productId: p.id, value: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") void handleSave(p.id); if (e.key === "Escape") setEditing(null); }}
                          className="w-24 rounded border border-brand-600 px-2 py-0.5 text-right text-sm outline-none"
                        />
                      ) : (
                        <span className={`tabular-nums font-medium ${override ? "text-brand-600" : "text-[var(--color-text-secondary)]"}`}>
                          {override ? formatMoney(override) : "—"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {discountPct !== null ? (
                        <span className="text-xs font-semibold text-success-600">-{discountPct}%</span>
                      ) : "—"}
                    </td>
                    {selectedCustomer && (
                      <td className="py-2 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="primary" loading={saving} onClick={() => void handleSave(p.id)}>Save</Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setEditing({ productId: p.id, value: override ? (override / 100).toFixed(2) : (p.price_cents / 100).toFixed(2) })}>
                            {override ? "Edit" : "Set"}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </EnterpriseShell>
  );
}
