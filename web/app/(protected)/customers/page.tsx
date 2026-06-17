"use client";

import { useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import type {
  CustomerSummary,
  CustomersResponse,
  RetailCustomer,
} from "@/api-client/types";

type CustomerType = "retail" | "business";

interface NewCustomerForm {
  customerType: CustomerType;
  // Shared
  name: string;
  email: string;
  phone: string;
  notes: string;
  // Retail only
  dateOfBirthStr: string;
  // Business only
  company: string;
  contactPerson: string;
  taxId: string;
  licenseNo: string;
  dba: string;
  state: string;
  billingAddress: string;
  shippingAddress: string;
  creditLimitDollars: string;
  tier: string;
  salesRepId: string;
}

const emptyForm = (): NewCustomerForm => ({
  customerType: "retail",
  name: "", email: "", phone: "", notes: "",
  dateOfBirthStr: "",
  company: "", contactPerson: "", taxId: "", licenseNo: "",
  dba: "", state: "", billingAddress: "", shippingAddress: "",
  creditLimitDollars: "", tier: "5", salesRepId: "",
});

type Segment = "Loyal" | "Regular" | "New" | "At risk";
type SegmentFilter = "All" | Segment;

interface CustomerView {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  visits: number;
  spendCents: number;
  avgOrderCents: number;
  segment: Segment;
  loyaltyPoints: number;
  lastVisitAt: number | null;
  recentOrders: CustomerSummary["recentOrders"];
  notes: string;
}

function fallbackSummary(customer: RetailCustomer): CustomerSummary {
  return {
    customer,
    visits: 0,
    totalSpentCents: 0,
    avgOrderCents: 0,
    lastVisitAt: null,
    recentOrders: [],
  };
}

function segmentFor(summary: CustomerSummary): Segment {
  const lastVisitAt = summary.lastVisitAt;
  const daysSinceVisit =
    lastVisitAt === null ? Number.POSITIVE_INFINITY : (Date.now() - lastVisitAt) / 86_400_000;

  if (daysSinceVisit > 30 && summary.visits > 1) return "At risk";
  if (summary.customer.points >= 1000 || summary.totalSpentCents >= 30_000) return "Loyal";
  if (summary.visits <= 3) return "New";
  return "Regular";
}

function noteFor(customer: RetailCustomer, segment: Segment) {
  if (segment === "At risk") return `${customer.name} has not visited recently. Consider a win-back offer.`;
  if (segment === "Loyal") return `${customer.name} is a high-value loyalty member. Keep checkout recognition fast.`;
  if (segment === "New") return `${customer.name} is early in the relationship. Capture preferences during the next sale.`;
  return `${customer.name} has repeat purchase history. Review recent orders before recommending add-ons.`;
}

function toCustomerView(summary: CustomerSummary): CustomerView {
  const segment = segmentFor(summary);
  return {
    id: summary.customer.id,
    name: summary.customer.name,
    email: summary.customer.email,
    phone: summary.customer.phone,
    visits: summary.visits,
    spendCents: summary.totalSpentCents,
    avgOrderCents: summary.avgOrderCents,
    segment,
    loyaltyPoints: summary.customer.points,
    lastVisitAt: summary.lastVisitAt,
    recentOrders: summary.recentOrders,
    notes: noteFor(summary.customer, segment),
  };
}

function formatLastVisit(timestamp: number | null) {
  if (timestamp === null) return "No visits";
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function formatOrderDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<SegmentFilter>("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [form, setForm] = useState<NewCustomerForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function setField<K extends keyof NewCustomerForm>(key: K, value: NewCustomerForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreateCustomer(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const isRetail = form.customerType === "retail";
      const payload: Record<string, unknown> = {
        name: isRetail ? form.name.trim() : form.contactPerson.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        customerType: form.customerType,
        notes: form.notes.trim() || null,
      };
      if (isRetail) {
        if (form.dateOfBirthStr) {
          payload.dateOfBirth = new Date(form.dateOfBirthStr).getTime();
        }
      } else {
        payload.company = form.company.trim();
        payload.contactPerson = form.contactPerson.trim();
        payload.dba = form.dba.trim() || null;
        payload.taxId = form.taxId.trim() || null;
        payload.licenseNo = form.licenseNo.trim() || null;
        payload.state = form.state.trim() || null;
        payload.billingAddress = form.billingAddress.trim() || null;
        payload.shippingAddress = form.shippingAddress.trim() || null;
        payload.salesRepId = form.salesRepId.trim() || null;
        payload.tier = Number(form.tier) || 5;
        if (form.creditLimitDollars) {
          payload.creditLimitCents = Math.round(parseFloat(form.creditLimitDollars) * 100);
        }
      }
      await apiPost("/api/v1/customers", payload);
      setShowNewCustomer(false);
      setForm(emptyForm());
      // Reload the customer list
      const data = await apiGet<CustomersResponse>("/api/v1/customers");
      const summaries = await Promise.all(
        data.items.map(async (customer) => {
          try { return await apiGet<CustomerSummary>(`/api/v1/customers/${customer.id}/summary`); }
          catch { return fallbackSummary(customer); }
        })
      );
      const next = summaries.map(toCustomerView);
      setCustomers(next);
      setSelectedId(next[0]?.id ?? null);
    } catch (err) {
      setSaveError(err instanceof ApiResponseError ? err.message : "Failed to create customer.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    apiGet<CustomersResponse>("/api/v1/customers", { signal: controller.signal })
      .then(async (data) => {
        const summaries = await Promise.all(
          data.items.map(async (customer) => {
            try {
              return await apiGet<CustomerSummary>(`/api/v1/customers/${customer.id}/summary`, {
                signal: controller.signal,
              });
            } catch {
              return fallbackSummary(customer);
            }
          })
        );
        if (controller.signal.aborted) return;
        const nextCustomers = summaries.map(toCustomerView);
        setCustomers(nextCustomers);
        setSelectedId((current) =>
          current && nextCustomers.some((customer) => customer.id === current)
            ? current
            : nextCustomers[0]?.id ?? null
        );
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiResponseError ? err.message : "Could not load customers.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesQuery =
        q.length === 0 ||
        customer.name.toLowerCase().includes(q) ||
        (customer.email ?? "").toLowerCase().includes(q) ||
        (customer.phone ?? "").toLowerCase().includes(q);
      const matchesSegment = segment === "All" || customer.segment === segment;
      return matchesQuery && matchesSegment;
    });
  }, [customers, query, segment]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedId) ?? filteredCustomers[0] ?? null,
    [selectedId, filteredCustomers, customers]
  );

  const metrics = useMemo(() => {
    const totalSpend = customers.reduce((sum, customer) => sum + customer.spendCents, 0);
    const loyalty = customers.filter((customer) => customer.loyaltyPoints > 0).length;
    const repeat = customers.filter((customer) => customer.visits > 1).length;
    const count = customers.length || 1;
    return {
      profiles: customers.length,
      loyaltyPct: Math.round((loyalty / count) * 100),
      repeatPct: Math.round((repeat / count) * 100),
      avgValue: Math.round(totalSpend / count),
    };
  }, [customers]);

  return (
    <EnterpriseShell
      active="customers"
      title="Customers"
      subtitle="Profiles · loyalty · purchase history"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Metric label="Profiles" value={String(metrics.profiles)} detail="customer records" />
          <Metric label="Loyalty members" value={`${metrics.loyaltyPct}%`} detail="of active profiles" />
          <Metric label="Repeat rate" value={`${metrics.repeatPct}%`} detail="more than one visit" />
          <Metric label="Avg customer value" value={formatMoney(metrics.avgValue)} detail="lifetime spend" />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Customer directory</h2>
                <p className="text-sm text-slate-500">Fast lookup for returns, loyalty, and clienteling.</p>
              </div>
              <Button variant="primary" size="sm" onClick={() => { setForm(emptyForm()); setShowNewCustomer(true); }}>Add customer</Button>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:grid-cols-[minmax(16rem,1fr)_12rem]">
              <label>
                <span className="sr-only">Search customers</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, email, or phone"
                  className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
                />
              </label>
              <label>
                <span className="sr-only">Filter by segment</span>
                <select
                  value={segment}
                  onChange={(event) => setSegment(event.target.value as SegmentFilter)}
                  className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
                >
                  <option value="All">All segments</option>
                  <option value="Loyal">Loyal</option>
                  <option value="Regular">Regular</option>
                  <option value="New">New</option>
                  <option value="At risk">At risk</option>
                </select>
              </label>
            </div>

            {loading ? (
              <div className="p-6 text-sm text-slate-500" aria-busy="true">Loading customers...</div>
            ) : error ? (
              <div className="p-6 text-sm text-danger-700" role="alert">{error}</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No customers match the current filters.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filteredCustomers.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(customer.id)}
                      className={`grid w-full gap-3 px-4 py-4 text-left transition-colors md:grid-cols-[1fr_auto_auto_auto] md:items-center ${
                        selectedCustomer?.id === customer.id ? "bg-slate-100" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-950">{customer.name}</p>
                        <p className="truncate text-sm text-slate-500">{customer.email ?? "No email"}</p>
                      </div>
                      <span className="text-sm text-slate-600">{customer.visits} visits</span>
                      <span className="text-sm font-semibold text-slate-950">{formatMoney(customer.spendCents)}</span>
                      <SegmentBadge segment={customer.segment} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex h-fit flex-col gap-5">
            {selectedCustomer ? (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Selected customer</p>
                  <h2 className="mt-1 text-xl font-bold text-slate-950">{selectedCustomer.name}</h2>
                  <p className="text-sm text-slate-500">{selectedCustomer.email ?? "No email on file"}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Detail label="Spend" value={formatMoney(selectedCustomer.spendCents)} />
                  <Detail label="Visits" value={String(selectedCustomer.visits)} />
                  <Detail label="Points" value={String(selectedCustomer.loyaltyPoints)} />
                  <Detail label="Last visit" value={formatLastVisit(selectedCustomer.lastVisitAt)} compact />
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Phone</span>
                    <span className="font-semibold text-slate-950">{selectedCustomer.phone ?? "No phone"}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-slate-500">Average order</span>
                    <span className="font-semibold text-slate-950">{formatMoney(selectedCustomer.avgOrderCents)}</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-950">Recent purchases</h3>
                  {selectedCustomer.recentOrders.length === 0 ? (
                    <div className="mt-2 rounded-md border border-slate-200 px-3 py-4 text-sm text-slate-500">
                      No completed orders yet.
                    </div>
                  ) : (
                    <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
                      {selectedCustomer.recentOrders.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-950">{item.orderNumber}</span>
                            <span className="block text-xs capitalize text-slate-500">
                              {item.status} · {formatOrderDate(item.createdAt)}
                            </span>
                          </span>
                          <span className="font-semibold text-slate-950">{formatMoney(item.totalCents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-100 p-4">
                  <h3 className="text-sm font-semibold text-slate-950">Clienteling note</h3>
                  <p className="mt-1 text-sm text-slate-700">{selectedCustomer.notes}</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" fullWidth>Edit profile</Button>
                  <Button variant="primary" size="sm" fullWidth>Add to sale</Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Select a customer to inspect profile details.</p>
            )}
          </Card>
        </div>

        <Card className="grid gap-4 lg:grid-cols-[1fr_18rem] lg:items-center">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Customer display</h2>
            <p className="mt-1 text-sm text-slate-500">
              Register 01 is ready for a customer-facing display with cart mirror, loyalty capture, and receipt opt-in.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <DisplayStatus label="Status" value="Connected" />
            <DisplayStatus label="Mode" value="Cart mirror" />
          </div>
        </Card>
      </div>
      <Modal
        open={showNewCustomer}
        onClose={() => setShowNewCustomer(false)}
        title="New Customer"
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-3">
            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowNewCustomer(false)}>Cancel</Button>
              <Button type="submit" form="new-customer-form" variant="primary" size="sm" disabled={saving}>
                {saving ? "Creating..." : "Create customer"}
              </Button>
            </div>
          </div>
        }
      >
        <form id="new-customer-form" onSubmit={handleCreateCustomer} className="flex flex-col gap-5">
          {/* Type selector */}
          <div className="flex gap-2 rounded-lg border border-slate-200 p-1 bg-slate-50">
            {(["retail", "business"] as CustomerType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setField("customerType", t)}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors capitalize ${
                  form.customerType === t
                    ? "bg-white shadow-sm text-slate-950 ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t === "retail" ? "Retail Customer" : "Business Account"}
              </button>
            ))}
          </div>

          {form.customerType === "retail" ? (
            /* ── RETAIL TEMPLATE ── */
            <div className="grid gap-4">
              <p className="text-xs font-semibold uppercase text-slate-400 tracking-wide">Customer details</p>
              <FormField label="Full name" required>
                <input type="text" value={form.name} onChange={(e) => setField("name", e.target.value)}
                  required placeholder="Ada Lovelace"
                  className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Phone" hint="Required for loyalty">
                  <input type="tel" value={form.phone} onChange={(e) => setField("phone", e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
                <FormField label="Email">
                  <input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)}
                    placeholder="ada@example.com"
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
              </div>
              <FormField label="Date of birth" hint="Optional — used for age verification and birthday rewards">
                <input type="date" value={form.dateOfBirthStr} onChange={(e) => setField("dateOfBirthStr", e.target.value)}
                  className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
              </FormField>
              <FormField label="Notes">
                <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)}
                  rows={2} placeholder="Preferences, allergies, or other notes"
                  className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700 resize-none" />
              </FormField>
            </div>
          ) : (
            /* ── BUSINESS TEMPLATE ── */
            <div className="grid gap-4">
              <p className="text-xs font-semibold uppercase text-slate-400 tracking-wide">Company information</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Company name" required>
                  <input type="text" value={form.company} onChange={(e) => setField("company", e.target.value)}
                    required placeholder="Acme Corp"
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
                <FormField label="DBA (doing business as)" hint="Optional">
                  <input type="text" value={form.dba} onChange={(e) => setField("dba", e.target.value)}
                    placeholder="Acme Retail"
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Tax ID / EIN" required>
                  <input type="text" value={form.taxId} onChange={(e) => setField("taxId", e.target.value)}
                    required placeholder="12-3456789"
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
                <FormField label="License no." hint="Optional">
                  <input type="text" value={form.licenseNo} onChange={(e) => setField("licenseNo", e.target.value)}
                    placeholder="LIC-0001"
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="State" required>
                  <input type="text" value={form.state} onChange={(e) => setField("state", e.target.value)}
                    required maxLength={2} placeholder="CA"
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
                <FormField label="Payment tier (1–5)" hint="1=VIP, 5=standard">
                  <select value={form.tier} onChange={(e) => setField("tier", e.target.value)}
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700">
                    {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </FormField>
              </div>

              <p className="text-xs font-semibold uppercase text-slate-400 tracking-wide mt-1">Primary contact</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Contact person" required>
                  <input type="text" value={form.contactPerson} onChange={(e) => setField("contactPerson", e.target.value)}
                    required placeholder="Jane Smith"
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
                <FormField label="Phone" required>
                  <input type="tel" value={form.phone} onChange={(e) => setField("phone", e.target.value)}
                    required placeholder="+1 (555) 000-0000"
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
              </div>
              <FormField label="Email">
                <input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)}
                  placeholder="billing@acmecorp.com"
                  className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
              </FormField>

              <p className="text-xs font-semibold uppercase text-slate-400 tracking-wide mt-1">Addresses</p>
              <FormField label="Billing address" required>
                <textarea value={form.billingAddress} onChange={(e) => setField("billingAddress", e.target.value)}
                  required rows={2} placeholder="123 Main St, Suite 100, Los Angeles, CA 90001"
                  className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700 resize-none" />
              </FormField>
              <FormField label="Shipping address" hint="Leave blank to use billing address">
                <textarea value={form.shippingAddress} onChange={(e) => setField("shippingAddress", e.target.value)}
                  rows={2} placeholder="Same as billing"
                  className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700 resize-none" />
              </FormField>

              <p className="text-xs font-semibold uppercase text-slate-400 tracking-wide mt-1">Account settings</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Credit limit ($)" hint="Optional — leave blank for prepay only">
                  <input type="number" value={form.creditLimitDollars} onChange={(e) => setField("creditLimitDollars", e.target.value)}
                    min="0" step="0.01" placeholder="0.00"
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
                <FormField label="Sales rep ID" hint="Optional">
                  <input type="text" value={form.salesRepId} onChange={(e) => setField("salesRepId", e.target.value)}
                    placeholder="rep_..."
                    className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700" />
                </FormField>
              </div>
              <FormField label="Notes">
                <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)}
                  rows={2} placeholder="Account notes, special terms, or reminders"
                  className="form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700 resize-none" />
              </FormField>
            </div>
          )}
        </form>
      </Modal>
    </EnterpriseShell>
  );
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-slate-700">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
        {hint && <span className="ml-1 text-xs font-normal text-slate-400">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase text-slate-500">{label}</span>
      <span className="text-2xl font-bold text-slate-950">{value}</span>
      <span className="text-xs text-slate-500">{detail}</span>
    </Card>
  );
}

function Detail({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className={compact ? "mt-1 text-sm font-bold text-slate-950" : "mt-1 text-lg font-bold text-slate-950"}>
        {value}
      </p>
    </div>
  );
}

function SegmentBadge({ segment }: { segment: Segment }) {
  const classes =
    segment === "At risk"
      ? "bg-warning-100 text-warning-700"
      : segment === "Loyal"
      ? "bg-success-100 text-success-700"
      : segment === "New"
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex w-fit rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${classes}`}>
      {segment}
    </span>
  );
}

function DisplayStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-950">{value}</p>
    </div>
  );
}
