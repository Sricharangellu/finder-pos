"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { apiDownload, apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { hasRole } from "@/lib/auth";
import { fmtDate } from "@/lib/date";
import { ImportWizard, parsePreview } from "./_components/ImportWizard";
import type { CsvPreviewRow } from "./_components/ImportWizard";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImportBatch {
  id: string;
  import_type: string;
  file_name: string | null;
  status: string;
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  error_summary: string | null;
  created_at: number;
  completed_at: number | null;
}

interface ExportBatch {
  id: string;
  export_type: string;
  status: string;
  total_rows: number;
  file_url: string | null;
  created_at: number;
  completed_at: number | null;
}

interface ImportResult {
  created?: number;
  updated?: number;
  items?: unknown[];
}

const TEMPLATE = [
  "sku,name,priceCents,category,barcode",
  "COFFEE-001,House Blend,1299,Coffee,012345678901",
  "PASTRY-001,Butter Croissant,450,Pastry,012345678902",
].join("\n");

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ImportsExportsPage() {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [exportBatches, setExportBatches] = useState<ExportBatch[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = hasRole("manager");

  const loadHistory = useCallback(async () => {
    try {
      const [importsRes, exportsRes] = await Promise.all([
        apiGet<{ items: ImportBatch[] }>("/api/v1/sync/import-batches").catch(() => ({ items: [] as ImportBatch[] })),
        apiGet<{ items: ExportBatch[] }>("/api/v1/sync/export-batches").catch(() => ({ items: [] as ExportBatch[] })),
      ]);
      setImportBatches(importsRes.items ?? []);
      setExportBatches(exportsRes.items ?? []);
    } catch {
      setImportBatches([]);
      setExportBatches([]);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const preview = useMemo(() => parsePreview(csv), [csv]);
  const validRows = preview.filter((row) => row.valid).length;
  const invalidRows = preview.length - validRows;

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    setResult(null);
    setError(null);
  };

  const importCatalog = async () => {
    if (!csv.trim() || invalidRows > 0 || !canManage) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiPost<ImportResult>("/api/v1/catalog/import-csv", { csv });
      setResult(response);
      await loadHistory();
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Catalog import failed.");
    } finally {
      setBusy(false);
    }
  };

  const exportCatalog = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await apiDownload("/api/v1/catalog/export");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "finder-catalog.csv";
      anchor.click();
      URL.revokeObjectURL(url);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Catalog export failed.");
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "finder-catalog-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <EnterpriseShell active="imports-exports" title="Imports/Exports" subtitle="Bulk catalog onboarding, validation, and data packages" contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {error && (
          <div className="rounded-md border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {error}
          </div>
        )}
        {result && (
          <div className="rounded-md border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700" role="status">
            Import completed. Created {result.created ?? 0}, updated {result.updated ?? 0}, processed {result.items?.length ?? validRows} rows.
          </div>
        )}

        {/* Import Wizard */}
        <ImportWizard onImportDone={() => void loadHistory()} />

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Metric label="Preview rows" value={preview.length} helper={fileName || "No file selected"} tone="neutral" />
          <Metric label="Valid rows" value={validRows} helper="Ready to import" tone="success" />
          <Metric label="Invalid rows" value={invalidRows} helper="Fix before import" tone={invalidRows > 0 ? "danger" : "neutral"} />
          <Metric label="Import batches" value={importBatches.length} helper="Tracked history" tone="brand" />
          <Metric label="Export batches" value={exportBatches.length} helper="Generated packages" tone="neutral" />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Catalog CSV Import</h2>
                <p className="text-sm text-slate-500">Required columns: SKU, name, and numeric priceCents.</p>
              </div>
              <label className="inline-flex min-h-[40px] cursor-pointer items-center rounded-md border border-brand-300 bg-white px-4 text-sm font-medium text-brand-700 hover:bg-brand-50">
                Choose CSV
                <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void readFile(event.target.files?.[0])} />
              </label>
            </div>

            <div className="border-b border-slate-200 p-4">
              <textarea
                value={csv}
                onChange={(event) => {
                  setCsv(event.target.value);
                  setFileName("Pasted CSV");
                  setResult(null);
                }}
                rows={7}
                spellCheck={false}
                placeholder={TEMPLATE}
                className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 font-mono text-xs leading-5 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>

            {preview.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">Choose a CSV file or paste CSV content to preview rows.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Row</th>
                      <th className="px-4 py-3">SKU</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3 text-right">Price cents</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Validation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.slice(0, 50).map((row: CsvPreviewRow) => (
                      <tr key={row.row} className={row.valid ? "hover:bg-slate-50" : "bg-danger-50/50"}>
                        <td className="px-4 py-3 text-slate-500">{row.row}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.sku || "-"}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{row.name || "-"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.price || "-"}</td>
                        <td className="px-4 py-3 text-slate-600">{row.category || "general"}</td>
                        <td className="px-4 py-3">
                          <Badge variant={row.valid ? "green" : "red"}>{row.valid ? "ready" : row.issue ?? "invalid"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">{preview.length > 50 ? `Showing first 50 of ${preview.length} rows` : `${preview.length} rows previewed`}</p>
              <Button variant="primary" size="sm" loading={busy} disabled={!canManage || preview.length === 0 || invalidRows > 0} onClick={() => void importCatalog()}>
                Import catalog
              </Button>
            </div>
          </Card>

          <div className="space-y-5">
            <Card title="Export Center">
              <div className="space-y-3">
                <Button variant="primary" size="sm" fullWidth disabled={busy} onClick={() => void exportCatalog()}>
                  Export catalog CSV
                </Button>
                <Button variant="secondary" size="sm" fullWidth onClick={downloadTemplate}>
                  Download import template
                </Button>
              </div>
            </Card>

            <Card title="Import Rules">
              <ul className="space-y-2 text-sm text-slate-600">
                <li>SKU is the upsert key.</li>
                <li>Name and priceCents are required.</li>
                <li>priceCents must be an integer.</li>
                <li>Category and barcode are optional.</li>
                <li>Existing SKUs are updated.</li>
              </ul>
            </Card>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <BatchCard title="Import History" empty="No tracked import batches.">
            {importBatches.slice(0, 10).map((batch) => (
              <BatchItem
                key={batch.id}
                title={`${batch.import_type} · ${batch.file_name ?? batch.id}`}
                subtitle={`${batch.success_rows}/${batch.total_rows} successful · ${batch.failed_rows} failed`}
                status={batch.status}
                date={batch.completed_at ?? batch.created_at}
              />
            ))}
          </BatchCard>
          <BatchCard title="Export History" empty="No tracked export batches.">
            {exportBatches.slice(0, 10).map((batch) => (
              <BatchItem
                key={batch.id}
                title={`${batch.export_type} · ${batch.total_rows} rows`}
                subtitle={batch.file_url ?? "No file URL recorded"}
                status={batch.status}
                date={batch.completed_at ?? batch.created_at}
              />
            ))}
          </BatchCard>
        </section>
      </div>
    </EnterpriseShell>
  );
}

// ── Local helpers ─────────────────────────────────────────────────────────────

function Metric({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string | number;
  helper: string;
  tone: "neutral" | "success" | "brand" | "danger";
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-white",
    success: "border-success-200 bg-success-50",
    brand: "border-brand-200 bg-brand-50",
    danger: "border-danger-200 bg-danger-50",
  }[tone];
  return (
    <div className={`rounded-md border p-4 shadow-sm ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{value}</p>
      <p className="mt-1 truncate text-xs text-slate-500">{helper}</p>
    </div>
  );
}

function BatchCard({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <Card title={title} noPadding>
      {children.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">{empty}</p> : <div className="divide-y divide-slate-100">{children}</div>}
    </Card>
  );
}

function BatchItem({ title, subtitle, status, date }: { title: string; subtitle: string; status: string; date: number }) {
  const variant = status === "completed" || status === "success" ? "green" : status === "failed" ? "red" : "yellow";
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-950">{title}</p>
        <p className="mt-1 truncate text-xs text-slate-500">{subtitle} · {fmtDate(date)}</p>
      </div>
      <Badge variant={variant}>{status}</Badge>
    </div>
  );
}
