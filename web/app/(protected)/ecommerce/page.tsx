"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge, statusBadge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPatch, ApiResponseError } from "@/api-client/client";
import type { OnlineOrder } from "@/api-client/types";
import { usePathname, useRouter } from "next/navigation";

// ── Local types ──────────────────────────────────────────────────────────────

interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  price_cents: number;
  category: string;
  status: string;
  ecommerce?: boolean;
}

interface StorefrontSettings {
  storeName: string;
  acceptOnlineOrders: boolean;
}

type Tab = "catalog" | "orders" | "settings";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function orderTotal(o: OnlineOrder): number {
  return o.total_cents ?? o.totalCents ?? 0;
}

function orderNumber(o: OnlineOrder): string {
  return o.so_number ?? o.orderNumber ?? o.id;
}

function orderDate(o: OnlineOrder): number | null {
  return o.created_at ?? o.createdAt ?? null;
}

// ── Tab: Catalog ─────────────────────────────────────────────────────────────

function CatalogTab() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await apiGet<{ items: CatalogItem[] }>("/api/v1/catalog?limit=500&status=active");
      setItems(r.items ?? []);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load catalog");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = q
    ? items.filter(
        (p) =>
          p.name.toLowerCase().includes(q.toLowerCase()) ||
          p.sku.toLowerCase().includes(q.toLowerCase())
      )
    : items;

  const togglePublish = async (item: CatalogItem) => {
    setToggling((prev) => new Set(prev).add(item.id));
    try {
      await apiPatch(`/api/v1/catalog/${item.id}`, { ecommerce: !item.ecommerce });
      setItems((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, ecommerce: !p.ecommerce } : p))
      );
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to update product");
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const publishedCount = items.filter((p) => p.ecommerce).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Storefront Catalog</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Toggle which products are published to your online store.
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Published</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{publishedCount}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <Card title="Online Catalog" description="Products flagged for ecommerce appear in the storefront." noPadding>
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            className="min-h-[44px] w-full max-w-sm rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                <th className="px-5 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-5 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-center">Published</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                    No products found.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-5 py-3 font-mono text-xs font-semibold text-slate-700">
                    {p.sku}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-950">{p.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{p.category}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums text-slate-950">
                    {formatMoney(p.price_cents)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-center">
                    <button
                      type="button"
                      disabled={toggling.has(p.id)}
                      onClick={() => void togglePublish(p)}
                      aria-label={p.ecommerce ? "Unpublish from store" : "Publish to store"}
                      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:opacity-50"
                      style={{ backgroundColor: p.ecommerce ? "#2563eb" : "#e2e8f0" }}
                    >
                      <span
                        className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200"
                        style={{ transform: p.ecommerce ? "translateX(16px)" : "translateX(0)" }}
                      />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Tab: Online Orders ────────────────────────────────────────────────────────

function OrdersTab() {
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setError(null);
        // Try ecommerce orders endpoint, fall back to general orders
        let items: OnlineOrder[] = [];
        try {
          const r = await apiGet<{ items: OnlineOrder[] }>("/api/v1/ecommerce/orders");
          items = r.items ?? [];
        } catch {
          const r = await apiGet<{ items: OnlineOrder[] }>("/api/v1/sales/orders?type=ecommerce");
          items = r.items ?? [];
        }
        setOrders(items);
      } catch (e) {
        setError(e instanceof ApiResponseError ? e.message : "Failed to load online orders");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-slate-950">Online Orders</h2>
        <p className="mt-0.5 text-sm text-slate-500">Orders placed through your online storefront.</p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <TableSkeleton headers={["Order #", "Customer", "Status", "Total", "Date"]} rows={8} />
      ) : (
      <Card noPadding>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Order #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No online orders yet.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-slate-700">
                      {orderNumber(order)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-950">
                      {order.customerName ?? order.customer_id ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge variant={statusBadge(order.status)}>{order.status}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-950">
                      {formatMoney(orderTotal(order))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {fmtDate(orderDate(order))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      )}
    </div>
  );
}

// ── Tab: Storefront Settings ──────────────────────────────────────────────────

function SettingsTab() {
  const [settings, setSettings] = useState<StorefrontSettings>({
    storeName: "",
    acceptOnlineOrders: true,
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load from settings API if available
    const load = async () => {
      try {
        const r = await apiGet<{ storeName?: string; acceptOnlineOrders?: boolean }>(
          "/api/v1/settings/business"
        );
        setSettings({
          storeName: r.storeName ?? "",
          acceptOnlineOrders: r.acceptOnlineOrders ?? true,
        });
      } catch {
        // Use defaults
      }
    };
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiPatch("/api/v1/settings/business", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-slate-950">Storefront Settings</h2>
        <p className="mt-0.5 text-sm text-slate-500">Configure your online storefront.</p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          Settings saved.
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-5 max-w-lg">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Store name</span>
            <input
              type="text"
              value={settings.storeName}
              onChange={(e) => setSettings((prev) => ({ ...prev, storeName: e.target.value }))}
              placeholder="e.g. My Store"
              className="mt-1 min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
            />
          </label>

          <div>
            <span className="text-xs font-medium uppercase text-slate-500">Storefront URL</span>
            <div className="mt-1 flex min-h-[44px] items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 select-all">
              https://store.finder-pos.app/demo
            </div>
            <p className="mt-1 text-xs text-slate-400">Read-only — contact support to change your store URL.</p>
          </div>

          <div className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-950">Accept online orders</p>
              <p className="mt-0.5 text-xs text-slate-500">When off, the storefront shows products but checkout is disabled.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.acceptOnlineOrders}
              onClick={() =>
                setSettings((prev) => ({ ...prev, acceptOnlineOrders: !prev.acceptOnlineOrders }))
              }
              className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
              style={{ backgroundColor: settings.acceptOnlineOrders ? "#2563eb" : "#e2e8f0" }}
            >
              <span
                className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200"
                style={{ transform: settings.acceptOnlineOrders ? "translateX(16px)" : "translateX(0)" }}
              />
            </button>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-medium text-slate-950">Shipping zones</p>
            <p className="mt-1 text-xs text-slate-500">
              Shipping zones and rates are configured under{" "}
              <a href="/settings" className="text-brand-600 hover:underline">
                Settings → Shipping Methods
              </a>
              . Zones can be assigned per delivery area.
            </p>
          </div>
        </div>

        <div className="mt-5 flex gap-2 border-t border-slate-200 pt-4">
          <Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "catalog", label: "Catalog" },
  { id: "orders", label: "Online Orders" },
  { id: "settings", label: "Storefront Settings" },
];

export default function EcommercePage() {
  const pathname = usePathname();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>(() => ecommerceTabFromPath(pathname));

  useEffect(() => setActiveTab(ecommerceTabFromPath(pathname)), [pathname]);

  return (
    <EnterpriseShell
      active="ecommerce"
      title="Ecommerce"
      subtitle="Online store management"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {/* Tab bar */}
        <div className="border-b border-slate-200">
          <nav className="-mb-px flex gap-6" aria-label="Ecommerce tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  router.replace(tab.id === "catalog" ? "/ecommerce/products" : tab.id === "orders" ? "/ecommerce/orders" : "/ecommerce/shipping", { scroll: false });
                }}
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={[
                  "whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors",
                  activeTab === tab.id
                    ? "border-slate-950 text-slate-950"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab panels */}
        {activeTab === "catalog" && <CatalogTab />}
        {activeTab === "orders" && <OrdersTab />}
        {activeTab === "settings" && <SettingsTab />}
      </div>
    </EnterpriseShell>
  );
}

function ecommerceTabFromPath(pathname: string): Tab {
  if (pathname.endsWith("/orders")) return "orders";
  if (pathname.endsWith("/shipping")) return "settings";
  return "catalog";
}
