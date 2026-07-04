"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/money";
import { apiGet } from "@/api-client/client";

interface CatalogItem { id: string; sku: string; name: string; price_cents: number; category: string; }

export default function EcommercePage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await apiGet<{ items: CatalogItem[] }>(`/api/v1/catalog?limit=200${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      setItems(r.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load catalog");
    }
  }, [q]);

  useEffect(() => { void load(); }, [load]);

  return (
    <EnterpriseShell active="ecommerce" title="Ecommerce" subtitle="Online storefront catalog">
      <div className="space-y-4 p-4">
        {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        <Card title="Online Catalog" description="Products flagged for ecommerce appear in the storefront.">
          <div className="mb-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search online products…"
              className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">SKU</th><th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Category</th><th className="py-2 pr-4 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-400">No products published online yet</td></tr>}
                {items.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{p.sku}</td>
                    <td className="py-2 pr-4 font-medium">{p.name}</td>
                    <td className="py-2 pr-4 text-gray-500">{p.category}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(p.price_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </EnterpriseShell>
  );
}
