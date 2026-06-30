"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Badge, statusBadge } from "@/components/Badge";
import { formatMoney, parseToCents } from "@/lib/money";
import { apiGet, apiPost, apiPatch, ApiResponseError } from "@/api-client/client";
import { hasRole } from "@/lib/auth";
import type { Supplier, SuppliersResponse } from "@/api-client/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface POLine {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_barcode?: string;
  selling_price_cents: number;
  last_cost_cents: number;
  margin_pct: number;
  quantity: number;
  unit_cost_cents: number;
  line_cost_cents: number;
  received_qty: number;
  remaining_qty: number;
  expiry_date: number | null;
  lot_code: string | null;
  cases_ordered?: number;
  units_per_case?: number;
  landed_cost_cents?: number;
}

interface PurchaseOrderDetail {
  id: string;
  po_number?: number;
  supplier_id: string;
  status: string;
  receive_status: string | null;
  total_cost_cents: number;
  freight_cost_cents: number;
  other_charges_cents: number;
  created_at: number;
  received_at: number | null;
  notes?: string;
  lines: POLine[];
}

interface PriceHistoryItem {
  product_id: string;
  product_name: string;
  sku: string;
  history: Array<{ unit_cost_cents: number; received_at: number; po_id: string }>;
}

interface PODocument {
  id: string;
  name: string;
  type: string;
  size_bytes: number;
  uploaded_at: number;
}

interface BillingAdj {
  id: string;
  po_id: string;
  line_id: string | null;
  reason: string;
  amount_cents: number;
  created_at: number;
}

interface VendorCredit {
  id: string;
  supplier_id: string;
  type: string;
  amount_cents: number;
  reason: string | null;
  po_id: string | null;
  status: string;
  created_at: number;
}

interface ReceiveEntry { lineId: string; cases: string; unitsPerCase: string; totalQty: number; expiryDate: string; lotCode: string; }

type DetailTab = "lines" | "receive" | "billing" | "credits";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function remaining(line: POLine): number {
  return Math.max(0, line.quantity - (line.received_qty ?? 0));
}

function computeTotal(cases: string, upc: string): number {
  const c = parseInt(cases, 10), u = parseInt(upc, 10);
  if (isNaN(c) || isNaN(u) || c <= 0 || u <= 0) return 0;
  return c * u;
}

function marginColor(pct: number): string {
  if (pct < 10) return "text-red-600";
  if (pct < 25) return "text-amber-600";
  return "text-emerald-700";
}

function docTypeLabel(t: string): string {
  return ({ invoice: "Invoice", delivery_note: "Delivery Note", excel: "Excel/CSV", other: "Other" } as Record<string, string>)[t] ?? t;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);

  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryItem[]>([]);
  const [documents, setDocuments] = useState<PODocument[]>([]);
  const [billingAdjs, setBillingAdjs] = useState<BillingAdj[]>([]);
  const [credits, setCredits] = useState<VendorCredit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>("lines");

  const [receiveEntries, setReceiveEntries] = useState<ReceiveEntry[]>([]);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveBusy, setReceiveBusy] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);

  // Document state
  const [docName, setDocName] = useState("");
  const [docType, setDocType] = useState("invoice");
  const [docBusy, setDocBusy] = useState(false);

  // Billing adj state
  const [adjReason, setAdjReason] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjLineId, setAdjLineId] = useState<string>("");
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjError, setAdjError] = useState<string | null>(null);

  // Landed costs state
  const [landedOpen, setLandedOpen] = useState(false);
  const [freight, setFreight] = useState("");
  const [otherCharges, setOtherCharges] = useState("");
  const [landedBusy, setLandedBusy] = useState(false);

  // Credit/chargeback state
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditType, setCreditType] = useState<"chargeback" | "credit_memo">("credit_memo");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditSource, setCreditSource] = useState<"manual" | "expired" | "damaged">("manual");
  const [expiredLots, setExpiredLots] = useState<{ id: string; name: string; lot_code: string | null; qty_on_hand: number }[]>([]);
  const [expiredLotsLoading, setExpiredLotsLoading] = useState(false);
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditError, setCreditError] = useState<string | null>(null);

  const canManage = hasRole("manager");

  // ── Load ─────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setError(null);
    try {
      const [orderRes, suppliersRes] = await Promise.all([
        apiGet<PurchaseOrderDetail>(`/api/v1/purchasing/orders/${id}`),
        apiGet<SuppliersResponse>("/api/v1/purchasing/suppliers"),
      ]);
      setOrder(orderRes);
      setSuppliers(suppliersRes.items ?? []);
      setReceiveEntries(
        orderRes.lines
          .filter((l) => remaining(l) > 0)
          .map((l) => ({
            lineId: l.id,
            cases: l.cases_ordered != null ? String(l.cases_ordered) : "1",
            unitsPerCase: l.units_per_case != null ? String(l.units_per_case) : String(remaining(l)),
            totalQty: remaining(l),
            expiryDate: l.expiry_date ? new Date(l.expiry_date).toISOString().slice(0, 10) : "",
            lotCode: l.lot_code ?? "",
          })),
      );
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Could not load purchase order.");
    } finally { setLoading(false); }
  }, [id]);

  const loadTabData = useCallback(async (tab: DetailTab) => {
    if (tab === "lines" && priceHistory.length === 0) {
      try {
        const h = await apiGet<{ items: PriceHistoryItem[] }>(`/api/v1/purchasing/orders/${id}/price-history`);
        setPriceHistory(h.items ?? []);
      } catch { /* ignore */ }
    }
    if (tab === "receive" && documents.length === 0) {
      try {
        const d = await apiGet<{ items: PODocument[] }>(`/api/v1/purchasing/orders/${id}/documents`);
        setDocuments(d.items ?? []);
      } catch { /* ignore */ }
    }
    if (tab === "billing") {
      try {
        const [adjRes, docRes] = await Promise.all([
          apiGet<{ items: BillingAdj[] }>(`/api/v1/purchasing/orders/${id}/billing-adj`),
          apiGet<{ items: PODocument[] }>(`/api/v1/purchasing/orders/${id}/documents`),
        ]);
        setBillingAdjs(adjRes.items ?? []);
        setDocuments(docRes.items ?? []);
      } catch { /* ignore */ }
    }
    if (tab === "credits") {
      try {
        const vc = await apiGet<{ items: VendorCredit[] }>(`/api/v1/purchasing/vendor-credits?poId=${id}`);
        setCredits(vc.items ?? []);
      } catch { /* ignore */ }
    }
  }, [id, priceHistory.length, documents.length]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadTabData(activeTab); }, [activeTab, loadTabData]);

  const supplierName = (sid: string) => suppliers.find((s) => s.id === sid)?.name ?? sid;

  // ── Receive ───────────────────────────────────────────────────────────────────

  const updateReceiveEntry = (lineId: string, patch: Partial<ReceiveEntry>) => {
    setReceiveEntries((prev) => prev.map((e) => {
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

  const submitReceive = async () => {
    if (!order) return;
    const lines = receiveEntries.filter((e) => e.totalQty > 0).map((e) => ({ lineId: e.lineId, qty: e.totalQty }));
    if (lines.length === 0) { setReceiveError("Enter quantities to receive."); return; }
    setReceiveBusy(true); setReceiveError(null);
    try {
      await apiPost(`/api/v1/purchasing/orders/${id}/receive`, { lines });
      setReceiveOpen(false);
      await load();
    } catch (e) {
      setReceiveError(e instanceof ApiResponseError ? e.message : "Could not receive stock.");
    } finally { setReceiveBusy(false); }
  };

  // ── Document upload ───────────────────────────────────────────────────────────

  const uploadDoc = async () => {
    if (!docName.trim()) return;
    setDocBusy(true);
    try {
      const doc = await apiPost<PODocument>(`/api/v1/purchasing/orders/${id}/documents`, {
        name: docName.trim(), type: docType, size_bytes: Math.round(Math.random() * 500000 + 50000),
      });
      setDocuments((prev) => [...prev, doc]);
      setDocName("");
    } catch { /* ignore */ } finally { setDocBusy(false); }
  };

  // ── Billing adj ───────────────────────────────────────────────────────────────

  const createAdj = async () => {
    if (!adjReason.trim() || !adjAmount) { setAdjError("Reason and amount are required."); return; }
    const amountCents = parseToCents(adjAmount);
    if (isNaN(amountCents) || amountCents === 0) { setAdjError("Enter a valid dollar amount (use − for deductions)."); return; }
    setAdjBusy(true); setAdjError(null);
    try {
      const adj = await apiPost<BillingAdj>(`/api/v1/purchasing/orders/${id}/billing-adj`, {
        lineId: adjLineId || undefined, reason: adjReason.trim(), amountCents,
      });
      setBillingAdjs((prev) => [...prev, adj]);
      setAdjReason(""); setAdjAmount(""); setAdjLineId("");
    } catch { /* ignore */ } finally { setAdjBusy(false); }
  };

  // ── Landed costs ──────────────────────────────────────────────────────────────

  const saveLandedCosts = async () => {
    setLandedBusy(true);
    try {
      await apiPost(`/api/v1/purchasing/orders/${id}/landed-costs`, {
        freightCents: parseToCents(freight || "0"),
        otherChargesCents: parseToCents(otherCharges || "0"),
      });
      setLandedOpen(false);
      await load();
    } catch { /* ignore */ } finally { setLandedBusy(false); }
  };

  // ── Credit / chargeback ───────────────────────────────────────────────────────

  const openCreditModal = async (type: "chargeback" | "credit_memo") => {
    setCreditType(type);
    setCreditSource("manual");
    setCreditAmount("");
    setCreditReason("");
    setCreditError(null);
    setCreditOpen(true);
    if (type === "credit_memo" && expiredLots.length === 0) {
      setExpiredLotsLoading(true);
      try {
        const res = await apiGet<{ items: { id: string; name: string; lot_code: string | null; qty_on_hand: number }[] }>("/api/v1/inventory/expired");
        setExpiredLots(res.items ?? []);
      } catch { /* ignore */ } finally { setExpiredLotsLoading(false); }
    }
  };

  const submitCredit = async () => {
    if (!creditAmount || !creditReason.trim()) { setCreditError("Amount and reason are required."); return; }
    const amountCents = parseToCents(creditAmount);
    if (isNaN(amountCents) || amountCents <= 0) { setCreditError("Enter a positive dollar amount."); return; }
    if (!order) return;
    setCreditBusy(true); setCreditError(null);
    try {
      const vc = await apiPost<VendorCredit>("/api/v1/purchasing/vendor-credits", {
        supplierId: order.supplier_id,
        type: creditType,
        amountCents,
        reason: creditReason.trim(),
        poId: id,
      });
      setCredits((prev) => [...prev, vc]);
      setCreditOpen(false);
    } catch (e) {
      setCreditError(e instanceof ApiResponseError ? e.message : "Failed to create credit.");
    } finally { setCreditBusy(false); }
  };

  const voidCredit = async (creditId: string) => {
    try {
      await apiPost(`/api/v1/purchasing/vendor-credits/${creditId}/void`, {});
      setCredits((prev) => prev.map((c) => c.id === creditId ? { ...c, status: "void" } : c));
    } catch { /* ignore */ }
  };

  // ── Render ─────────────────────────────────────────────────────────────────────

  const tabs: { key: DetailTab; label: string }[] = [
    { key: "lines",    label: "Order lines" },
    { key: "receive",  label: "Receive" },
    { key: "billing",  label: "Billing" },
    { key: "credits",  label: "Credits" },
  ];

  const goodsTotal = order?.lines.reduce((s, l) => s + l.line_cost_cents, 0) ?? 0;
  const extraCharges = (order?.freight_cost_cents ?? 0) + (order?.other_charges_cents ?? 0);
  const adjTotal = billingAdjs.reduce((s, a) => s + a.amount_cents, 0);

  return (
    <EnterpriseShell
      active="purchasing"
      title={order ? `PO #${order.po_number ?? order.id}` : "Purchase Order"}
      subtitle={order ? `${supplierName(order.supplier_id)} · ${fmtDate(order.created_at)}` : "Loading…"}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6">
        <button
          type="button"
          onClick={() => router.push("/purchasing")}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-950 self-start"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back to Purchasing
        </button>

        {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">{error}</div>}
        {loading && !order && <div className="py-16 text-center text-sm text-slate-400">Loading…</div>}

        {order && (
          <>
            {/* Header card */}
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusBadge(order.status)}>{order.status}</Badge>
                    {order.receive_status && order.receive_status !== order.status && (
                      <Badge variant={statusBadge(order.receive_status)}>recv: {order.receive_status}</Badge>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4 text-sm">
                    <div>
                      <dt className="text-xs font-medium uppercase text-slate-500">Supplier</dt>
                      <dd className="mt-0.5 font-semibold text-slate-950">{supplierName(order.supplier_id)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase text-slate-500">Goods total</dt>
                      <dd className="mt-0.5 font-semibold text-slate-950">{formatMoney(goodsTotal)}</dd>
                    </div>
                    {extraCharges > 0 && (
                      <div>
                        <dt className="text-xs font-medium uppercase text-slate-500">Landed costs</dt>
                        <dd className="mt-0.5 font-semibold text-slate-950">+{formatMoney(extraCharges)}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-xs font-medium uppercase text-slate-500">Grand total</dt>
                      <dd className="mt-0.5 font-bold text-slate-950">{formatMoney(goodsTotal + extraCharges + adjTotal)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase text-slate-500">Created</dt>
                      <dd className="mt-0.5 text-slate-700">{fmtDate(order.created_at)}</dd>
                    </div>
                    {order.received_at && (
                      <div>
                        <dt className="text-xs font-medium uppercase text-slate-500">Received</dt>
                        <dd className="mt-0.5 text-slate-700">{fmtDate(order.received_at)}</dd>
                      </div>
                    )}
                  </dl>
                  {order.notes && (
                    <p className="text-xs text-slate-500 italic max-w-prose">{order.notes}</p>
                  )}
                </div>
                {canManage && order.status !== "received" && (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setLandedOpen(true)}>Landed costs</Button>
                    <Button variant="primary" size="sm" onClick={() => { setActiveTab("receive"); setReceiveOpen(true); }}>Receive stock</Button>
                  </div>
                )}
              </div>
            </Card>

            {/* Tabs */}
            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-200">
                <nav className="-mb-px flex gap-0 px-4" aria-label="PO detail tabs">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setActiveTab(t.key)}
                      className={clsx(
                        "min-h-[44px] border-b-2 px-4 text-sm font-medium transition-colors",
                        activeTab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
                      )}
                      aria-current={activeTab === t.key ? "page" : undefined}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>
              </div>

              {/* ── Lines tab ── */}
              {activeTab === "lines" && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Product</th>
                        <th className="px-4 py-3 text-right">Ordered</th>
                        <th className="px-4 py-3 text-right">Received</th>
                        <th className="px-4 py-3 text-right">Remaining</th>
                        <th className="px-4 py-3 text-right">Unit cost</th>
                        <th className="px-4 py-3 text-right">Last cost</th>
                        <th className="px-4 py-3 text-right">Sell price</th>
                        <th className="px-4 py-3 text-right">Margin</th>
                        <th className="px-4 py-3 text-right">Line total</th>
                        <th className="px-4 py-3">Lot / Expiry</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {order.lines.length === 0 ? (
                        <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-400">No lines on this order.</td></tr>
                      ) : order.lines.map((line) => {
                        const rem = remaining(line);
                        const hist = priceHistory.find((h) => h.product_id === line.product_id);
                        const prevCost = hist?.history?.[1]?.unit_cost_cents;
                        const costDelta = prevCost != null ? line.unit_cost_cents - prevCost : null;
                        return (
                          <tr key={line.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900">{line.product_name}</p>
                              <p className="text-xs text-slate-400 font-mono">{line.product_sku}</p>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{line.quantity}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700">{line.received_qty ?? 0}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                              <span className={rem > 0 ? "font-semibold text-amber-700" : "text-emerald-600"}>{rem}</span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                              {formatMoney(line.unit_cost_cents)}
                              {costDelta != null && (
                                <span className={`ml-1 text-xs ${costDelta > 0 ? "text-red-500" : "text-emerald-600"}`}>
                                  {costDelta > 0 ? "▲" : "▼"}{formatMoney(Math.abs(costDelta))}
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-400">
                              {line.last_cost_cents ? formatMoney(line.last_cost_cents) : "—"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                              {formatMoney(line.selling_price_cents)}
                            </td>
                            <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold ${marginColor(line.margin_pct)}`}>
                              {line.margin_pct}%
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold text-slate-950">
                              {formatMoney(line.line_cost_cents)}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500">
                              <p>{line.lot_code ?? "—"}</p>
                              <p>{fmtDate(line.expiry_date)}</p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50">
                        <td colSpan={8} className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Total</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-950">{formatMoney(goodsTotal)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>

                  {/* Price history panel */}
                  {priceHistory.length > 0 && (
                    <div className="border-t border-slate-100 px-4 py-4 bg-slate-50">
                      <p className="text-xs font-semibold uppercase text-slate-500 mb-3">Vendor price history</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {priceHistory.map((ph) => (
                          <div key={ph.product_id} className="rounded-lg border border-slate-200 bg-white p-3">
                            <p className="text-xs font-semibold text-slate-800">{ph.product_name}</p>
                            <p className="text-xs text-slate-400 font-mono mb-2">{ph.sku}</p>
                            <div className="space-y-1">
                              {ph.history.map((h, i) => (
                                <div key={i} className="flex justify-between text-xs">
                                  <span className={i === 0 ? "text-slate-900 font-semibold" : "text-slate-400"}>{new Date(h.received_at).toLocaleDateString()}</span>
                                  <span className={i === 0 ? "text-slate-900 font-bold tabular-nums" : "text-slate-400 tabular-nums"}>{formatMoney(h.unit_cost_cents)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Receive tab ── */}
              {activeTab === "receive" && (
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Receive incoming goods</p>
                      <p className="text-xs text-slate-500">Enter cases × units per case for each line</p>
                    </div>
                    {canManage && order.status !== "received" && (
                      <Button variant="primary" size="sm" onClick={() => setReceiveOpen(true)}>Open receive form</Button>
                    )}
                  </div>

                  {/* Documents */}
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-500 mb-2">Attached documents</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {documents.map((doc) => (
                        <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <svg aria-hidden="true" className="w-4 h-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          <div>
                            <p className="text-xs font-medium text-slate-800">{doc.name}</p>
                            <p className="text-xs text-slate-400">{docTypeLabel(doc.type)} · {fmtBytes(doc.size_bytes)}</p>
                          </div>
                        </div>
                      ))}
                      {documents.length === 0 && <p className="text-xs text-slate-400">No documents attached.</p>}
                    </div>
                    <div className="flex flex-wrap gap-2 items-end">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">File name</label>
                        <input type="text" value={docName} onChange={(e) => setDocName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void uploadDoc(); }} placeholder="Invoice-2026.pdf"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none w-52" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
                        <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none">
                          <option value="invoice">Invoice</option>
                          <option value="delivery_note">Delivery Note</option>
                          <option value="excel">Excel / CSV</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <Button variant="secondary" size="sm" disabled={!docName.trim() || docBusy} onClick={() => void uploadDoc()}>Attach</Button>
                    </div>
                  </div>

                  {/* Receive status summary per line */}
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-100 text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide text-left">
                        <tr>
                          <th className="px-4 py-2.5">Product</th>
                          <th className="px-4 py-2.5 text-right">Ordered</th>
                          <th className="px-4 py-2.5 text-right">Received</th>
                          <th className="px-4 py-2.5 text-right">Remaining</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5">Lot / Expiry</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 bg-white">
                        {order.lines.map((l) => {
                          const rem = remaining(l);
                          const recvd = l.received_qty ?? 0;
                          const status = rem === 0 ? "received" : recvd > 0 ? "partial" : "pending";
                          return (
                            <tr key={l.id}>
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-900">{l.product_name}</p>
                                <p className="text-xs text-slate-400 font-mono">{l.product_sku}</p>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{recvd}</td>
                              <td className="px-4 py-3 text-right tabular-nums">
                                <span className={rem > 0 ? "font-semibold text-amber-700" : "text-emerald-600"}>{rem}</span>
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant={status === "received" ? "green" : status === "partial" ? "yellow" : "gray"}>{status}</Badge>
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-500">
                                <p>{l.lot_code ?? "—"}</p>
                                <p>{fmtDate(l.expiry_date)}</p>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Billing tab ── */}
              {activeTab === "billing" && (
                <div className="p-4 space-y-5">
                  {/* Landed costs summary */}
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-slate-900">Landed costs</p>
                      {canManage && <Button variant="secondary" size="sm" onClick={() => setLandedOpen(true)}>Edit</Button>}
                    </div>
                    <dl className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <dt className="text-xs text-slate-400">Goods</dt>
                        <dd className="font-semibold text-slate-900">{formatMoney(goodsTotal)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Freight</dt>
                        <dd className="font-semibold text-slate-900">{formatMoney(order.freight_cost_cents)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Other charges</dt>
                        <dd className="font-semibold text-slate-900">{formatMoney(order.other_charges_cents)}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 border-t border-slate-100 pt-3 flex justify-between">
                      <span className="text-xs font-semibold uppercase text-slate-500">Total landed</span>
                      <span className="font-bold text-slate-900">{formatMoney(goodsTotal + extraCharges)}</span>
                    </div>
                  </div>

                  {/* Price adjustments / chargebacks */}
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-500 mb-3">Price adjustments</p>
                    {adjError && <p className="mb-2 text-xs text-red-600">{adjError}</p>}
                    <div className="space-y-2 mb-4">
                      {billingAdjs.map((adj) => (
                        <div key={adj.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2.5">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{adj.reason}</p>
                            <p className="text-xs text-slate-400">{fmtDate(adj.created_at)}{adj.line_id ? ` · Line ${adj.line_id}` : ""}</p>
                          </div>
                          <span className={`font-semibold tabular-nums text-sm ${adj.amount_cents < 0 ? "text-red-600" : "text-emerald-700"}`}>
                            {adj.amount_cents < 0 ? "−" : "+"}{formatMoney(Math.abs(adj.amount_cents))}
                          </span>
                        </div>
                      ))}
                      {billingAdjs.length === 0 && <p className="text-xs text-slate-400">No adjustments.</p>}
                    </div>

                    {canManage && (
                      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 space-y-3">
                        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">New adjustment</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-slate-500 mb-1">Reason</label>
                            <input type="text" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="e.g. Overcharge correction, discount"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Amount ($, use − for deductions)</label>
                            <input type="text" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="-5.00"
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Applies to line (optional)</label>
                            <select value={adjLineId} onChange={(e) => setAdjLineId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none">
                              <option value="">Whole PO</option>
                              {order.lines.map((l) => <option key={l.id} value={l.id}>{l.product_sku} — {l.product_name}</option>)}
                            </select>
                          </div>
                          <Button variant="primary" size="sm" disabled={adjBusy || !adjReason.trim() || !adjAmount} onClick={() => void createAdj()} className="mt-5">
                            Add adjustment
                          </Button>
                        </div>
                      </div>
                    )}

                    {(billingAdjs.length > 0 || extraCharges > 0) && (
                      <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 flex justify-between text-sm">
                        <span className="font-semibold text-slate-700">Net billing total</span>
                        <span className="font-bold text-slate-950">{formatMoney(goodsTotal + extraCharges + adjTotal)}</span>
                      </div>
                    )}
                  </div>

                  {/* Document list */}
                  {documents.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-500 mb-2">Billing documents</p>
                      <div className="flex flex-wrap gap-2">
                        {documents.filter((d) => d.type === "invoice").map((doc) => (
                          <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <svg aria-hidden="true" className="w-4 h-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            <div>
                              <p className="text-xs font-medium text-slate-800">{doc.name}</p>
                              <p className="text-xs text-slate-400">{fmtBytes(doc.size_bytes)} · {new Date(doc.uploaded_at).toLocaleDateString()}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Credits tab ── */}
              {activeTab === "credits" && (
                <div className="p-4 space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Vendor credits for this PO</p>
                      <p className="text-xs text-slate-500">Chargebacks reduce what you owe; credit memos come from vendor-initiated adjustments.</p>
                    </div>
                    {canManage && (
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => void openCreditModal("chargeback")}>Chargeback</Button>
                        <Button variant="primary" size="sm" onClick={() => void openCreditModal("credit_memo")}>Credit memo</Button>
                      </div>
                    )}
                  </div>

                  {credits.length === 0 ? (
                    <p className="text-sm text-slate-400">No credits for this PO yet.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                      {credits.map((vc) => (
                        <div key={vc.id} className="flex items-center justify-between px-4 py-3 gap-4">
                          <div className="flex items-center gap-3">
                            <Badge variant={vc.type === "chargeback" ? "yellow" : "blue"}>
                              {vc.type === "chargeback" ? "Chargeback" : "Credit memo"}
                            </Badge>
                            <div>
                              <p className="text-sm font-medium text-slate-900">{vc.reason ?? "—"}</p>
                              <p className="text-xs text-slate-400">{fmtDate(vc.created_at)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-sm font-bold text-emerald-700 tabular-nums">−{formatMoney(vc.amount_cents)}</span>
                            <Badge variant={vc.status === "open" ? "green" : vc.status === "void" ? "gray" : "blue"}>
                              {vc.status}
                            </Badge>
                            {canManage && vc.status === "open" && (
                              <button type="button" onClick={() => void voidCredit(vc.id)} className="text-xs text-red-500 hover:text-red-700">Void</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {credits.length > 0 && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 flex justify-between text-sm">
                      <span className="font-semibold text-emerald-800">Total credits (open)</span>
                      <span className="font-bold text-emerald-800 tabular-nums">
                        −{formatMoney(credits.filter((c) => c.status === "open").reduce((s, c) => s + c.amount_cents, 0))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </>
        )}
      </div>

      {/* ── Receive stock modal ── */}
      <Modal
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        title="Receive Stock"
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setReceiveOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={receiveBusy} onClick={() => void submitReceive()}>
              {receiveBusy ? "Saving…" : "Confirm receipt"}
            </Button>
          </div>
        }
      >
        {receiveError && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{receiveError}</div>}
        <p className="mb-4 text-sm text-slate-500">Enter cases × units/case for each line. Total is auto-calculated.</p>
        <div className="flex flex-col gap-4">
          {order?.lines.filter((l) => remaining(l) > 0).map((line) => {
            const entry = receiveEntries.find((e) => e.lineId === line.id);
            if (!entry) return null;
            const rem = remaining(line);
            return (
              <div key={line.id} className="rounded-xl border border-slate-200 px-4 py-3 space-y-3">
                <div className="flex justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{line.product_name}</p>
                    <p className="text-xs text-slate-400 font-mono">{line.product_sku} · remaining: {rem}</p>
                  </div>
                  <span className="text-xs text-slate-400">{formatMoney(line.unit_cost_cents)}/unit</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Cases</label>
                    <input type="number" min={0} value={entry.cases} onChange={(e) => updateReceiveEntry(line.id, { cases: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-center focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Units/case</label>
                    <input type="number" min={1} value={entry.unitsPerCase} onChange={(e) => updateReceiveEntry(line.id, { unitsPerCase: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-center focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Total</label>
                    <div className={`rounded-lg border px-2 py-1.5 text-sm font-bold text-center tabular-nums ${entry.totalQty > rem ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50"}`}>{entry.totalQty}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Expiry</label>
                    <input type="date" value={entry.expiryDate} onChange={(e) => updateReceiveEntry(line.id, { expiryDate: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Lot code</label>
                    <input type="text" value={entry.lotCode} onChange={(e) => updateReceiveEntry(line.id, { lotCode: e.target.value })} placeholder="LOT-2026"
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* ── Landed costs modal ── */}
      <Modal
        open={landedOpen}
        onClose={() => setLandedOpen(false)}
        title="Landed Costs"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setLandedOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={landedBusy} onClick={() => void saveLandedCosts()}>Save</Button>
          </div>
        }
      >
        <p className="mb-4 text-sm text-slate-500">Extra charges distributed proportionally across all lines.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Freight ($)</label>
            <input type="text" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0.00"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Other charges ($)</label>
            <input type="text" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} placeholder="0.00"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
        </div>
      </Modal>

      {/* ── Credit / chargeback modal ── */}
      <Modal
        open={creditOpen}
        onClose={() => setCreditOpen(false)}
        title={creditType === "chargeback" ? "Create Chargeback" : "Create Credit Memo"}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCreditOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={creditBusy} onClick={() => void submitCredit()}>Create</Button>
          </div>
        }
      >
        {creditError && <p className="mb-3 text-sm text-red-600 bg-red-50 rounded px-3 py-2">{creditError}</p>}
        <div className="space-y-4">
          {creditType === "credit_memo" && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-2">Source of credit</label>
              <div className="flex gap-2">
                {(["manual", "expired", "damaged"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setCreditSource(s)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${creditSource === s ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-600 hover:border-blue-300"}`}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              {creditSource === "expired" && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  {expiredLotsLoading
                    ? <p className="text-xs text-amber-600">Loading expired lots…</p>
                    : expiredLots.length === 0
                    ? <p className="text-xs text-amber-600">No expired lots on hand.</p>
                    : (
                      <div className="space-y-1.5">
                        {expiredLots.map((lot) => (
                          <div key={lot.id} className="flex justify-between text-xs">
                            <span className="text-amber-900">{lot.name} — {lot.lot_code ?? "no lot"}</span>
                            <span className="font-semibold text-amber-800">{lot.qty_on_hand} units expired</span>
                          </div>
                        ))}
                      </div>
                    )
                  }
                </div>
              )}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Amount ($)</label>
            <input type="text" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="e.g. 12.50"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Reason</label>
            <input type="text" value={creditReason} onChange={(e) => setCreditReason(e.target.value)}
              placeholder={creditType === "chargeback" ? "e.g. Short shipment, damaged goods" : "e.g. Expired stock returned to vendor, price correction"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
