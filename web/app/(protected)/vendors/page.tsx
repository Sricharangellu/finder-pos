"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney, parseToCents } from "@/lib/money";
import { hasRole } from "@/lib/auth";

interface Vendor {
  id: string;
  name: string;
  company: string | null;
  dba: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  fein_number: string | null;
  vendor_type: string | null;
  msa_type: string | null;
  due_amount_cents: number;
  terms_days: number | null;
  contact_name: string | null;
  primary_sales_rep: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: "active" | "inactive" | string;
  poCount: number;
  totalSpentCents: number;
  openCreditsCents: number;
}

interface VendorCredit {
  id: string;
  supplier_id: string;
  type: "chargeback" | "credit_memo";
  amount_cents: number;
  reason: string | null;
  po_id: string | null;
  status: "open" | "applied" | "void";
  created_at: number;
}

interface VendorReturn {
  id: string;
  supplier_id: string | null;
  reason: "damaged" | "expired" | "other";
  total_cost_cents: number;
  credit_id: string | null;
  status: "recorded";
  created_at: number;
}

type VendorFilter = "all" | "active" | "inactive" | "compliance" | "credits";

const creditTypeLabel = {
  chargeback: "Chargeback",
  credit_memo: "Credit memo",
};

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [credits, setCredits] = useState<VendorCredit[]>([]);
  const [returns, setReturns] = useState<VendorReturn[]>([]);
  const [filter, setFilter] = useState<VendorFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditType, setCreditType] = useState<"chargeback" | "credit_memo">("credit_memo");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = hasRole("manager");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [vendorRes, creditRes, returnRes] = await Promise.all([
        apiGet<{ items: Vendor[] }>("/api/v1/purchasing/vendors"),
        apiGet<{ items: VendorCredit[] }>("/api/v1/purchasing/vendor-credits"),
        apiGet<{ items: VendorReturn[] }>("/api/v1/purchasing/returns"),
      ]);
      setVendors(vendorRes.items ?? []);
      setCredits(creditRes.items ?? []);
      setReturns(returnRes.items ?? []);
      setSelectedVendorId((current) => current || vendorRes.items?.[0]?.id || "");
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Could not load vendor data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    return {
      active: vendors.filter((vendor) => vendor.status === "active").length,
      inactive: vendors.filter((vendor) => vendor.status !== "active").length,
      openCredits: vendors.reduce((sum, vendor) => sum + vendor.openCreditsCents, 0),
      due: vendors.reduce((sum, vendor) => sum + vendor.due_amount_cents, 0),
      spent: vendors.reduce((sum, vendor) => sum + vendor.totalSpentCents, 0),
      complianceGaps: vendors.filter((vendor) => !vendor.tax_id || !vendor.fein_number || !vendor.vendor_type).length,
    };
  }, [vendors]);

  const filteredVendors = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors.filter((vendor) => {
      if (filter === "active" && vendor.status !== "active") return false;
      if (filter === "inactive" && vendor.status === "active") return false;
      if (filter === "compliance" && vendor.tax_id && vendor.fein_number && vendor.vendor_type) return false;
      if (filter === "credits" && vendor.openCreditsCents <= 0) return false;
      if (!q) return true;
      return [vendor.name, vendor.company, vendor.dba, vendor.email, vendor.phone, vendor.vendor_type, vendor.msa_type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [filter, query, vendors]);

  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId);
  const recentCredits = credits.slice(0, 6);
  const recentReturns = returns.slice(0, 6);

  const createCredit = async () => {
    if (!selectedVendorId || !creditAmount) return;
    const amountCents = parseToCents(creditAmount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Enter a valid credit amount.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/v1/purchasing/vendor-credits", {
        supplierId: selectedVendorId,
        type: creditType,
        amountCents,
        reason: creditReason.trim() || undefined,
      });
      setCreditAmount("");
      setCreditReason("");
      await load();
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Could not create vendor credit.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseShell active="vendors" title="Vendors" subtitle="Suppliers, compliance, credits, and purchase history" contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {error && (
          <div className="rounded-md border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {error}
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Metric label="Active vendors" value={summary.active} helper={`${summary.inactive} inactive`} tone="success" />
          <Metric label="Compliance gaps" value={summary.complianceGaps} helper="Missing tax profile" tone={summary.complianceGaps > 0 ? "warning" : "neutral"} />
          <Metric label="Open credits" value={formatMoney(summary.openCredits)} helper={`${credits.length} credit records`} tone="brand" />
          <Metric label="AP due" value={formatMoney(summary.due)} helper="Supplier balances" tone={summary.due > 0 ? "warning" : "neutral"} />
          <Metric label="Received spend" value={formatMoney(summary.spent)} helper="Received POs" tone="neutral" />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card className="overflow-hidden p-0">
            <div className="grid gap-3 border-b border-slate-200 px-4 py-3 lg:grid-cols-[minmax(220px,1fr)_auto]">
              <label className="min-w-0">
                <span className="sr-only">Search vendors</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search vendors by name, email, type..."
                  className="min-h-[40px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </label>
              <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Vendor filters">
                {(["all", "active", "inactive", "compliance", "credits"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setFilter(item)}
                    aria-pressed={filter === item}
                    className={`min-h-[40px] whitespace-nowrap rounded-md px-3 text-sm font-medium capitalize transition-colors ${
                      filter === item ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {item === "compliance" ? "Gaps" : item === "credits" ? "Credits" : item}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500" aria-busy="true">Loading vendors...</div>
            ) : filteredVendors.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500">No vendors match the current view.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredVendors.map((vendor) => (
                  <VendorRow key={vendor.id} vendor={vendor} onSelect={() => setSelectedVendorId(vendor.id)} selected={vendor.id === selectedVendorId} />
                ))}
              </div>
            )}
          </Card>

          <div className="space-y-5">
            <Card title="Vendor Credit" description="Create chargebacks or credit memos for AP recovery.">
              {canManage ? (
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Vendor</span>
                    <select
                      value={selectedVendorId}
                      onChange={(event) => setSelectedVendorId(event.target.value)}
                      className="mt-1 min-h-[40px] w-full rounded-md border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Type</span>
                    <select
                      value={creditType}
                      onChange={(event) => setCreditType(event.target.value as "chargeback" | "credit_memo")}
                      className="mt-1 min-h-[40px] w-full rounded-md border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <option value="credit_memo">Credit memo</option>
                      <option value="chargeback">Chargeback</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Amount</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={creditAmount}
                      onChange={(event) => setCreditAmount(event.target.value)}
                      placeholder="0.00"
                      className="mt-1 min-h-[40px] w-full rounded-md border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Reason</span>
                    <textarea
                      value={creditReason}
                      onChange={(event) => setCreditReason(event.target.value)}
                      rows={3}
                      placeholder="Damaged case, price variance, expired return..."
                      className="mt-1 w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </label>
                  <Button variant="primary" size="sm" fullWidth disabled={busy || !selectedVendorId || !creditAmount} onClick={() => void createCredit()}>
                    Create credit
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Manager access is required to create vendor credits.</p>
              )}
            </Card>

            <Card title="Selected Vendor">
              {selectedVendor ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="font-semibold text-slate-950">{selectedVendor.name}</p>
                    <p className="text-slate-500">{selectedVendor.company ?? selectedVendor.dba ?? "No company profile"}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <MiniStat label="Terms" value={selectedVendor.terms_days != null ? `${selectedVendor.terms_days} days` : "Unset"} />
                    <MiniStat label="Open credits" value={formatMoney(selectedVendor.openCreditsCents)} />
                    <MiniStat label="POs" value={String(selectedVendor.poCount)} />
                    <MiniStat label="Spend" value={formatMoney(selectedVendor.totalSpentCents)} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Select a vendor to inspect details.</p>
              )}
            </Card>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <ActivityCard title="Recent Credits" empty="No vendor credits recorded yet.">
            {recentCredits.map((credit) => (
              <ActivityItem
                key={credit.id}
                title={`${creditTypeLabel[credit.type]} · ${formatMoney(credit.amount_cents)}`}
                subtitle={`${vendorName(vendors, credit.supplier_id)} · ${credit.reason ?? "No reason"}`}
                meta={credit.status}
              />
            ))}
          </ActivityCard>
          <ActivityCard title="Recent Returns" empty="No vendor returns recorded yet.">
            {recentReturns.map((item) => (
              <ActivityItem
                key={item.id}
                title={`${item.reason} return · ${formatMoney(item.total_cost_cents)}`}
                subtitle={`${item.supplier_id ? vendorName(vendors, item.supplier_id) : "No vendor linked"}${item.credit_id ? " · credit created" : ""}`}
                meta={item.status}
              />
            ))}
          </ActivityCard>
        </section>
      </div>
    </EnterpriseShell>
  );
}

function vendorName(vendors: Vendor[], id: string) {
  return vendors.find((vendor) => vendor.id === id)?.name ?? id;
}

function Metric({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string | number;
  helper: string;
  tone: "neutral" | "success" | "warning" | "brand";
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-white",
    success: "border-success-200 bg-success-50",
    warning: "border-warning-200 bg-warning-50",
    brand: "border-brand-200 bg-brand-50",
  }[tone];
  return (
    <div className={`rounded-md border p-4 shadow-sm ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{helper}</p>
    </div>
  );
}

function VendorRow({ vendor, selected, onSelect }: { vendor: Vendor; selected: boolean; onSelect: () => void }) {
  const hasComplianceGap = !vendor.tax_id || !vendor.fein_number || !vendor.vendor_type;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full gap-3 border-l-4 px-4 py-4 text-left transition-colors lg:grid-cols-[minmax(0,1.2fr)_0.8fr_0.8fr_auto] ${
        selected ? "border-l-brand-600 bg-brand-50/50" : hasComplianceGap ? "border-l-warning-500 hover:bg-warning-50/40" : "border-l-success-500 hover:bg-slate-50"
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-slate-950">{vendor.name}</p>
          <Badge variant={vendor.status === "active" ? "green" : "gray"}>{vendor.status}</Badge>
          {hasComplianceGap && <Badge variant="yellow">compliance gap</Badge>}
        </div>
        <p className="mt-1 truncate text-xs text-slate-500">{vendor.company ?? vendor.dba ?? vendor.email ?? "No company profile"}</p>
      </div>
      <div className="text-sm">
        <p className="font-medium text-slate-700">{vendor.vendor_type ?? "Type unset"}</p>
        <p className="text-xs text-slate-500">{vendor.msa_type ?? "MSA unset"}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        <MiniStat label="POs" value={String(vendor.poCount)} />
        <MiniStat label="Credits" value={formatMoney(vendor.openCreditsCents)} />
        <MiniStat label="Due" value={formatMoney(vendor.due_amount_cents)} />
      </div>
      <div className="text-right text-xs text-slate-500">
        <p>{vendor.contact_name ?? "No contact"}</p>
        <p>{[vendor.city, vendor.state].filter(Boolean).join(", ") || vendor.phone || "No location"}</p>
      </div>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-100 px-2 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold tabular-nums text-slate-800">{value}</p>
    </div>
  );
}

function ActivityCard({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <Card title={title} noPadding>
      {children.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="divide-y divide-slate-100">{children}</div>
      )}
    </Card>
  );
}

function ActivityItem({ title, subtitle, meta }: { title: string; subtitle: string; meta: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-950">{title}</p>
        <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>
      </div>
      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{meta}</span>
    </div>
  );
}
