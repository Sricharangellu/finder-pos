"use client";
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { Badge } from "@/components/Badge";
import type { BadgeVariant } from "@/components/Badge";

type EdiStatus = "queued" | "validating" | "valid" | "invalid" | "processed" | "failed";

interface EdiImport {
  id: string;
  filename: string;
  format: string;
  supplier_name: string;
  file_size_bytes: number;
  record_count: number;
  status: EdiStatus;
  uploaded_at: number;
  po_count: number;
  line_count: number;
  error_count: number;
  warnings: string[];
  errors: string[];
  created_po_ids: string[];
}

interface PreviewLine {
  line: number;
  raw: string;
  parsed: string;
}

interface ImportDetail extends EdiImport {
  format_label: string;
  preview_lines: PreviewLine[];
}

const STATUS_BADGE: Record<EdiStatus, BadgeVariant> = {
  queued: "gray",
  validating: "blue",
  valid: "green",
  invalid: "red",
  processed: "green",
  failed: "red",
};

const STATUS_LABEL: Record<EdiStatus, string> = {
  queued: "Queued",
  validating: "Validating…",
  valid: "Valid",
  invalid: "Invalid",
  processed: "Processed",
  failed: "Failed",
};

function fmtBytes(b: number): string {
  return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
}

export function QueueTab({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<EdiImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: EdiImport[] }>("/api/v1/purchasing/edi-imports?status=queued");
      // Show queued + valid + invalid (pending action)
      const all = await apiGet<{ items: EdiImport[] }>("/api/v1/purchasing/edi-imports");
      setItems(all.items.filter((i) => ["queued", "validating", "valid", "invalid"].includes(i.status)));
      void res;
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function openDetail(id: string) {
    try {
      const d = await apiGet<ImportDetail>(`/api/v1/purchasing/edi-imports/${id}`);
      setDetail(d);
    } catch {
      // ignore
    }
  }

  async function validate(id: string) {
    setActing(id);
    try {
      const updated = await apiPost<EdiImport>(`/api/v1/purchasing/edi-imports/${id}/validate`, {});
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      if (detail?.id === id) setDetail((d) => d ? { ...d, ...updated } : d);
      showToast("Validation complete.");
    } catch {
      showToast("Validation failed.");
    } finally {
      setActing(null);
    }
  }

  async function process(id: string) {
    setActing(id);
    try {
      const res = await apiPost<{ import: EdiImport; created_po_ids: string[] }>(`/api/v1/purchasing/edi-imports/${id}/process`, {});
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (detail?.id === id) setDetail(null);
      showToast(`Processed — ${res.created_po_ids.length} PO(s) created: ${res.created_po_ids.join(", ")}`);
    } catch {
      showToast("Processing failed.");
    } finally {
      setActing(null);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-400">Loading queue…</div>;
  if (error) return <p role="alert" className="text-sm text-red-700 py-6">{error}</p>;

  return (
    <div className="space-y-4">
      {toast && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">{toast}</div>
      )}

      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
          Queue is empty — upload a file to get started
        </div>
      )}

      {items.map((item) => (
        <div key={item.id} className={`rounded-lg border bg-white p-4 ${item.status === "invalid" ? "border-red-200" : "border-slate-200"}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => openDetail(item.id)}
                  className="font-medium text-blue-600 hover:underline truncate max-w-xs text-left">
                  {item.filename}
                </button>
                <Badge variant={STATUS_BADGE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                {item.supplier_name} · {item.format.toUpperCase().replace("_", " ")} · {fmtBytes(item.file_size_bytes)} · uploaded {fmtTime(item.uploaded_at)}
              </p>
              {item.warnings.length > 0 && (
                <p className="mt-1 text-xs text-amber-600">{item.warnings[0]}{item.warnings.length > 1 ? ` (+${item.warnings.length - 1} more)` : ""}</p>
              )}
              {item.errors.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {item.errors.slice(0, 2).map((e, i) => (
                    <p key={i} className="text-xs text-red-600">{e}</p>
                  ))}
                  {item.errors.length > 2 && <p className="text-xs text-red-400">+{item.errors.length - 2} more errors</p>}
                </div>
              )}
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              {item.status === "queued" && (
                <button type="button" disabled={acting === item.id} onClick={() => validate(item.id)}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {acting === item.id ? "…" : "Validate"}
                </button>
              )}
              {item.status === "valid" && (
                <button type="button" disabled={acting === item.id} onClick={() => process(item.id)}
                  className="rounded-md border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">
                  {acting === item.id ? "…" : `Process → ${item.po_count} PO${item.po_count !== 1 ? "s" : ""}`}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{detail.filename}</h2>
                <p className="text-xs text-slate-400">{detail.format_label} · {detail.supplier_name}</p>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-4 gap-3 text-center">
                {[
                  { label: "Records", value: detail.record_count },
                  { label: "POs", value: detail.po_count },
                  { label: "Lines", value: detail.line_count },
                  { label: "Errors", value: detail.error_count },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg bg-slate-50 py-2">
                    <p className={`text-lg font-bold ${s.label === "Errors" && s.value > 0 ? "text-red-600" : "text-slate-900"}`}>{s.value}</p>
                    <p className="text-xs text-slate-400">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Raw preview */}
              {detail.preview_lines.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-600">File preview</p>
                  <div className="rounded-lg bg-slate-900 p-3 font-mono text-xs text-green-300 overflow-x-auto space-y-2">
                    {detail.preview_lines.map((line) => (
                      <div key={line.line}>
                        <span className="text-slate-500 mr-2">{String(line.line).padStart(2, "0")}</span>
                        <span className="text-green-300">{line.raw.length > 60 ? line.raw.slice(0, 60) + "…" : line.raw}</span>
                        <span className="ml-3 text-slate-400">{`// ${line.parsed}`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Errors */}
              {detail.errors.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-red-600">Errors ({detail.errors.length})</p>
                  <ul className="space-y-1">
                    {detail.errors.map((e, i) => (
                      <li key={i} className="text-xs text-red-600 flex gap-1.5"><span className="flex-shrink-0">✕</span>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings */}
              {detail.warnings.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-amber-600">Warnings ({detail.warnings.length})</p>
                  <ul className="space-y-1">
                    {detail.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-600 flex gap-1.5"><span className="flex-shrink-0">⚠</span>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button type="button" onClick={() => setDetail(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Close</button>
              {detail.status === "queued" && (
                <button type="button" disabled={acting === detail.id} onClick={() => { validate(detail.id); }}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
                  {acting === detail.id ? "Validating…" : "Validate"}
                </button>
              )}
              {detail.status === "valid" && (
                <button type="button" disabled={acting === detail.id} onClick={() => { process(detail.id); }}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50">
                  {acting === detail.id ? "Processing…" : "Process & Create POs"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
