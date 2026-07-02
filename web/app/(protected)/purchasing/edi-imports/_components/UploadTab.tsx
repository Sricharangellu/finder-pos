"use client";
import { useRef, useState } from "react";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";

interface EdiFormat {
  key: string;
  label: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface Props {
  onUploaded: () => void;
}

const MOCK_SUPPLIERS: Supplier[] = [
  { id: "sup_1", name: "Acme Coffee Co" },
  { id: "sup_2", name: "Tea Traders" },
  { id: "sup_3", name: "Snack World" },
  { id: "sup_4", name: "Home Goods Co" },
  { id: "sup_5", name: "Vape Supply Co" },
];

export function UploadTab({ onUploaded }: Props) {
  const [formats, setFormats] = useState<EdiFormat[]>([]);
  const [formatsLoaded, setFormatsLoaded] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadFormats() {
    if (formatsLoaded) return;
    try {
      const res = await apiGet<{ formats: EdiFormat[] }>("/api/v1/purchasing/edi-imports/formats");
      setFormats(res.formats);
      setFormatsLoaded(true);
    } catch {
      // use fallback
      setFormats([
        { key: "x12_850", label: "X12 850 (Purchase Order)" },
        { key: "x12_855", label: "X12 855 (PO Acknowledgment)" },
        { key: "x12_856", label: "X12 856 (Ship Notice/ASN)" },
        { key: "x12_810", label: "X12 810 (Invoice)" },
        { key: "edifact_orders", label: "EDIFACT ORDERS" },
        { key: "csv_po", label: "CSV Purchase Order" },
        { key: "json_po", label: "JSON Purchase Order" },
        { key: "xml_po", label: "XML Purchase Order" },
      ]);
      setFormatsLoaded(true);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!file) { setError("Please select a file."); return; }
    if (!selectedFormat) { setError("Please select an EDI format."); return; }
    if (!selectedSupplier) { setError("Please select a supplier."); return; }
    const supplier = MOCK_SUPPLIERS.find((s) => s.id === selectedSupplier);
    setUploading(true);
    try {
      await apiPost("/api/v1/purchasing/edi-imports", {
        filename: file.name,
        format: selectedFormat,
        supplier_id: selectedSupplier,
        supplier_name: supplier?.name ?? selectedSupplier,
        file_size_bytes: file.size,
      });
      setSuccess(`"${file.name}" queued for processing.`);
      setFile(null);
      setSelectedFormat("");
      setSelectedSupplier("");
      if (fileRef.current) fileRef.current.value = "";
      onUploaded();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h3 className="mb-4 text-sm font-semibold text-slate-700">Upload EDI File</h3>

      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{success}</div>
      )}
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>
      )}

      <form id="edi-upload-form" onSubmit={handleSubmit} className="space-y-4">
        {/* File picker */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600" htmlFor="edi-file">
            EDI file <span className="text-red-500">*</span>
          </label>
          <input
            id="edi-file"
            ref={fileRef}
            type="file"
            accept=".edi,.x12,.csv,.json,.xml,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-100"
          />
          {file && (
            <p className="mt-1 text-xs text-slate-400">{file.name} — {(file.size / 1024).toFixed(1)} KB</p>
          )}
        </div>

        {/* Format selector */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600" htmlFor="edi-format">
            EDI format <span className="text-red-500">*</span>
          </label>
          <select
            id="edi-format"
            value={selectedFormat}
            onFocus={loadFormats}
            onChange={(e) => setSelectedFormat(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select format…</option>
            {formats.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>

        {/* Supplier selector */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600" htmlFor="edi-supplier">
            Supplier <span className="text-red-500">*</span>
          </label>
          <select
            id="edi-supplier"
            value={selectedSupplier}
            onChange={(e) => setSelectedSupplier(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select supplier…</option>
            {MOCK_SUPPLIERS.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          form="edi-upload-form"
          disabled={uploading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload & Queue"}
        </button>
      </form>

      {/* Supported formats info */}
      <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="mb-2 text-xs font-semibold text-slate-600">Supported formats</p>
        <div className="grid grid-cols-2 gap-1 text-xs text-slate-500">
          <span>X12 850 — Purchase Orders</span>
          <span>X12 855 — PO Acknowledgments</span>
          <span>X12 856 — Ship Notices (ASN)</span>
          <span>X12 810 — Invoices</span>
          <span>EDIFACT ORDERS</span>
          <span>CSV / JSON / XML</span>
        </div>
        <p className="mt-3 text-xs text-slate-400">Max file size: 25 MB. Files are queued and validated automatically.</p>
      </div>
    </div>
  );
}
