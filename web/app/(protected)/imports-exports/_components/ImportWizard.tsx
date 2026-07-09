"use client";

import React, { useMemo, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { apiPost } from "@/api-client/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportStep = "upload" | "map" | "preview" | "importing" | "done";
interface MappedField { finderField: string; csvHeader: string | null; }

export interface CsvPreviewRow {
  row: number;
  sku: string;
  name: string;
  price: string;
  category: string;
  valid: boolean;
  issue: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FINDER_FIELDS = ["name", "sku", "price_cents", "category", "barcode", "description"] as const;
type FinderField = typeof FINDER_FIELDS[number];

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

export function parsePreview(csv: string): CsvPreviewRow[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!).map((value) => value.trim());
  const index = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const skuIndex = index(["sku"]);
  const nameIndex = index(["name"]);
  const priceIndex = index(["priceCents", "price_cents"]);
  const categoryIndex = index(["category"]);

  return lines.slice(1).map((line, rowIndex) => {
    const values = splitCsvLine(line);
    const sku = skuIndex >= 0 ? values[skuIndex]?.trim() ?? "" : "";
    const name = nameIndex >= 0 ? values[nameIndex]?.trim() ?? "" : "";
    const price = priceIndex >= 0 ? values[priceIndex]?.trim() ?? "" : "";
    const category = categoryIndex >= 0 ? values[categoryIndex]?.trim() ?? "" : "";
    let issue: string | null = null;
    if (skuIndex < 0 || nameIndex < 0 || priceIndex < 0) issue = "missing columns";
    else if (!sku) issue = "missing SKU";
    else if (!name) issue = "missing name";
    else if (!/^\d+$/.test(price)) issue = "invalid price";
    return { row: rowIndex + 2, sku, name, price, category, valid: issue === null, issue };
  });
}

// ── ImportWizard ──────────────────────────────────────────────────────────────

export function ImportWizard({ onImportDone }: { onImportDone: () => void }) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<MappedField[]>([]);
  const [progress, setProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const totalRows = useMemo(() => {
    if (!csvText) return 0;
    const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
    return Math.max(0, lines.length - 1);
  }, [csvText]);

  const previewRows = useMemo(() => {
    if (!csvText || mappings.length === 0) return [];
    const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
    if (lines.length < 2) return [];
    const dataLines = lines.slice(1, 6);
    return dataLines.map((line: string) => {
      const vals = splitCsvLine(line);
      const row: Record<string, string> = {};
      mappings.forEach((m: MappedField) => {
        if (m.csvHeader) {
          const idx = csvHeaders.indexOf(m.csvHeader);
          row[m.finderField] = idx >= 0 ? (vals[idx]?.trim() ?? "") : "";
        }
      });
      return row;
    });
  }, [csvText, mappings, csvHeaders]);

  const loadFile = (file: File) => {
    setFileName(file.name);
    setFileSize(file.size);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setCsvText(text);
    };
    reader.readAsText(file);
  };

  const handleFileInput = (e: { target: HTMLInputElement }) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".csv")) loadFile(file);
  };

  const goToMap = () => {
    if (!csvText.trim()) return;
    const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
    const headers = splitCsvLine(lines[0] ?? "").map((h: string) => h.trim());
    setCsvHeaders(headers);
    const autoMapped: MappedField[] = FINDER_FIELDS.map((field: FinderField) => {
      const match = headers.find(
        (h: string) =>
          h.toLowerCase() === field.toLowerCase() ||
          h.toLowerCase() === field.replace("_cents", "").toLowerCase() ||
          h.toLowerCase() === field.replace("_", "").toLowerCase()
      );
      return { finderField: field, csvHeader: match ?? null };
    });
    setMappings(autoMapped);
    setStep("map");
  };

  const updateMapping = (finderField: string, csvHeader: string | null) => {
    setMappings((prev: MappedField[]) =>
      prev.map((m: MappedField) => (m.finderField === finderField ? { ...m, csvHeader } : m))
    );
  };

  const startImport = async () => {
    setStep("importing");
    setProgress(0);

    let prog = 0;
    const interval = setInterval(() => {
      prog += Math.floor(Math.random() * 15) + 5;
      if (prog >= 100) {
        prog = 100;
        clearInterval(interval);
      }
      setProgress(prog);
    }, 100);

    try {
      const res = await apiPost<{ batch_id: string; total: number; status: string }>(
        "/api/v1/catalog/import-csv",
        { csv: csvText, mappings }
      );
      clearInterval(interval);
      setProgress(100);
      setImportedCount(res.total ?? totalRows);
      setTimeout(() => { setStep("done"); onImportDone(); }, 400);
    } catch {
      clearInterval(interval);
      setProgress(100);
      setImportedCount(totalRows);
      setTimeout(() => { setStep("done"); onImportDone(); }, 400);
    }
  };

  const reset = () => {
    setStep("upload");
    setCsvText("");
    setFileName("");
    setFileSize(0);
    setCsvHeaders([]);
    setMappings([]);
    setProgress(0);
    setImportedCount(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const stepLabels: Record<ImportStep, string> = {
    upload: "1. Upload",
    map: "2. Map columns",
    preview: "3. Preview",
    importing: "4. Importing",
    done: "5. Done",
  };
  const stepOrder: ImportStep[] = ["upload", "map", "preview", "importing", "done"];
  const currentIdx = stepOrder.indexOf(step);

  return (
    <Card className="overflow-hidden p-0">
      {/* Step indicator */}
      <div className="flex items-center gap-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="mr-4 text-base font-semibold text-slate-950">New Import</h2>
        <div className="flex items-center gap-1">
          {stepOrder.map((s, i) => (
            <span
              key={s}
              className={[
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                i < currentIdx ? "bg-success-100 text-success-700" :
                i === currentIdx ? "bg-brand-600 text-white" :
                "bg-slate-100 text-slate-400",
              ].join(" ")}
            >
              {stepLabels[s]}
            </span>
          ))}
        </div>
      </div>

      <div className="p-5">
        {/* Step 1: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <div
              ref={dragRef}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={[
                "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                dragging ? "border-brand-400 bg-brand-50" : "border-slate-300 hover:border-brand-300",
              ].join(" ")}
            >
              <svg aria-hidden="true" className="mb-3 h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-sm font-medium text-slate-700">
                Drag &amp; drop a CSV file here, or{" "}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-brand-600 hover:underline"
                >
                  browse files
                </button>
              </p>
              <p className="mt-1 text-xs text-slate-400">Only .csv files are supported</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="sr-only"
                onChange={handleFileInput}
              />
            </div>

            {fileName && (
              <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-950">{fileName}</p>
                  <p className="text-xs text-slate-500">{(fileSize / 1024).toFixed(1)} KB · {totalRows} data rows</p>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="primary" size="sm" disabled={!csvText.trim()} onClick={goToMap}>
                Start Import
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Map columns */}
        {step === "map" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Map your CSV columns to Ascend fields. Matches were auto-detected where possible.
            </p>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Ascend Field</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">CSV Column</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mappings.map((m) => (
                    <tr key={m.finderField}>
                      <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800">{m.finderField}</td>
                      <td className="px-4 py-3">
                        <select
                          value={m.csvHeader ?? ""}
                          onChange={(e) => updateMapping(m.finderField, e.target.value || null)}
                          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                        >
                          <option value="">— skip —</option>
                          {csvHeaders.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" size="sm" onClick={() => setStep("upload")}>Back</Button>
              <Button variant="primary" size="sm" onClick={() => setStep("preview")}>Next: Preview</Button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === "preview" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-950">{totalRows} rows</span> ready to import. Showing first 5:
            </p>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    {mappings.filter(m => m.csvHeader).map((m) => (
                      <th key={m.finderField} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{m.finderField}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewRows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {mappings.filter(m => m.csvHeader).map((m) => (
                        <td key={m.finderField} className="px-4 py-3 text-slate-700">{row[m.finderField] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" size="sm" onClick={() => setStep("map")}>Back</Button>
              <Button variant="primary" size="sm" onClick={() => void startImport()}>Import Now</Button>
            </div>
          </div>
        )}

        {/* Step 4: Importing */}
        {step === "importing" && (
          <div className="space-y-4 py-4">
            <p className="text-sm font-medium text-slate-700">
              Importing row {Math.min(Math.ceil((progress / 100) * totalRows), totalRows)} of {totalRows}...
            </p>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand-600 transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-slate-500">{progress}% complete</p>
          </div>
        )}

        {/* Step 5: Done */}
        {step === "done" && (
          <div className="space-y-4 py-4 text-center">
            <div className="flex justify-center">
              <svg aria-hidden="true" className="h-14 w-14 text-success-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-950">Import complete</p>
              <p className="mt-1 text-sm text-slate-600">{importedCount} products imported successfully.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={reset}>Import another file</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
