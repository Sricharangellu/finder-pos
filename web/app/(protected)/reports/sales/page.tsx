"use client";

/**
 * /reports/sales — Sales breakdown by category, customer, and product.
 * Owner/manager only. Supports Today / 7d / 30d date ranges.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney } from "@/lib/money";

// ─── Types ────────────────────────────────────────────────────────────────────

type Range = "today" | "7d" | "30d";
type Tab = "category" | "customer" | "product";

interface CategoryItem {
  category: string;
  revenue: number;
  qty: number;
  orderCount: number;
}

interface CustomerItem {
  customer_id: string;
  name: string;
  totalCents: number;
  orderCount: number;
}

interface ProductItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  revenue: number;
  qty: number;
}

interface CategoryResponse {
  items: CategoryItem[];
}

interface CustomerResponse {
  items: CustomerItem[];
}

interface ProductResponse {
  items: ProductItem[];
}

// ─── CSV export helper ────────────────────────────────────────────────────────

function downloadCsv(filename: string, rows: string[][]): void {
  const header = rows[0];
  if (!header) return;
  const lines = rows.map((r) =>
    r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div aria-busy="true" aria-label="Loading data" className="animate-pulse space-y-2 px-1 py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((__, j) => (
            <div
              key={j}
              className="h-5 flex-1 rounded bg-gray-100"
              style={{ opacity: 1 - i * 0.12 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Range toggle ─────────────────────────────────────────────────────────────

function RangeToggle({
  value,
  onChange,
}: {
  value: Range;
  onChange: (r: Range) => void;
}) {
  const labels: Record<Range, string> = { today: "Today", "7d": "7 days", "30d": "30 days" };
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
      {(["today", "7d", "30d"] as const).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`min-h-[40px] rounded-md px-3 text-sm font-medium transition-colors ${
            value === r ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          {labels[r]}
        </button>
      ))}
    </div>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "category", label: "By Category" },
    { key: "customer", label: "By Customer" },
    { key: "product", label: "By Product" },
  ];
  return (
    <div className="border-b border-gray-200 bg-white">
      <nav className="-mb-px flex gap-0 px-5" aria-label="Sales breakdown tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`min-h-[44px] border-b-2 px-4 text-sm font-medium transition-colors ${
              active === t.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
            aria-current={active === t.key ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalesReportPage() {
  const [range, setRange] = useState<Range>("today");
  const [tab, setTab] = useState<Tab>("category");

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [catData, cusData, proData] = await Promise.all([
          apiGet<CategoryResponse>(`/api/v1/reports/sales-by-category?range=${range}`),
          apiGet<CustomerResponse>(`/api/v1/reports/sales-by-customer?range=${range}`),
          apiGet<ProductResponse>(`/api/v1/reports/top-products?range=${range}&limit=50`),
        ]);
        if (!cancelled) {
          setCategories(catData.items ?? []);
          setCustomers(cusData.items ?? []);
          setProducts(proData.items ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiResponseError ? err.message : "Failed to load sales report."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [range]);

  const rangeLabel =
    range === "today" ? "Today" : range === "7d" ? "Last 7 days" : "Last 30 days";

  function handleExportCsv() {
    if (tab === "category") {
      downloadCsv(`sales-by-category-${range}.csv`, [
        ["Category", "Orders", "Qty Sold", "Revenue"],
        ...categories.map((c) => [
          c.category,
          String(c.orderCount),
          String(c.qty),
          formatMoney(c.revenue),
        ]),
      ]);
    } else if (tab === "customer") {
      downloadCsv(`sales-by-customer-${range}.csv`, [
        ["Customer", "Orders", "Total Spent"],
        ...customers.map((c) => [
          c.name,
          String(c.orderCount),
          formatMoney(c.totalCents),
        ]),
      ]);
    } else {
      downloadCsv(`sales-by-product-${range}.csv`, [
        ["SKU", "Name", "Category", "Qty", "Revenue"],
        ...products.map((p) => [
          p.sku,
          p.name,
          p.category,
          String(p.qty),
          formatMoney(p.revenue),
        ]),
      ]);
    }
  }

  return (
    <EnterpriseShell
      active="reports"
      title="Sales Report"
      subtitle={`Sales breakdown · Demo Store · ${rangeLabel}`}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        {/* Controls */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <RangeToggle value={range} onChange={setRange} />
          <Button variant="secondary" size="sm" onClick={handleExportCsv} disabled={loading}>
            Export CSV
          </Button>
        </div>

        <Card noPadding>
          <TabBar active={tab} onChange={setTab} />

          <div className="p-5">
            {loading ? (
              <TableSkeleton cols={tab === "category" ? 4 : tab === "customer" ? 3 : 5} />
            ) : error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : tab === "category" ? (
              <CategoryTable items={categories} />
            ) : tab === "customer" ? (
              <CustomerTable items={customers} />
            ) : (
              <ProductTable items={products} />
            )}
          </div>
        </Card>
      </div>
    </EnterpriseShell>
  );
}

// ─── Category table ───────────────────────────────────────────────────────────

function CategoryTable({ items }: { items: CategoryItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">No data for this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="pb-2 pr-4">Category</th>
            <th className="pb-2 pr-4 text-right">Orders</th>
            <th className="pb-2 pr-4 text-right">Qty Sold</th>
            <th className="pb-2 text-right">Revenue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map((item) => (
            <tr key={item.category} className="hover:bg-gray-50">
              <td className="py-2.5 pr-4 font-medium text-gray-900">{item.category}</td>
              <td className="py-2.5 pr-4 text-right text-gray-600">{item.orderCount}</td>
              <td className="py-2.5 pr-4 text-right text-gray-600">{item.qty}</td>
              <td className="py-2.5 text-right font-semibold text-gray-900">
                {formatMoney(item.revenue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Customer table ───────────────────────────────────────────────────────────

function CustomerTable({ items }: { items: CustomerItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">No data for this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="pb-2 pr-4">Customer</th>
            <th className="pb-2 pr-4 text-right">Orders</th>
            <th className="pb-2 text-right">Total Spent</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map((item) => (
            <tr key={item.customer_id} className="hover:bg-gray-50">
              <td className="py-2.5 pr-4">
                <Link
                  href={`/customers/${item.customer_id}`}
                  className="font-medium text-brand-600 hover:text-brand-800 hover:underline"
                >
                  {item.name}
                </Link>
              </td>
              <td className="py-2.5 pr-4 text-right text-gray-600">{item.orderCount}</td>
              <td className="py-2.5 text-right font-semibold text-gray-900">
                {formatMoney(item.totalCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Product table ────────────────────────────────────────────────────────────

function ProductTable({ items }: { items: ProductItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">No data for this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="pb-2 pr-4">SKU</th>
            <th className="pb-2 pr-4">Name</th>
            <th className="pb-2 pr-4">Category</th>
            <th className="pb-2 pr-4 text-right">Qty</th>
            <th className="pb-2 text-right">Revenue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-gray-50">
              <td className="py-2.5 pr-4 font-mono text-xs text-gray-500">{item.sku}</td>
              <td className="py-2.5 pr-4">
                <Link
                  href={`/inventory/products/${item.id}`}
                  className="font-medium text-brand-600 hover:text-brand-800 hover:underline"
                >
                  {item.name}
                </Link>
              </td>
              <td className="py-2.5 pr-4 text-gray-600">{item.category}</td>
              <td className="py-2.5 pr-4 text-right text-gray-600">{item.qty}</td>
              <td className="py-2.5 text-right font-semibold text-gray-900">
                {formatMoney(item.revenue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
