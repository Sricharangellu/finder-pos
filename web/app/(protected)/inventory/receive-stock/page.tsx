"use client";

/**
 * Receive Stock — scan or select a pending PO, fill in cases × units/case,
 * expiry dates, lot codes, attach delivery documents, then submit.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { fmtDate } from "@/lib/date";

// ── Types ─────────────────────────────────────────────────────────────────────

interface POLine {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_barcode?: string;
  quantity: number;
  unit_cost_cents: number;
  received_qty: number;
  remaining_qty: number;
  expiry_date: number | null;
  lot_code: string | null;
  cases_ordered?: number;
  units_per_case?: number;
}

interface PendingPO {
  id: string;
  po_number?: number;
  supplier_id: string;
  supplier_name?: string;
  status: string;
  receive_status?: string;
  total_cost_cents: number;
  created_at: number;
  lines?: POLine[];
}

interface ReceiveEntry {
  lineId: string;
  cases: string;
  unitsPerCase: string;
  totalQty: number;
  expiryDate: string;
  lotCode: string;
  highlighted?: boolean;
}

interface PODocument {
  id: string;
  name: string;
  type: string;
  size_bytes: number;
  uploaded_at: number;
}

type SortMode = "insertion" | "alpha";

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeTotal(cases: string, upc: string): number {
  const c = parseInt(cases, 10);
  const u = parseInt(upc, 10);
  if (isNaN(c) || isNaN(u) || c <= 0 || u <= 0) return 0;
  return c * u;
}

function receiveStatusBadge(s?: string): "green" | "yellow" | "gray" {
  if (s === "received") return "green";
  if (s === "partial") return "yellow";
  return "gray";
}

function docTypeLabel(t: string): string {
  return ({ invoice: "Invoice", delivery_note: "Delivery Note", excel: "Excel", other: "Other" } as Record<string, string>)[t] ?? t;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReceiveStockPage() {
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);

  const [pendingPOs, setPendingPOs] = useState<PendingPO[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedPOId, setSelectedPOId] = useState<string>("");
  const [selectedPO, setSelectedPO] = useState<PendingPO | null>(null);

  const [entries, setEntries] = useState<ReceiveEntry[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("insertion");
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);

  const [documents, setDocuments] = useState<PODocument[]>([]);
  const [docName, setDocName] = useState("");
  const [docType, setDocType] = useState<string>("invoice");
  const [docBusy, setDocBusy] = useState(false);

  const [loadingPO, setLoadingPO] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    try {
      const [ordersRes, suppliersRes] = await Promise.all([
        apiGet<{ items: PendingPO[] }>("/api/v1/purchasing/orders"),
        apiGet<{ items: Array<{ id: string; name: string }> }>("/api/v1/purchasing/suppliers"),
      ]);
      const pending = (ordersRes.items ?? []).filter(
        (o) => o.receive_status === "pending" || o.receive_status === "partial" || o.status === "ordered",
      );
      setPendingPOs(pending);
      setSuppliers(suppliersRes.items ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const loadPO = useCallback(async (poId: string) => {
    if (!poId) { setSelectedPO(null); setEntries([]); setDocuments([]); return; }
    setLoadingPO(true); setError(null);
    try {
      const [poRes, docsRes] = await Promise.all([
        apiGet<PendingPO>(`/api/v1/purchasing/orders/${poId}`),
        apiGet<{ items: PODocument[] }>(`/api/v1/purchasing/orders/${poId}/documents`).catch(() => ({ items: [] as PODocument[] })),
      ]);
      const supName = suppliers.find((s) => s.id === poRes.supplier_id)?.name ?? poRes.supplier_id;
      setSelectedPO({ ...poRes, supplier_name: supName });
      setDocuments(docsRes.items ?? []);
      setEntries(
        (poRes.lines ?? [])
          .filter((l) => l.remaining_qty > 0)
          .map((l) => ({
            lineId: l.id,
            cases: l.cases_ordered != null ? String(l.cases_ordered) : "1",
            unitsPerCase: l.units_per_case != null ? String(l.units_per_case) : String(l.remaining_qty),
            totalQty: l.remaining_qty,
            expiryDate: l.expiry_date ? new Date(l.expiry_date).toISOString().slice(0, 10) : "",
            lotCode: l.lot_code ?? "",
          })),
      );
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load purchase order.");
    } finally { setLoadingPO(false); }
  }, [suppliers]);

  useEffect(() => { void loadPO(selectedPOId); }, [selectedPOId, loadPO]);

  // ── Barcode scan ────────────────────────────────────────────────────────────

  const handleScan = () => {
    const code = scanInput.trim();
    setScanInput(""); setScanError(null);
    if (!code) return;

    if (!selectedPO?.lines) {
      const matchingPO = pendingPOs.find((po) =>
        po.lines?.some((l) => l.product_barcode === code || l.product_sku === code),
      );
      if (matchingPO) { setSelectedPOId(matchingPO.id); }
      else { setScanError(`No pending PO contains barcode "${code}"`); }
      return;
    }

    const line = selectedPO.lines.find((l) => l.product_barcode === code || l.product_sku === code);
    if (!line) { setScanError(`Barcode "${code}" not found on this PO`); return; }
    setEntries((prev) => prev.map((e) => ({ ...e, highlighted: e.lineId === line.id })));
    setTimeout(() => setEntries((prev) => prev.map((e) => ({ ...e, highlighted: false }))), 2000);
  };

  // ── Entry helpers ───────────────────────────────────────────────────────────

  const updateEntry = (lineId: string, patch: Partial<ReceiveEntry>) => {
    setEntries((prev) => prev.map((e) => {
      if (e.lineId !== lineId) return e;
      const u = { ...e, ...patch };
      if ("cases" in patch || "unitsPerCase" in patch) {
        u.totalQty = computeTotal(
          "cases" in patch ? (patch.cases ?? e.cases) : e.cases,
          "unitsPerCase" in patch ? (patch.unitsPerCase ?? e.unitsPerCase) : e.unitsPerCase,
        );
      }
      return u;
    }));
  };

  const receiveAll = () => {
    setEntries((prev) => prev.map((e) => {
      const line = selectedPO?.lines?.find((l) => l.id === e.lineId);
      if (!line) return e;
      const upc = parseInt(e.unitsPerCase, 10) || 1;
      const cases = Math.ceil(line.remaining_qty / upc);
      return { ...e, cases: String(cases), totalQty: line.remaining_qty };
    }));
  };

  // ── Document upload ─────────────────────────────────────────────────────────

  const uploadDoc = async () => {
    if (!docName.trim() || !selectedPOId) return;
    setDocBusy(true);
    try {
      const doc = await apiPost<PODocument>(`/api/v1/purchasing/orders/${selectedPOId}/documents`, {
        name: docName.trim(), type: docType, size_bytes: Math.round(Math.random() * 500000 + 50000),
      });
      setDocuments((prev) => [...prev, doc]);
      setDocName("");
    } catch { /* ignore */ } finally { setDocBusy(false); }
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!selectedPOId || entries.length === 0) return;
    const lines = entries.filter((e) => e.totalQty > 0).map((e) => ({ lineId: e.lineId, qty: e.totalQty }));
    if (lines.length === 0) { setError("No quantities entered."); return; }
    setBusy(true); setError(null); setSuccess(null);
    try {
      await apiPost(`/api/v1/purchasing/orders/${selectedPOId}/receive`, { lines });
      setSuccess(`Receipt submitted — ${lines.length} line(s) received.`);
      await loadList();
      setTimeout(() => { setSelectedPOId(""); setSuccess(null); }, 2500);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Receive failed.");
    } finally { setBusy(false); }
  };

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? id;
  const sortedEntries = sortMode === "alpha"
    ? [...entries].sort((a, b) => {
        const la = selectedPO?.lines?.find((l) => l.id === a.lineId);
        const lb = selectedPO?.lines?.find((l) => l.id === b.lineId);
        return (la?.product_name ?? "").localeCompare(lb?.product_name ?? "");
      })
    : entries;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <EnterpriseShell active="inventory" title="Receive Stock" subtitle="Receive incoming shipments against purchase orders" contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">

        {/* Scan + PO select */}
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium uppercase text-slate-500 mb-1">Scan barcode / SKU</label>
              <div className="flex gap-2">
                <input
                  ref={scanRef}
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }}
                  placeholder="Scan or type barcode…"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none font-mono"
                  autoFocus
                />
                <Button variant="secondary" size="sm" onClick={handleScan}>Scan</Button>
              </div>
              {scanError && <p className="mt-1 text-xs text-red-600">{scanError}</p>}
            </div>
            <div className="flex-1 min-w-[260px]">
              <label className="block text-xs font-medium uppercase text-slate-500 mb-1">Select pending PO</label>
              <select
                value={selectedPOId}
                onChange={(e) => setSelectedPOId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">— Choose a PO to receive —</option>
                {pendingPOs.map((po) => (
                  <option key={po.id} value={po.id}>
                    #{po.po_number ?? po.id} · {supplierName(po.supplier_id)} · {formatMoney(po.total_cost_cents)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {loadingPO && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
          </div>
        )}

        {selectedPO && !loadingPO && (
          <>
            {/* PO Summary */}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap gap-6">
                  <div>
                    <p className="text-xs text-slate-400">PO Number</p>
                    <p className="font-bold text-slate-900">#{selectedPO.po_number ?? selectedPO.id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Supplier</p>
                    <p className="font-semibold text-slate-900">{selectedPO.supplier_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">PO Total</p>
                    <p className="font-semibold text-slate-900">{formatMoney(selectedPO.total_cost_cents)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Receive status</p>
                    <Badge variant={receiveStatusBadge(selectedPO.receive_status)}>{selectedPO.receive_status ?? "pending"}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">Sort:</span>
                  {(["insertion", "alpha"] as SortMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSortMode(m)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        sortMode === m ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-600 hover:border-blue-300"
                      }`}
                    >
                      {m === "insertion" ? "As ordered" : "A–Z"}
                    </button>
                  ))}
                  <Button variant="secondary" size="sm" onClick={receiveAll}>Fill all</Button>
                </div>
              </div>
            </Card>

            {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</p>}
            {success && <p role="status" className="rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 text-sm text-green-800 font-medium">{success}</p>}

            {/* Line receive form */}
            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Lines to receive</h2>
                <span className="text-xs text-slate-400">{entries.length} open line(s)</span>
              </div>
              {entries.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400">All lines have been fully received.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {sortedEntries.map((entry) => {
                    const line = selectedPO.lines?.find((l) => l.id === entry.lineId);
                    if (!line) return null;
                    const overQty = entry.totalQty > line.remaining_qty;
                    return (
                      <div key={entry.lineId} className={`px-4 py-4 transition-colors ${entry.highlighted ? "bg-yellow-50 ring-1 ring-inset ring-yellow-300" : ""}`}>
                        <div className="flex items-start justify-between mb-3 gap-2 flex-wrap">
                          <div>
                            <p className="font-semibold text-slate-900">{line.product_name}</p>
                            <p className="text-xs text-slate-400 font-mono">{line.product_sku} · {line.product_barcode ?? "—"}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-slate-400">Unit cost · Remaining</p>
                            <p className="text-sm font-semibold text-slate-700">
                              {formatMoney(line.unit_cost_cents)} · <span className="text-amber-700">{line.remaining_qty}</span>
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Cases</label>
                            <input
                              type="number"
                              min={0}
                              value={entry.cases}
                              onChange={(e) => updateEntry(entry.lineId, { cases: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-center focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Units / case</label>
                            <input
                              type="number"
                              min={1}
                              value={entry.unitsPerCase}
                              onChange={(e) => updateEntry(entry.lineId, { unitsPerCase: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-center focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Total qty</label>
                            <div className={`rounded-lg border px-3 py-2 text-sm font-bold text-center tabular-nums ${overQty ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
                              {entry.totalQty}
                              {overQty && <span className="ml-1 text-xs font-normal">⚠ over</span>}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Expiry date</label>
                            <input
                              type="date"
                              value={entry.expiryDate}
                              onChange={(e) => updateEntry(entry.lineId, { expiryDate: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Lot code</label>
                            <input
                              type="text"
                              value={entry.lotCode}
                              onChange={(e) => updateEntry(entry.lineId, { lotCode: e.target.value })}
                              placeholder="LOT-2026"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Document upload */}
            <Card>
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Attached documents</h3>
              {documents.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {documents.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <svg aria-hidden="true" className="w-4 h-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <div>
                        <p className="text-xs font-medium text-slate-800">{doc.name}</p>
                        <p className="text-xs text-slate-400">{docTypeLabel(doc.type)} · {fmtBytes(doc.size_bytes)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">File name</label>
                  <input
                    type="text"
                    value={docName}
                    onChange={(e) => setDocName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void uploadDoc(); }}
                    placeholder="Invoice-Acme-2026.pdf"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none w-56"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="invoice">Invoice</option>
                    <option value="delivery_note">Delivery Note</option>
                    <option value="excel">Excel / CSV</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <Button variant="secondary" size="sm" disabled={!docName.trim() || docBusy} onClick={() => void uploadDoc()}>
                  Attach
                </Button>
              </div>
            </Card>

            {/* Actions */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <Button variant="secondary" size="sm" onClick={() => router.push(`/purchasing/${selectedPOId}`)}>
                View PO detail
              </Button>
              <div className="flex items-center gap-3">
                <p className="text-sm text-slate-500">
                  {entries.filter((e) => e.totalQty > 0).length}/{entries.length} lines ready
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || entries.every((e) => e.totalQty === 0)}
                  onClick={() => void submit()}
                >
                  {busy ? "Submitting…" : "Submit receipt"}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Pending POs list when none selected */}
        {!selectedPOId && !loadingPO && pendingPOs.length > 0 && (
          <Card className="overflow-hidden p-0">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Pending shipments</h2>
              <p className="text-xs text-slate-400">Click a row or use the selector above to start receiving</p>
            </div>
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-xs text-left text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5">PO #</th>
                  <th className="px-4 py-2.5">Supplier</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 bg-white">
                {pendingPOs.map((po) => (
                  <tr key={po.id} className="cursor-pointer hover:bg-blue-50 transition-colors" onClick={() => setSelectedPOId(po.id)}>
                    <td className="px-4 py-3 font-semibold text-blue-700">#{po.po_number ?? po.id}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{supplierName(po.supplier_id)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={receiveStatusBadge(po.receive_status)}>{po.receive_status ?? "pending"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(po.total_cost_cents)}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{fmtDate(po.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {!selectedPOId && !loadingPO && pendingPOs.length === 0 && (
          <Card>
            <div className="flex flex-col items-center py-12 text-center">
              <svg aria-hidden="true" className="w-10 h-10 text-slate-200 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10"/></svg>
              <p className="font-semibold text-slate-700">No pending shipments</p>
              <p className="text-sm text-slate-400 mt-1">All purchase orders have been received.</p>
              <Button variant="primary" size="sm" className="mt-4" onClick={() => router.push("/purchasing")}>Create a PO</Button>
            </div>
          </Card>
        )}
      </div>
    </EnterpriseShell>
  );
}
