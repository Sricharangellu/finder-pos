"use client";

/**
 * /insights — Scheduled reports + inventory forecasting.
 * Two tabs:
 *   1. Scheduled Reports — list/create/delete automated report emails
 *   2. Forecasting — reorder recommendations + top sellers by velocity
 *
 * Fetches:
 *   GET/POST/PATCH/DELETE /api/v1/insights/scheduled-reports
 *   GET /api/v1/insights/reorder
 *   GET /api/v1/insights/order-recommendations
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { getUser } from "@/lib/auth";
import { useToast } from "@/components/Toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type ReportType = "sales_summary" | "top_products" | "inventory_valuation" | "p_l" | "ar_aging" | "ap_aging";
type Frequency = "daily" | "weekly" | "monthly";

interface ScheduledReport {
  id: string;
  name: string;
  reportType: ReportType;
  frequency: Frequency;
  recipientEmails: string[];
  enabled: boolean;
  lastSentAt: number | null;
  nextSendAt: number;
  createdAt: number;
  updatedAt: number;
}

interface ReorderRec {
  productId: string;
  sku: string;
  name: string;
  currentStock: number;
  reorderPoint: number;
  reorderQuantity: number;
  leadTimeDays: number;
  velocityPerDay: number;
  daysOfStock: number;
  belowReorderPoint: boolean;
  supplierId: string | null;
}

interface OrderRec {
  productId: string;
  sku: string;
  name: string;
  totalUnitsSold: number;
  revenueGrossCents: number;
  rank: number;
  belowReorderPoint: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  sales_summary: "Sales Summary",
  top_products: "Top Products",
  inventory_valuation: "Inventory Valuation",
  p_l: "Profit & Loss",
  ar_aging: "AR Aging",
  ap_aging: "AP Aging",
};

const FREQ_LABELS: Record<Frequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ms: number | null): string {
  if (!ms) return "Never";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function urgencyBadge(rec: ReorderRec): "red" | "yellow" | "gray" {
  if (rec.currentStock === 0) return "red";
  if (rec.belowReorderPoint || rec.daysOfStock <= rec.leadTimeDays) return "yellow";
  return "gray";
}

function urgencyLabel(rec: ReorderRec): string {
  if (rec.currentStock === 0) return "Out of stock";
  if (rec.belowReorderPoint) return "Below reorder point";
  if (rec.daysOfStock <= rec.leadTimeDays) return "Order soon";
  return "Monitor";
}

// ── Scheduled Reports Tab ─────────────────────────────────────────────────────

function ScheduledReportsTab({ isOwner }: { isOwner: boolean }) {
  const { addToast } = useToast();
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "",
    reportType: "sales_summary" as ReportType,
    frequency: "weekly" as Frequency,
    recipientEmails: "",
  });

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: ScheduledReport[] }>("/api/v1/insights/scheduled-reports")
      .then((d) => setReports(d.items ?? []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const createReport = async () => {
    const emails = form.recipientEmails.split(",").map((e) => e.trim()).filter(Boolean);
    if (!form.name.trim() || emails.length === 0) return;
    setBusy(true);
    try {
      await apiPost("/api/v1/insights/scheduled-reports", {
        name: form.name.trim(),
        reportType: form.reportType,
        frequency: form.frequency,
        recipientEmails: emails,
      });
      setShowAdd(false);
      setForm({ name: "", reportType: "sales_summary", frequency: "weekly", recipientEmails: "" });
      load();
      addToast({ title: "Report scheduled", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof ApiResponseError ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  const toggleEnabled = async (r: ScheduledReport) => {
    try {
      await apiPatch(`/api/v1/insights/scheduled-reports/${r.id}`, { enabled: !r.enabled });
      load();
    } catch {
      addToast({ title: "Failed to update", variant: "error" });
    }
  };

  const deleteReport = async (id: string) => {
    if (!confirm("Delete this scheduled report?")) return;
    try {
      await apiDelete(`/api/v1/insights/scheduled-reports/${id}`);
      load();
      addToast({ title: "Report deleted", variant: "success" });
    } catch {
      addToast({ title: "Failed to delete", variant: "error" });
    }
  };

  const triggerReport = async (id: string) => {
    try {
      await apiPost(`/api/v1/insights/scheduled-reports/${id}/trigger`, {});
      load();
      addToast({ title: "Report triggered", description: "Next send time advanced.", variant: "success" });
    } catch {
      addToast({ title: "Failed to trigger", variant: "error" });
    }
  };

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Scheduled reports</h2>
            <p className="text-sm text-slate-500">Automated report emails sent on a recurring schedule.</p>
          </div>
          {isOwner && !showAdd && (
            <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>+ New report</Button>
          )}
        </div>

        {showAdd && isOwner && (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Report name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Weekly Sales Digest"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Recipients (comma-separated emails)</label>
                <input
                  value={form.recipientEmails}
                  onChange={(e) => setForm((f) => ({ ...f, recipientEmails: e.target.value }))}
                  placeholder="owner@example.com, cfo@example.com"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Report type</label>
                <select
                  value={form.reportType}
                  onChange={(e) => setForm((f) => ({ ...f, reportType: e.target.value as ReportType }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950 bg-white"
                >
                  {(Object.entries(REPORT_TYPE_LABELS) as [ReportType, string][]).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Frequency</label>
                <select
                  value={form.frequency}
                  onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Frequency }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950 bg-white"
                >
                  {(Object.entries(FREQ_LABELS) as [Frequency, string][]).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button
                size="sm" variant="primary" loading={busy}
                disabled={!form.name.trim() || !form.recipientEmails.trim()}
                onClick={createReport}
              >
                Schedule
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="px-4 py-6 text-sm text-slate-500" aria-busy="true">Loading…</p>
        ) : reports.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-slate-500">No scheduled reports yet.</p>
            {isOwner && (
              <p className="mt-1 text-sm text-slate-400">Create one above to start sending automated reports.</p>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3 hidden md:table-cell">Last sent</th>
                <th className="px-4 py-3 hidden md:table-cell">Next send</th>
                <th className="px-4 py-3">Status</th>
                {isOwner && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reports.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">{r.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{r.recipientEmails.join(", ")}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{REPORT_TYPE_LABELS[r.reportType] ?? r.reportType}</td>
                  <td className="px-4 py-3">
                    <Badge variant="blue">{FREQ_LABELS[r.frequency] ?? r.frequency}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{fmtDate(r.lastSentAt)}</td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{fmtDate(r.nextSendAt)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={r.enabled ? "green" : "gray"}>{r.enabled ? "Active" : "Paused"}</Badge>
                  </td>
                  {isOwner && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => triggerReport(r.id)}>Run</Button>
                        <Button size="sm" variant="ghost" onClick={() => toggleEnabled(r)}>
                          {r.enabled ? "Pause" : "Resume"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteReport(r.id)}>Delete</Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ── Forecasting Tab ───────────────────────────────────────────────────────────

function ForecastingTab() {
  const [reorder, setReorder] = useState<ReorderRec[]>([]);
  const [topSellers, setTopSellers] = useState<OrderRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingPOs, setCreatingPOs] = useState(false);
  const { addToast } = useToast();
  const router = useRouter();

  const handleCreateReorderPOs = useCallback(async () => {
    setCreatingPOs(true);
    try {
      const result = await apiPost<{ created: number; draft_po_ids: string[] }>(
        "/api/v1/purchasing/orders/auto-draft", {},
      );
      addToast({
        title: `Created ${result.created} draft purchase order${result.created === 1 ? "" : "s"}`,
        variant: "success",
      });
      router.push("/purchasing");
    } catch (e) {
      addToast({
        title: "Could not create draft POs — try again",
        description: e instanceof ApiResponseError ? e.message : undefined,
        variant: "error",
      });
    } finally { setCreatingPOs(false); }
  }, [addToast, router]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet<{ items: ReorderRec[] }>("/api/v1/insights/reorder"),
      apiGet<{ items: OrderRec[] }>("/api/v1/insights/order-recommendations"),
    ]).then(([r, t]) => {
      if (!cancelled) {
        setReorder(r.items ?? []);
        setTopSellers(t.items ?? []);
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-sm text-slate-500" aria-busy="true">Loading…</p>;

  return (
    <div className="space-y-6">
      {/* Reorder recommendations */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Reorder recommendations</h2>
            <p className="text-sm text-slate-500">
              Products at or below reorder point, or projected to run out before lead time.
            </p>
          </div>
          {reorder.some(r => r.belowReorderPoint) && (
            <Button variant="primary" size="sm" loading={creatingPOs} onClick={() => void handleCreateReorderPOs()}>
              Create Draft POs
            </Button>
          )}
        </div>
        {reorder.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-slate-500">All products are well-stocked.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">On hand</th>
                <th className="px-4 py-3 hidden sm:table-cell">Reorder qty</th>
                <th className="px-4 py-3 hidden md:table-cell">Days of stock</th>
                <th className="px-4 py-3 hidden md:table-cell">Velocity/day</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reorder.map((r) => (
                <tr key={r.productId} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">{r.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{r.sku}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={r.currentStock === 0 ? "font-semibold text-red-600" : r.belowReorderPoint ? "font-semibold text-amber-600" : "text-slate-700"}>
                      {r.currentStock}
                    </span>
                    <span className="text-slate-400 text-xs ml-1">/ {r.reorderPoint} min</span>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-slate-700">
                    {r.reorderQuantity > 0 ? r.reorderQuantity : "—"}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-slate-700">
                    {r.daysOfStock >= 9999 ? "∞" : `${r.daysOfStock}d`}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-slate-500">
                    {r.velocityPerDay.toFixed(1)} u/day
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={urgencyBadge(r)}>{urgencyLabel(r)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Top sellers */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Top sellers — order recommendations</h2>
          <p className="text-sm text-slate-500">
            Highest-velocity products over the last 30 days. Flag indicates below reorder point.
          </p>
        </div>
        {topSellers.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-slate-500">No sales data available yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                <th className="px-4 py-3 w-10">#</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Units sold</th>
                <th className="px-4 py-3 hidden sm:table-cell">Gross revenue</th>
                <th className="px-4 py-3">Stock status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {topSellers.map((t) => (
                <tr key={t.productId} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-slate-400 font-medium">{t.rank}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">{t.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{t.sku}</p>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-950">{t.totalUnitsSold.toLocaleString()}</td>
                  <td className="px-4 py-3 hidden sm:table-cell text-slate-700">{formatMoney(t.revenueGrossCents)}</td>
                  <td className="px-4 py-3">
                    {t.belowReorderPoint
                      ? <Badge variant="yellow">Reorder needed</Badge>
                      : <Badge variant="green">In stock</Badge>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "reports" | "forecasting";

export default function InsightsPage() {
  const user = getUser();
  const role = user?.role ?? "cashier";
  const isOwner = role === "owner";
  const allowed = role === "owner" || role === "manager";
  const [tab, setTab] = useState<Tab>("reports");

  return (
    <EnterpriseShell
      active="insights"
      title="Insights"
      subtitle="Scheduled reports and inventory forecasting"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {!allowed ? (
          <Card>
            <p role="alert" className="text-sm text-slate-700">
              You don&apos;t have access to Insights. Ask an owner or manager.
            </p>
          </Card>
        ) : (
          <>
            {/* Tab bar */}
            <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit shadow-sm">
              {([ ["reports", "Scheduled Reports"], ["forecasting", "Forecasting"] ] as [Tab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`min-h-[36px] rounded px-4 text-sm font-medium transition-colors ${
                    tab === key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "reports" && <ScheduledReportsTab isOwner={isOwner} />}
            {tab === "forecasting" && <ForecastingTab />}
          </>
        )}
      </div>
    </EnterpriseShell>
  );
}
