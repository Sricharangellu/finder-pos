"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { fmtDate } from "@/lib/date";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge, statusBadge } from "@/components/Badge";
import { formatMoney } from "@/lib/money";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { hasRole } from "@/lib/auth";
import type { Supplier, SuppliersResponse } from "@/api-client/types";
import {
  type PurchaseOrderDetail,
  type PriceHistoryItem,
  type DetailTab,
} from "./_components/shared";
import { LinesTab } from "./_components/LinesTab";
import { ReceiveTab } from "./_components/ReceiveTab";
import { BillingTab } from "./_components/BillingTab";
import { CreditsTab } from "./_components/CreditsTab";

const TABS: { key: DetailTab; label: string }[] = [
  { key: "lines",   label: "Line items" },
  { key: "receive", label: "Receive" },
  { key: "billing", label: "Billing" },
  { key: "credits", label: "Credits" },
];

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);

  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryItem[]>([]);
  const [phFilters, setPhFilters] = useState<{ from: string; to: string; qtyBreak: string }>({ from: "", to: "", qtyBreak: "" });
  const [phLoading, setPhLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>("lines");

  const canManage = hasRole("manager");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [orderRes, suppliersRes] = await Promise.all([
        apiGet<PurchaseOrderDetail>(`/api/v1/purchasing/orders/${id}`),
        apiGet<SuppliersResponse>("/api/v1/purchasing/suppliers"),
      ]);
      setOrder(orderRes);
      setSuppliers(suppliersRes.items ?? []);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Could not load purchase order.");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const loadPriceHistory = useCallback(async () => {
    const qs = new URLSearchParams();
    if (phFilters.from) qs.set("from", String(new Date(phFilters.from).getTime()));
    if (phFilters.to) qs.set("to", String(new Date(`${phFilters.to}T23:59:59`).getTime()));
    if (phFilters.qtyBreak) qs.set("qtyBreak", phFilters.qtyBreak);
    const q = qs.toString();
    setPhLoading(true);
    try {
      const h = await apiGet<{ items: PriceHistoryItem[] }>(
        `/api/v1/purchasing/orders/${id}/price-history${q ? `?${q}` : ""}`,
      );
      setPriceHistory(h.items ?? []);
    } catch {
      /* non-fatal — price intelligence is supplementary */
    } finally {
      setPhLoading(false);
    }
  }, [id, phFilters]);

  useEffect(() => {
    if (activeTab === "lines") void loadPriceHistory();
  }, [activeTab, loadPriceHistory]);

  const supplierName = (sid: string) => suppliers.find((s) => s.id === sid)?.name ?? sid;

  const goodsTotal = useMemo(
    () => (order?.lines ?? []).reduce((s, l) => s + l.line_cost_cents, 0),
    [order],
  );
  const extraCharges = useMemo(
    () => (order ? order.freight_cost_cents + order.other_charges_cents : 0),
    [order],
  );

  return (
    <EnterpriseShell
      active="purchasing"
      title={order ? `PO #${order.po_number ?? order.id.slice(0, 8)}` : "Purchase Order"}
      subtitle={order ? supplierName(order.supplier_id) : ""}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6">
        <button
          type="button"
          onClick={() => router.push("/purchasing")}
          className="inline-flex self-start items-center gap-1.5 text-sm text-slate-500 hover:text-slate-950"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back to Purchasing
        </button>

        {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">{error}</div>}
        {loading && !order && <div className="py-16 text-center text-sm text-slate-400">Loading…</div>}

        {order && (
          <>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusBadge(order.status)}>{order.status}</Badge>
                    {order.receive_status && order.receive_status !== order.status && (
                      <Badge variant={statusBadge(order.receive_status)}>recv: {order.receive_status}</Badge>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
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
                      <dd className="mt-0.5 font-bold text-slate-950">{formatMoney(goodsTotal + extraCharges)}</dd>
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
                  {order.notes && <p className="max-w-prose text-xs italic text-slate-500">{order.notes}</p>}
                </div>
                {canManage && order.status !== "received" && (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setActiveTab("billing")}>Landed costs</Button>
                    <Button variant="primary" size="sm" onClick={() => setActiveTab("receive")}>Receive stock</Button>
                  </div>
                )}
              </div>
            </Card>

            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-200">
                <nav className="-mb-px flex gap-0 px-4" aria-label="PO detail tabs">
                  {TABS.map((t) => (
                    <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
                      className={clsx(
                        "min-h-[44px] border-b-2 px-4 text-sm font-medium transition-colors",
                        activeTab === t.key
                          ? "border-blue-600 text-blue-600"
                          : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
                      )}
                      aria-current={activeTab === t.key ? "page" : undefined}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>
              </div>

              {activeTab === "lines" && (
                <LinesTab
                  order={order}
                  priceHistory={priceHistory}
                  goodsTotal={goodsTotal}
                  filters={phFilters}
                  onFiltersChange={setPhFilters}
                  loading={phLoading}
                />
              )}
              {activeTab === "receive" && (
                <ReceiveTab orderId={id} order={order} canManage={canManage} onReceived={() => void load()} />
              )}
              {activeTab === "billing" && (
                <BillingTab
                  orderId={id}
                  order={order}
                  canManage={canManage}
                  goodsTotal={goodsTotal}
                  extraCharges={extraCharges}
                  onLandedSaved={() => void load()}
                />
              )}
              {activeTab === "credits" && (
                <CreditsTab orderId={id} order={order} canManage={canManage} />
              )}
            </Card>
          </>
        )}
      </div>
    </EnterpriseShell>
  );
}
