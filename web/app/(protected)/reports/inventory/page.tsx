"use client";

/**
 * /reports/inventory — Inventory valuation report.
 * Shows summary cards and a per-SKU breakdown with cost and retail values.
 */

import { useEffect, useState } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/money";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InventoryItem {
  category: string;
  sku: string;
  name: string;
  onHand: number;
  costCents: number;
  retailCents: number;
  totalCostCents: number;
  totalRetailCents: number;
}

interface InventorySummary {
  totalCostCents: number;
  totalRetailCents: number;
  totalItems: number;
}

interface InventoryValuationResponse {
  items: InventoryItem[];
  summary: InventorySummary;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-2 h-3 w-20 rounded bg-gray-100" />
      <div className="h-7 w-32 rounded bg-gray-100" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading data" className="animate-pulse space-y-2 px-1 py-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: 8 }).map((__, j) => (
            <div
              key={j}
              className="h-5 flex-1 rounded bg-gray-100"
              style={{ opacity: 1 - i * 0.1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InventoryReportPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await apiGet<InventoryValuationResponse>(
          "/api/v1/reports/inventory-valuation"
        );
        if (!cancelled) {
          setItems(data.items ?? []);
          // Handle both flat summary and nested shapes gracefully
          const s = data.summary ?? {};
          setSummary({
            totalCostCents: s.totalCostCents ?? 0,
            totalRetailCents: s.totalRetailCents ?? 0,
            totalItems: s.totalItems ?? (data.items?.length ?? 0),
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiResponseError
              ? err.message
              : "Failed to load inventory valuation."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <EnterpriseShell
      active="reports"
      title="Inventory Report"
      subtitle="Inventory valuation · Demo Store"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-6 space-y-6">
        {/* Summary cards */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : error ? (
          <Card>
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          </Card>
        ) : summary ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label="Total SKUs" value={summary.totalItems.toLocaleString()} />
            <SummaryCard
              label="Total Cost Value"
              value={formatMoney(summary.totalCostCents)}
            />
            <SummaryCard
              label="Total Retail Value"
              value={formatMoney(summary.totalRetailCents)}
            />
          </div>
        ) : null}

        {/* Detail table */}
        <Card title="Inventory Valuation" noPadding>
          <div className="p-5">
            {loading ? (
              <TableSkeleton />
            ) : error ? null : items.length === 0 ? (
              <p className="text-sm text-gray-500">No inventory data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <th className="pb-2 pr-4">SKU</th>
                      <th className="pb-2 pr-4">Name</th>
                      <th className="pb-2 pr-4">Category</th>
                      <th className="pb-2 pr-4 text-right">On Hand</th>
                      <th className="pb-2 pr-4 text-right">Cost/unit</th>
                      <th className="pb-2 pr-4 text-right">Retail/unit</th>
                      <th className="pb-2 pr-4 text-right">Total Cost</th>
                      <th className="pb-2 text-right">Total Retail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {items.map((item) => (
                      <tr key={item.sku} className="hover:bg-gray-50">
                        <td className="py-2.5 pr-4 font-mono text-xs text-gray-500">
                          {item.sku}
                        </td>
                        <td className="py-2.5 pr-4 font-medium text-gray-900">{item.name}</td>
                        <td className="py-2.5 pr-4 text-gray-600">{item.category}</td>
                        <td className="py-2.5 pr-4 text-right text-gray-600">{item.onHand}</td>
                        <td className="py-2.5 pr-4 text-right text-gray-600">
                          {formatMoney(item.costCents)}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-gray-600">
                          {formatMoney(item.retailCents)}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-medium text-gray-900">
                          {formatMoney(item.totalCostCents)}
                        </td>
                        <td className="py-2.5 text-right font-semibold text-gray-900">
                          {formatMoney(item.totalRetailCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {summary && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                        <td colSpan={6} className="py-2.5 pr-4 text-gray-700">
                          Totals
                        </td>
                        <td className="py-2.5 pr-4 text-right text-gray-900">
                          {formatMoney(summary.totalCostCents)}
                        </td>
                        <td className="py-2.5 text-right text-gray-900">
                          {formatMoney(summary.totalRetailCents)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>
    </EnterpriseShell>
  );
}
