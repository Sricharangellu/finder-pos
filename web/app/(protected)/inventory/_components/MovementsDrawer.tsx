"use client";

import { useCallback, useEffect, useState } from "react";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, ApiResponseError } from "@/api-client/client";
import type { StockMovement } from "./shared";
import { fmtDateTime } from "@/lib/date";

const MOVEMENT_TYPE_BADGE: Record<StockMovement["type"], { label: string; color: string }> = {
  sale:       { label: "Sale",       color: "bg-blue-50 text-blue-700 ring-blue-200" },
  adjustment: { label: "Adjustment", color: "bg-warning-50 text-warning-700 ring-warning-200" },
  receive:    { label: "PO Receive", color: "bg-success-50 text-success-700 ring-success-200" },
  transfer:   { label: "Transfer",   color: "bg-purple-50 text-purple-700 ring-purple-200" },
  return:     { label: "Return",     color: "bg-slate-100 text-slate-600 ring-slate-200" },
};



export function MovementsDrawer({
  product,
  onClose,
}: {
  product: { id: string; name: string; sku: string } | null;
  onClose: () => void;
}) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!product) return;
    setLoading(true);
    setError(null);
    apiGet<{ items: StockMovement[] }>(`/api/v1/inventory/movements?product_id=${encodeURIComponent(product.id)}&limit=20`)
      .then((d) => setMovements(d.items ?? []))
      .catch((err) => setError(err instanceof ApiResponseError ? err.message : "Failed to load movements"))
      .finally(() => setLoading(false));
  }, [product]);

  useEffect(() => { load(); }, [load]);

  if (!product) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-white shadow-2xl">
        <div className="flex flex-none items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Stock movements</h2>
            <p className="text-sm text-slate-500">{product.name} · {product.sku}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-950"
            aria-label="Close drawer"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <TableSkeleton headers={["Date", "Type", "Delta", "Location", "Actor", "Note"]} rows={5} />
          ) : error ? (
            <div className="p-6 text-sm text-danger-700" role="alert">{error}</div>
          ) : movements.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--color-text-secondary)]">No movements recorded yet.</div>
          ) : (
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Delta</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {movements.map((m) => {
                  const badge = MOVEMENT_TYPE_BADGE[m.type as StockMovement["type"]];
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDateTime(m.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${m.delta < 0 ? "text-danger-600" : "text-success-600"}`}>
                        {m.delta > 0 ? `+${m.delta}` : String(m.delta)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{m.location}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{m.actor}</td>
                      <td className="px-4 py-3 text-slate-500">{m.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
