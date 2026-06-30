"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { ProShopItem } from "@/api-client/types";

type ProShopCategory = ProShopItem["category"];
type BadgeVariant = "green" | "yellow" | "red" | "gray" | "blue" | "purple";

const CAT_LABEL: Record<ProShopCategory, string> = {
  clubs: "Clubs",
  balls: "Balls",
  apparel: "Apparel",
  accessories: "Accessories",
  footwear: "Footwear",
  bags: "Bags",
};

interface ProShopResponse { items: ProShopItem[]; total: number; low_stock_count: number; }

function stockBadge(item: ProShopItem): { variant: BadgeVariant; label: string } {
  if (item.stock_qty === 0) return { variant: "red", label: "Out of stock" };
  if (item.stock_qty <= item.reorder_pt) return { variant: "yellow", label: "Low stock" };
  return { variant: "green", label: "In stock" };
}

function margin(item: ProShopItem): number {
  if (!item.price_cents || !item.cost_cents) return 0;
  return Math.round(((item.price_cents - item.cost_cents) / item.price_cents) * 100);
}

export default function GolfProShopPage() {
  const [items, setItems] = useState<ProShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<"all" | ProShopCategory>("all");
  const [q, setQ] = useState("");
  const [lowStockCount, setLowStockCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<ProShopResponse>("/api/v1/golf/pro-shop");
      setItems(data.items ?? []);
      setLowStockCount(data.low_stock_count ?? 0);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load pro shop inventory.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    let list = items;
    if (filterCategory !== "all") list = list.filter(p => p.category === filterCategory);
    if (q.trim()) {
      const lq = q.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(lq) ||
        p.sku.toLowerCase().includes(lq) ||
        (p.brand ?? "").toLowerCase().includes(lq),
      );
    }
    return list;
  }, [items, filterCategory, q]);

  const totalValue = useMemo(() =>
    items.reduce((s, i) => s + i.price_cents * i.stock_qty, 0), [items]);

  const categories = useMemo(() =>
    (["all", "clubs", "balls", "apparel", "accessories", "footwear", "bags"] as const).filter(c =>
      c === "all" || items.some(i => i.category === c),
    ), [items]);

  return (
    <EnterpriseShell active="golf-pro-shop" title="Pro Shop" subtitle="Equipment & apparel inventory"
      contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">

        {/* Sub-nav */}
        <div className="flex items-center gap-2 flex-wrap">
          <a href="/golf" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Tee Sheet</a>
          <a href="/golf/bookings" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Bookings</a>
          <a href="/golf/members" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Members</a>
          <a href="/golf/pro-shop" className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white">Pro Shop</a>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs text-slate-500">SKUs</p>
            <p className="text-xl font-bold text-slate-900">{items.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs text-slate-500">Retail Value</p>
            <p className="text-xl font-bold text-slate-900">{formatMoney(totalValue)}</p>
          </div>
          <div className={`rounded-xl border px-4 py-3 ${lowStockCount > 0 ? "border-amber-100 bg-amber-50" : "border-slate-200 bg-white"}`}>
            <p className={`text-xs ${lowStockCount > 0 ? "text-amber-600" : "text-slate-500"}`}>Low Stock</p>
            <p className={`text-xl font-bold ${lowStockCount > 0 ? "text-amber-700" : "text-slate-400"}`}>{lowStockCount}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs text-slate-500">Out of Stock</p>
            <p className={`text-xl font-bold ${items.filter(i => i.stock_qty === 0).length > 0 ? "text-red-700" : "text-slate-400"}`}>
              {items.filter(i => i.stock_qty === 0).length}
            </p>
          </div>
        </div>

        {lowStockCount > 0 && (
          <div role="alert" className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-2 text-sm text-amber-700">
            {lowStockCount} item{lowStockCount !== 1 ? "s" : ""} at or below reorder point — review purchasing
          </div>
        )}

        {/* Category tabs */}
        <div className="flex flex-wrap gap-1.5">
          {categories.map(cat => {
            const count = cat === "all" ? items.length : items.filter(i => i.category === cat).length;
            return (
              <button key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        filterCategory === cat ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}>
                {cat === "all" ? "All" : CAT_LABEL[cat]} ({count})
              </button>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <input type="search" placeholder="Search name, SKU, brand…" value={q} onChange={e => setQ(e.target.value)}
                 className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          <Button variant="secondary" size="sm" onClick={load}>Refresh</Button>
          <a href="/catalog/new?category=golf" className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700">
            + Add Item
          </a>
        </div>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-14 text-center">
            <p className="text-sm font-medium text-slate-600">No items match your filters</p>
            <p className="mt-1 text-xs text-slate-400">Pro shop items are managed from the main Catalog.</p>
            <a href="/catalog" className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Go to Catalog
            </a>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3 text-right">Margin</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map(item => {
                  const { variant, label } = stockBadge(item);
                  const mg = margin(item);
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-400">{item.sku}{item.brand ? ` · ${item.brand}` : ""}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="gray">{CAT_LABEL[item.category]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {formatMoney(item.price_cents)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        {item.cost_cents ? formatMoney(item.cost_cents) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-medium ${mg >= 30 ? "text-green-700" : mg > 0 ? "text-amber-700" : "text-slate-400"}`}>
                          {mg > 0 ? `${mg}%` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className={`font-medium ${item.stock_qty === 0 ? "text-red-700" : item.stock_qty <= item.reorder_pt ? "text-amber-700" : "text-slate-900"}`}>
                          {item.stock_qty}
                        </p>
                        <p className="text-xs text-slate-400">min {item.reorder_pt}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={variant}>{label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
