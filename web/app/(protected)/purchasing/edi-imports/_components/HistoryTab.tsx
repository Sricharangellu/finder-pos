"use client";
import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { Badge } from "@/components/Badge";
import type { BadgeVariant } from "@/components/Badge";

type EdiStatus = "processed" | "failed";

interface EdiImport {
  id: string;
  filename: string;
  format: string;
  supplier_name: string;
  file_size_bytes: number;
  record_count: number;
  status: EdiStatus | string;
  uploaded_at: number;
  processed_at: number | null;
  po_count: number;
  line_count: number;
  error_count: number;
  warnings: string[];
  errors: string[];
  created_po_ids: string[];
}

const STATUS_BADGE: Record<string, BadgeVariant> = {
  processed: "green",
  failed: "red",
};

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtBytes(b: number): string {
  return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;
}

export function HistoryTab() {
  const [items, setItems] = useState<EdiImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: EdiImport[] }>("/api/v1/purchasing/edi-imports");
      setItems(res.items.filter((i) => ["processed", "failed"].includes(i.status)));
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>;
  if (error) return <p role="alert" className="text-sm text-red-700 py-6">{error}</p>;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">
        {items.length} completed import{items.length !== 1 ? "s" : ""}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">File</th>
              <th className="px-4 py-3 text-left">Supplier</th>
              <th className="px-4 py-3 text-left">Format</th>
              <th className="px-4 py-3 text-right">POs Created</th>
              <th className="px-4 py-3 text-right">Lines</th>
              <th className="px-4 py-3 text-left">Uploaded</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900 truncate max-w-[200px]">{item.filename}</p>
                  <p className="text-xs text-slate-400">{fmtBytes(item.file_size_bytes)}</p>
                </td>
                <td className="px-4 py-3 text-slate-700">{item.supplier_name}</td>
                <td className="px-4 py-3 text-slate-500 text-xs uppercase">{item.format.replace("_", " ")}</td>
                <td className="px-4 py-3 text-right">
                  {item.created_po_ids.length > 0 ? (
                    <div>
                      <p className="font-medium text-slate-900">{item.created_po_ids.length}</p>
                      <p className="text-xs text-slate-400">{item.created_po_ids.slice(0, 2).join(", ")}{item.created_po_ids.length > 2 ? "…" : ""}</p>
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-700">{item.line_count || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{fmtDate(item.uploaded_at)}</td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_BADGE[item.status] ?? "gray"}>
                    {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                  </Badge>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-sm text-slate-400">No imports processed yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
