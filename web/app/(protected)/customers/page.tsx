"use client";

import { useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney } from "@/lib/money";
import { apiGet, ApiResponseError } from "@/api-client/client";
import type {
  CustomerSummary,
  CustomersResponse,
  RetailCustomer,
} from "@/api-client/types";

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
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Customer directory</h2>
                <p className="text-sm text-gray-500">Fast lookup for returns, loyalty, and clienteling.</p>
              </div>
              <Button variant="primary" size="sm">Add customer</Button>
            </div>

            <div className="grid gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 lg:grid-cols-[minmax(16rem,1fr)_12rem]">
              <label>
                <span className="sr-only">Search customers</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, email, or phone"
                  className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
                />
              </label>
              <label>
                <span className="sr-only">Filter by segment</span>
                <select
                  value={segment}
                  onChange={(event) => setSegment(event.target.value as SegmentFilter)}
                  className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
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
              <div className="p-6 text-sm text-gray-500" aria-busy="true">Loading customers...</div>
            ) : error ? (
              <div className="p-6 text-sm text-danger-700" role="alert">{error}</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No customers match the current filters.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredCustomers.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(customer.id)}
                      className={`grid w-full gap-3 px-4 py-4 text-left transition-colors md:grid-cols-[1fr_auto_auto_auto] md:items-center ${
                        selectedCustomer?.id === customer.id ? "bg-brand-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900">{customer.name}</p>
                        <p className="truncate text-sm text-gray-500">{customer.email ?? "No email"}</p>
                      </div>
                      <span className="text-sm text-gray-600">{customer.visits} visits</span>
                      <span className="text-sm font-semibold text-gray-900">{formatMoney(customer.spendCents)}</span>
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
                  <p className="text-xs font-semibold uppercase text-gray-500">Selected customer</p>
                  <h2 className="mt-1 text-xl font-bold text-gray-900">{selectedCustomer.name}</h2>
                  <p className="text-sm text-gray-500">{selectedCustomer.email ?? "No email on file"}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Detail label="Spend" value={formatMoney(selectedCustomer.spendCents)} />
                  <Detail label="Visits" value={String(selectedCustomer.visits)} />
                  <Detail label="Points" value={String(selectedCustomer.loyaltyPoints)} />
                  <Detail label="Last visit" value={formatLastVisit(selectedCustomer.lastVisitAt)} compact />
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">Phone</span>
                    <span className="font-semibold text-gray-900">{selectedCustomer.phone ?? "No phone"}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-gray-500">Average order</span>
                    <span className="font-semibold text-gray-900">{formatMoney(selectedCustomer.avgOrderCents)}</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Recent purchases</h3>
                  {selectedCustomer.recentOrders.length === 0 ? (
                    <div className="mt-2 rounded-lg border border-gray-200 px-3 py-4 text-sm text-gray-500">
                      No completed orders yet.
                    </div>
                  ) : (
                    <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
                      {selectedCustomer.recentOrders.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-gray-900">{item.orderNumber}</span>
                            <span className="block text-xs capitalize text-gray-500">
                              {item.status} · {formatOrderDate(item.createdAt)}
                            </span>
                          </span>
                          <span className="font-semibold text-gray-900">{formatMoney(item.totalCents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
                  <h3 className="text-sm font-semibold text-brand-900">Clienteling note</h3>
                  <p className="mt-1 text-sm text-brand-800">{selectedCustomer.notes}</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" fullWidth>Edit profile</Button>
                  <Button variant="primary" size="sm" fullWidth>Add to sale</Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">Select a customer to inspect profile details.</p>
            )}
          </Card>
        </div>

        <Card className="grid gap-4 lg:grid-cols-[1fr_18rem] lg:items-center">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Customer display</h2>
            <p className="mt-1 text-sm text-gray-500">
              Register 01 is ready for a customer-facing display with cart mirror, loyalty capture, and receipt opt-in.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <DisplayStatus label="Status" value="Connected" />
            <DisplayStatus label="Mode" value="Cart mirror" />
          </div>
        </Card>
      </div>
    </EnterpriseShell>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase text-gray-500">{label}</span>
      <span className="text-2xl font-bold text-gray-900">{value}</span>
      <span className="text-xs text-gray-500">{detail}</span>
    </Card>
  );
}

function Detail({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className={compact ? "mt-1 text-sm font-bold text-gray-900" : "mt-1 text-lg font-bold text-gray-900"}>
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
      ? "bg-brand-100 text-brand-700"
      : "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex w-fit rounded px-2 py-1 text-xs font-semibold ${classes}`}>
      {segment}
    </span>
  );
}

function DisplayStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-1 font-semibold text-gray-900">{value}</p>
    </div>
  );
}
