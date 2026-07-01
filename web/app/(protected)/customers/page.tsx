"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, invalidateQuery } from "@/lib/useQuery";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { TableSkeleton } from "@/components/TableSkeleton";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import type {
  CustomerSummary,
  CustomersResponse,
  RetailCustomer,
} from "@/api-client/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type CustomerType = "retail" | "business";

interface NewCustomerForm {
  customerType: CustomerType;
  name: string;
  email: string;
  phone: string;
  notes: string;
  dateOfBirthStr: string;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#F97316", "#EAB308", "#8B5CF6", "#10B981", "#EC4899", "#3B82F6"];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

function customerCode(id: string, name: string): string {
  const slug = (name.split(" ")[0] ?? "Customer").replace(/[^a-zA-Z]/g, "");
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `${slug}-${String(Math.abs(h) % 10000).padStart(4, "0")}`;
}

function fallbackSummary(customer: RetailCustomer): CustomerSummary {
  return { customer, visits: 0, totalSpentCents: 0, avgOrderCents: 0, lastVisitAt: null, recentOrders: [] };
}

function segmentFor(summary: CustomerSummary): Segment {
  const days = summary.lastVisitAt === null ? Infinity : (Date.now() - summary.lastVisitAt) / 86_400_000;
  if (days > 30 && summary.visits > 1) return "At risk";
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<SegmentFilter>("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
        if (form.dateOfBirthStr) payload.dateOfBirth = new Date(form.dateOfBirthStr).getTime();
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
        if (form.creditLimitDollars) payload.creditLimitCents = Math.round(parseFloat(form.creditLimitDollars) * 100);
      }
      await apiPost("/api/v1/customers", payload);
      setShowNewCustomer(false);
      setForm(emptyForm());
      invalidateQuery("customers:list");
    } catch (err) {
      setSaveError(err instanceof ApiResponseError ? err.message : "Failed to create customer.");
    } finally {
      setSaving(false);
    }
  }

  async function fetchCustomerList(): Promise<CustomerView[]> {
    const data = await apiGet<CustomersResponse>("/api/v1/customers");
    const summaries = await Promise.all(
      data.items.map(async (customer) => {
        try { return await apiGet<CustomerSummary>(`/api/v1/customers/${customer.id}/summary`); }
        catch { return fallbackSummary(customer); }
      })
    );
    return summaries.map(toCustomerView);
  }

  const { data: customersData, loading, error } =
    useQuery<CustomerView[]>("customers:list", fetchCustomerList, { staleMs: 60_000 });
  const customers = useMemo(() => customersData ?? [], [customersData]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      const code = customerCode(c.id, c.name).toLowerCase();
      const matchQ = !q ||
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        code.includes(q);
      const matchGroup = groupFilter === "All" || c.segment === groupFilter;
      return matchQ && matchGroup;
    });
  }, [customers, query, groupFilter]);

  return (
    <EnterpriseShell
      active="customers"
      title="Customers"
      subtitle="Profiles · loyalty · purchase history"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6">

        {/* Page header */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-[#5D5FEF] px-4 py-2 text-sm font-semibold text-[#5D5FEF] transition-colors hover:bg-[#5D5FEF]/5"
          >
            Import customers
          </button>
          <button
            type="button"
            onClick={() => { setForm(emptyForm()); setShowNewCustomer(true); }}
            className="rounded-md bg-[#5D5FEF] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0]"
          >
            Add customer
          </button>
        </div>

        {/* Filter bar */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end gap-3 px-4 py-4">
            <div className="min-w-[180px] flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Search by name / code / contact
              </label>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, phone, or code…"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-[#5D5FEF] focus:ring-1 focus:ring-[#5D5FEF]"
              />
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-slate-500">Customer group</label>
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value as SegmentFilter)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-[#5D5FEF] focus:ring-1 focus:ring-[#5D5FEF]"
              >
                <option value="All">All groups</option>
                <option value="Loyal">Loyal</option>
                <option value="Regular">Regular</option>
                <option value="New">New</option>
                <option value="At risk">At risk</option>
              </select>
            </div>
            <div className="ml-auto flex items-center gap-4 pb-0.5">
              <button
                type="button"
                onClick={() => { setQuery(""); setGroupFilter("All"); }}
                className="text-sm text-[#5D5FEF] hover:underline"
              >
                Clear filters
              </button>
              <button type="button" className="text-sm text-slate-500 hover:text-slate-700">
                More filters
              </button>
              <button
                type="button"
                className="rounded-md bg-[#5D5FEF] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0]"
              >
                Search
              </button>
            </div>
          </div>
        </div>

        {/* Table card */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {/* Top strip */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm text-slate-500">{visible.length} customers</span>
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export
            </button>
          </div>

          {loading ? (
            <TableSkeleton headers={["Customer", "Loyalty", "Account", ""]} rows={8} />
          ) : error ? (
            <div className="p-6 text-sm text-red-600" role="alert">{error}</div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-[#111]">No customers found.</p>
              <p className="mt-1 text-sm text-[#666]">Try clearing the filters or add a new customer.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" className="rounded border-slate-300" aria-label="Select all" />
                  </th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Loyalty</th>
                  <th className="px-4 py-3 text-left">Account</th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((c) => (
                  <Fragment key={c.id}>
                    <tr
                      className="cursor-pointer hover:bg-[#FAFAFA]"
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="rounded border-slate-300"
                          aria-label={`Select ${c.name}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                            style={{ backgroundColor: avatarColor(c.name) }}
                          >
                            {avatarInitials(c.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[#111]">{c.name}</span>
                              <GroupBadge segment={c.segment} />
                            </div>
                            <div className="mt-0.5 text-xs text-[#666]">
                              {customerCode(c.id, c.name)}{c.phone ? ` | ${c.phone}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-[#111]">{c.loyaltyPoints.toLocaleString()}</span>
                        <span className="ml-1 text-xs text-[#666]">pts</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-[#111]">{formatMoney(c.spendCents)}</span>
                        <span className="ml-1 text-xs text-[#666]">lifetime</span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`Edit ${c.name}`}
                          className="text-slate-400 hover:text-[#5D5FEF]"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      </td>
                    </tr>

                    {expandedId === c.id && (
                      <tr>
                        <td colSpan={5} className="p-0">
                          <CustomerDetailPanel customer={c} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Add Customer Modal ─────────────────────────────────────────────── */}
      <Modal
        open={showNewCustomer}
        onClose={() => setShowNewCustomer(false)}
        title="New Customer"
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-3">
            {saveError && <p role="alert" className="text-sm text-red-600">{saveError}</p>}
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

// ─── Customer detail expandable panel ─────────────────────────────────────────

type DetailTab = "details" | "loyalty" | "account" | "notes";

function CustomerDetailPanel({ customer }: { customer: CustomerView }) {
  const [tab, setTab] = useState<DetailTab>("details");

  return (
    <div className="bg-[#1a1a1a] text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-6">
        <div className="flex">
          {(["details", "loyalty", "account", "notes"] as DetailTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={(e) => { e.stopPropagation(); setTab(t); }}
              className={`px-4 py-3 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "border-b-2 border-[#5D5FEF] text-white"
                  : "text-white/50 hover:text-white/75"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="my-2 rounded-md bg-[#5D5FEF] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0]"
        >
          Edit customer
        </button>
      </div>

      <div className="px-6 py-5" onClick={(e) => e.stopPropagation()}>
        {tab === "details" && <DetailsTab customer={customer} />}
        {tab === "loyalty" && <LoyaltyTab customer={customer} />}
        {tab === "account" && <AccountTab customer={customer} />}
        {tab === "notes" && <NotesTab customer={customer} />}
      </div>
    </div>
  );
}

function DetailsTab({ customer }: { customer: CustomerView }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <PanelField label="Email" value={customer.email ?? "—"} />
      <PanelField label="Phone" value={customer.phone ?? "—"} />
      <PanelField label="Avg order" value={formatMoney(customer.avgOrderCents)} />
      <PanelField label="Last visit" value={formatLastVisit(customer.lastVisitAt)} />
    </div>
  );
}

function LoyaltyTab({ customer }: { customer: CustomerView }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="text-3xl font-bold text-white">{customer.loyaltyPoints.toLocaleString()}</span>
        <span className="ml-2 text-sm text-white/50">points</span>
      </div>
      {customer.recentOrders.length === 0 ? (
        <p className="text-sm text-white/50">No purchase history yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-white/40">
              <th className="pb-2 font-medium">Order</th>
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 text-right font-medium">Total</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {customer.recentOrders.map((o) => (
              <tr key={o.id}>
                <td className="py-2 font-mono text-xs text-white/80">{o.orderNumber}</td>
                <td className="py-2 text-white/60">{formatOrderDate(o.createdAt)}</td>
                <td className="py-2 text-right font-semibold text-white">{formatMoney(o.totalCents)}</td>
                <td className="py-2 capitalize text-white/60">{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AccountTab({ customer }: { customer: CustomerView }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md bg-white/5 p-4">
          <p className="text-xs font-medium uppercase text-white/40">Lifetime spend</p>
          <p className="mt-1 text-2xl font-bold text-white">{formatMoney(customer.spendCents)}</p>
          <p className="mt-0.5 text-xs text-white/40">{customer.visits} visits</p>
        </div>
        <div className="rounded-md bg-white/5 p-4">
          <p className="text-xs font-medium uppercase text-white/40">Average order</p>
          <p className="mt-1 text-2xl font-bold text-white">{formatMoney(customer.avgOrderCents)}</p>
        </div>
      </div>
      <div className="rounded-md bg-white p-1">
        <StoreCreditPanel customerId={customer.id} />
      </div>
    </div>
  );
}

function NotesTab({ customer }: { customer: CustomerView }) {
  return (
    <p className="max-w-2xl text-sm leading-relaxed text-white/70">{customer.notes}</p>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GroupBadge({ segment }: { segment: Segment }) {
  const color =
    segment === "Loyal" ? "border-emerald-500 text-emerald-400" :
    segment === "New" ? "border-blue-500 text-blue-400" :
    segment === "At risk" ? "border-amber-500 text-amber-400" :
    "border-slate-400 text-slate-400";
  return (
    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {segment}
    </span>
  );
}

function FormField({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
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

function PanelField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-white/40">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

// ─── FE-45: Store Credit Panel ────────────────────────────────────────────────

function StoreCreditPanel({ customerId }: { customerId: string }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"add" | "deduct">("add");

  useEffect(() => {
    setLoading(true);
    apiGet<{ balanceCents: number }>(`/api/v1/customers/${customerId}/store-credit`)
      .then((r) => setBalance(r.balanceCents))
      .catch(() => setBalance(0))
      .finally(() => setLoading(false));
  }, [customerId]);

  const handleAdjust = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!cents || cents <= 0) { setError("Enter a positive amount."); return; }
    if (!reason.trim()) { setError("Reason is required."); return; }
    setAdjusting(true);
    setError(null);
    try {
      const delta = mode === "add" ? cents : -cents;
      const result = await apiPost<{ balanceCents: number }>(
        `/api/v1/customers/${customerId}/store-credit`,
        { deltaCents: delta, reason: reason.trim() },
      );
      setBalance(result.balanceCents);
      setAmount("");
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjustment failed.");
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="rounded-md bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Store Credit</h3>
        {loading ? (
          <div className="h-5 w-20 animate-pulse rounded bg-gray-200" />
        ) : (
          <span className="text-lg font-bold text-emerald-600">{formatMoney(balance ?? 0)}</span>
        )}
      </div>
      <div className="mt-3 flex gap-1.5">
        {(["add", "deduct"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold capitalize transition-colors ${
              mode === m ? "bg-[#5D5FEF] text-white" : "border border-slate-200 text-slate-600 hover:bg-gray-50"
            }`}
          >
            {m === "add" ? "Add credit" : "Deduct"}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-2">
        <input
          type="number" min="0.01" step="0.01" placeholder="Amount ($)"
          value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }}
          className="w-full rounded border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-[#5D5FEF]"
        />
        <input
          type="text" placeholder="Reason (required)"
          value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }}
          className="w-full rounded border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-[#5D5FEF]"
        />
        {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        <button
          type="button" disabled={adjusting || !amount || !reason} onClick={handleAdjust}
          className="w-full rounded-md bg-[#5D5FEF] py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0] disabled:opacity-40"
        >
          {adjusting ? "Applying…" : mode === "add" ? "Add Credit" : "Deduct Credit"}
        </button>
      </div>
    </div>
  );
}
