"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { apiGet, apiPatch, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { useToast } from "@/components/Toast";
import { getUser } from "@/lib/auth";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  points: number;
  tier?: number;
  company?: string;
  dba?: string;
  taxId?: string;
  licenseNo?: string;
  state?: string;
  billingAddress?: string;
  shippingAddress?: string;
  salesRepId?: string;
  status: string;
  verified?: boolean;
  credit_limit_cents?: number;
}

interface CustomerSummary {
  customer: Customer;
  visits: number;
  totalSpentCents: number;
  avgOrderCents: number;
  lastVisitAt: number | null;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    createdAt: number;
  }>;
}

interface CustomerFinancials {
  openInvoicesCents: number;
  paidInvoicesCents: number;
  storeCredit?: number;
}

type DetailTab = "general" | "transactions" | "financials" | "store-credit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600 outline-none min-h-[44px]";
const LABEL_CLASS = "block text-xs font-semibold uppercase text-gray-500 mb-1";

function tierLabel(tier?: number): string {
  if (!tier) return "Standard";
  return `Tier ${tier}`;
}

function statusColor(status: string) {
  if (status === "active") return "bg-success-100 text-success-700";
  return "bg-gray-100 text-gray-600";
}

function orderStatusColor(status: string) {
  if (status === "completed") return "bg-success-100 text-success-700";
  if (status === "refunded") return "bg-warning-100 text-warning-700";
  if (status === "voided") return "bg-danger-100 text-danger-700";
  return "bg-gray-100 text-gray-600";
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ts));
}

// ─── ReadField ────────────────────────────────────────────────────────────────

function ReadField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className={LABEL_CLASS}>{label}</p>
      <div className="min-h-[40px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
        {value || <span className="text-gray-400">—</span>}
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <EnterpriseShell
      active="customers"
      title="Customer"
      subtitle="Loading..."
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="mb-5 h-4 w-24 animate-pulse rounded bg-gray-200" />
        <div className="mb-3 h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="flex gap-2 mb-6">
          <div className="h-6 w-16 animate-pulse rounded-full bg-gray-200" />
          <div className="h-6 w-16 animate-pulse rounded-full bg-gray-200" />
        </div>
        <div className="flex gap-1 border-b border-gray-200 mb-6">
          {["General", "Transactions", "Financials", "Store Credit"].map((t) => (
            <div key={t} className="h-10 w-24 animate-pulse rounded-t bg-gray-200 mr-1" />
          ))}
        </div>
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i}>
                <div className="mb-1 h-3 w-20 animate-pulse rounded bg-gray-200" />
                <div className="h-10 animate-pulse rounded-lg bg-gray-200" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </EnterpriseShell>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = params?.id as string;
  const { addToast } = useToast();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [financials, setFinancials] = useState<CustomerFinancials | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("general");
  const [editMode, setEditMode] = useState(false);

  const user = getUser();
  const canEdit = user?.role === "owner" || user?.role === "manager";

  const loadData = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.all([
      apiGet<Customer>(`/api/v1/customers/${customerId}`, { signal: controller.signal }),
      apiGet<CustomerSummary>(`/api/v1/customers/${customerId}/summary`, {
        signal: controller.signal,
      }).catch(() => null),
      apiGet<CustomerFinancials>(`/api/v1/customers/${customerId}/financials`, {
        signal: controller.signal,
      }).catch(() => null),
    ])
      .then(([cust, sum, fin]) => {
        if (controller.signal.aborted) return;
        setCustomer(cust);
        setSummary(sum);
        setFinancials(fin);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ApiResponseError ? err.message : "Could not load customer."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return controller;
  }, [customerId]);

  useEffect(() => {
    const controller = loadData();
    return () => controller.abort();
  }, [loadData]);

  if (loading) return <Skeleton />;

  if (error || !customer) {
    return (
      <EnterpriseShell
        active="customers"
        title="Customer"
        subtitle="Error"
        contentClassName="overflow-y-auto"
      >
        <div className="p-6">
          <Link
            href="/customers"
            className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline mb-4 block"
          >
            <BackIcon /> Back to Customers
          </Link>
          <div
            className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700"
            role="alert"
          >
            {error ?? "Customer not found."}
          </div>
        </div>
      </EnterpriseShell>
    );
  }

  const tabs: Array<{ key: DetailTab; label: string }> = [
    { key: "general", label: "General" },
    { key: "transactions", label: "Transactions" },
    { key: "financials", label: "Financials" },
    { key: "store-credit", label: "Store Credit" },
  ];

  return (
    <EnterpriseShell
      active="customers"
      title={customer.name}
      subtitle="Customer profile"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-5xl flex flex-col gap-5 px-4 py-6">
        {/* Back */}
        <div>
          <Link
            href="/customers"
            className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
          >
            <BackIcon /> Back to Customers
          </Link>
        </div>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{customer.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                {tierLabel(customer.tier)}
              </span>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusColor(customer.status)}`}
              >
                {customer.status}
              </span>
              {customer.verified && (
                <span className="inline-flex rounded-full bg-success-100 px-2.5 py-0.5 text-xs font-semibold text-success-700">
                  Verified
                </span>
              )}
            </div>
          </div>

          {canEdit && (
            <Button
              variant={editMode ? "secondary" : "primary"}
              size="sm"
              onClick={() => {
                setEditMode((prev) => !prev);
                setActiveTab("general");
              }}
            >
              {editMode ? "Cancel edit" : "Edit"}
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={[
                "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab.key
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        {activeTab === "general" && (
          <GeneralTab
            customer={customer}
            editMode={editMode}
            onSaved={(updated) => {
              setCustomer(updated);
              setEditMode(false);
              addToast({ title: "Customer saved", variant: "success" });
            }}
            onSaveError={(msg) => {
              addToast({ title: "Save failed", description: msg, variant: "error" });
            }}
            onCancel={() => setEditMode(false)}
          />
        )}
        {activeTab === "transactions" && <TransactionsTab summary={summary} />}
        {activeTab === "financials" && (
          <FinancialsTab customer={customer} summary={summary} financials={financials} />
        )}
        {activeTab === "store-credit" && (
          <StoreCreditTab customer={customer} financials={financials} canEdit={canEdit} />
        )}
      </div>
    </EnterpriseShell>
  );
}

// ─── General Tab ─────────────────────────────────────────────────────────────

function GeneralTab({
  customer,
  editMode,
  onSaved,
  onSaveError,
  onCancel,
}: {
  customer: Customer;
  editMode: boolean;
  onSaved: (updated: Customer) => void;
  onSaveError: (msg: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: customer.name,
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    company: customer.company ?? "",
    dba: customer.dba ?? "",
    taxId: customer.taxId ?? "",
    licenseNo: customer.licenseNo ?? "",
    state: customer.state ?? "",
    tier: customer.tier?.toString() ?? "",
    status: customer.status,
    billingAddress: customer.billingAddress ?? "",
    shippingAddress: customer.shippingAddress ?? "",
  });
  const [saving, setSaving] = useState(false);

  // Sync form when customer changes externally
  useEffect(() => {
    setForm({
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      company: customer.company ?? "",
      dba: customer.dba ?? "",
      taxId: customer.taxId ?? "",
      licenseNo: customer.licenseNo ?? "",
      state: customer.state ?? "",
      tier: customer.tier?.toString() ?? "",
      status: customer.status,
      billingAddress: customer.billingAddress ?? "",
      shippingAddress: customer.shippingAddress ?? "",
    });
  }, [customer]);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        company: form.company || undefined,
        dba: form.dba || undefined,
        taxId: form.taxId || undefined,
        licenseNo: form.licenseNo || undefined,
        state: form.state || undefined,
        tier: form.tier ? Number(form.tier) : undefined,
        status: form.status || undefined,
        billingAddress: form.billingAddress || undefined,
        shippingAddress: form.shippingAddress || undefined,
      };
      const updated = await apiPatch<Customer>(`/api/v1/customers/${customer.id}`, body);
      onSaved(updated);
    } catch (err) {
      onSaveError(err instanceof ApiResponseError ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (editMode) {
    return (
      <div className="flex flex-col gap-5">
        {/* Edit actions banner */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
          <p className="text-sm font-medium text-brand-800">Editing customer profile</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              onClick={() => void handleSave()}
            >
              Save changes
            </Button>
          </div>
        </div>

        <Card title="Contact information">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LABEL_CLASS}>Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </Card>

        <Card title="Business information">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>Company</label>
              <input
                type="text"
                value={form.company}
                onChange={(e) => update("company", e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>DBA</label>
              <input
                type="text"
                value={form.dba}
                onChange={(e) => update("dba", e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Tax ID</label>
              <input
                type="text"
                value={form.taxId}
                onChange={(e) => update("taxId", e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>License No.</label>
              <input
                type="text"
                value={form.licenseNo}
                onChange={(e) => update("licenseNo", e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>State</label>
              <input
                type="text"
                value={form.state}
                onChange={(e) => update("state", e.target.value)}
                placeholder="e.g. CA"
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </Card>

        <Card title="Account settings">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>Tier</label>
              <select
                value={form.tier}
                onChange={(e) => update("tier", e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">Standard</option>
                <option value="1">Tier 1</option>
                <option value="2">Tier 2</option>
                <option value="3">Tier 3</option>
                <option value="4">Tier 4</option>
                <option value="5">Tier 5</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Status</label>
              <select
                value={form.status}
                onChange={(e) => update("status", e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </Card>

        <Card title="Addresses">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>Billing Address</label>
              <textarea
                value={form.billingAddress}
                onChange={(e) => update("billingAddress", e.target.value)}
                rows={3}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Shipping Address</label>
              <textarea
                value={form.shippingAddress}
                onChange={(e) => update("shippingAddress", e.target.value)}
                rows={3}
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Display mode
  return (
    <div className="flex flex-col gap-5">
      <Card title="Contact information">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ReadField label="Name" value={customer.name} />
          </div>
          <ReadField label="Email" value={customer.email} />
          <ReadField label="Phone" value={customer.phone} />
        </div>
      </Card>

      <Card title="Business information">
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadField label="Company" value={customer.company} />
          <ReadField label="DBA" value={customer.dba} />
          <ReadField label="Tax ID" value={customer.taxId} />
          <ReadField label="License No." value={customer.licenseNo} />
          <ReadField label="State" value={customer.state} />
        </div>
      </Card>

      <Card title="Account settings">
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadField label="Tier" value={tierLabel(customer.tier)} />
          <ReadField label="Status" value={customer.status} />
          <ReadField label="Loyalty Points" value={String(customer.points)} />
          {customer.credit_limit_cents !== undefined && (
            <ReadField label="Credit Limit" value={formatMoney(customer.credit_limit_cents)} />
          )}
        </div>
      </Card>

      <Card title="Addresses">
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadField label="Billing Address" value={customer.billingAddress} />
          <ReadField label="Shipping Address" value={customer.shippingAddress} />
        </div>
      </Card>
    </div>
  );
}

// ─── Transactions Tab ─────────────────────────────────────────────────────────

function TransactionsTab({ summary }: { summary: CustomerSummary | null }) {
  if (!summary) {
    return (
      <Card>
        <p className="text-sm text-gray-500">Transaction data unavailable.</p>
      </Card>
    );
  }

  const orders = summary.recentOrders;

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Recent transactions"
        description="Showing most recent orders for this customer."
      >
        {orders.length === 0 ? (
          <p className="text-sm text-gray-500">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Order #</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href="/sales"
                        className="font-mono text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold capitalize ${orderStatusColor(order.status)}`}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {formatMoney(order.totalCents)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {formatDate(order.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Financials Tab ───────────────────────────────────────────────────────────

function FinancialsTab({
  customer,
  summary,
  financials,
}: {
  customer: Customer;
  summary: CustomerSummary | null;
  financials: CustomerFinancials | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FinancialMetric
          label="Open invoices"
          value={financials ? formatMoney(financials.openInvoicesCents) : "—"}
          sub="outstanding balance"
        />
        <FinancialMetric
          label="Paid invoices"
          value={financials ? formatMoney(financials.paidInvoicesCents) : "—"}
          sub="total paid"
        />
        <FinancialMetric
          label="Loyalty points"
          value={String(customer.points)}
          sub="redeemable at checkout"
        />
        <FinancialMetric
          label="Avg order value"
          value={summary ? formatMoney(summary.avgOrderCents) : "—"}
          sub="per transaction"
        />
        <FinancialMetric
          label="Total visits"
          value={summary ? String(summary.visits) : "—"}
          sub="all time"
        />
        <FinancialMetric
          label="Total spend"
          value={summary ? formatMoney(summary.totalSpentCents) : "—"}
          sub="lifetime"
        />
      </div>

      {financials === null && (
        <div
          className="rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700"
          role="status"
        >
          Financial data could not be loaded. Showing available summary data only.
        </div>
      )}
    </div>
  );
}

function FinancialMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{sub}</p>
    </Card>
  );
}

// ─── Store Credit Tab ─────────────────────────────────────────────────────────

function StoreCreditTab({
  customer,
  financials,
  canEdit,
}: {
  customer: Customer;
  financials: CustomerFinancials | null;
  canEdit: boolean;
}) {
  const creditBalance = financials?.storeCredit ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <Card title="Store credit balance">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-3xl font-bold text-gray-900">{formatMoney(creditBalance)}</p>
            <p className="mt-1 text-sm text-gray-500">
              Available store credit for {customer.name}
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            <p className="font-medium text-gray-700">Credit management</p>
            <p className="mt-1">
              Store credit is applied and managed at checkout. To add or redeem credit,
              open a new sale from the{" "}
              <Link href="/terminal" className="text-brand-700 underline underline-offset-2">
                Register
              </Link>{" "}
              and select the customer at the tender screen.
            </p>
          </div>
        </div>
      </Card>

      {canEdit && (
        <Card title="Credit details">
          <div className="grid gap-4 sm:grid-cols-2">
            {customer.credit_limit_cents !== undefined && (
              <div>
                <p className={LABEL_CLASS}>Credit limit</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatMoney(customer.credit_limit_cents)}
                </p>
              </div>
            )}
            <div>
              <p className={LABEL_CLASS}>Current balance</p>
              <p className="text-lg font-bold text-gray-900">{formatMoney(creditBalance)}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-gray-400">
            Credit management via checkout. Contact support to adjust credit limits.
          </p>
        </Card>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function BackIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
