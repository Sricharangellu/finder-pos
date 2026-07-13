"use client";

import { useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost, safeLoad } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import { Can } from "@/components/rbac";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "price-books" | "customer-overrides" | "tier" | "contracts" | "scheduled" | "margin-rules" | "simulator";

interface PriceBook {
  id: string;
  name: string;
  type: "retail" | "wholesale" | "location" | "marketplace" | "customer-group";
  currency: string;
  productCount: number;
  active: boolean;
  description?: string;
}

interface TierRule {
  id: string;
  name: string;
  productId?: string;
  productName?: string;
  categoryId?: string;
  categoryName?: string;
  scope: "product" | "category" | "all";
  tiers: Array<{ minQty: number; discountPct: number }>;
  customerGroup?: string;
  active: boolean;
}

interface ContractPrice {
  id: string;
  contractNumber: string;
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  sku: string;
  retailCents: number;
  contractCents: number;
  effectiveDate: number;
  expiryDate: number;
  status: "active" | "pending" | "expired";
  approvedBy?: string;
}

interface ScheduledPrice {
  id: string;
  name: string;
  productId: string;
  productName: string;
  sku: string;
  originalCents: number;
  scheduledCents: number;
  startAt: number;
  endAt: number;
  status: "upcoming" | "active" | "ended";
  approvalRequired: boolean;
  approvedBy?: string;
}

interface MarginRule {
  id: string;
  name: string;
  scope: "global" | "category" | "product";
  categoryName?: string;
  productName?: string;
  minMarginPct: number;
  action: "block" | "warn" | "approve";
  active: boolean;
}

interface SimulatorResult {
  finalCents: number;
  source: string;
  steps: Array<{ priority: number; rule: string; price: number; applied: boolean }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "price-books",        label: "Price Books" },
  { key: "customer-overrides", label: "Customer Overrides" },
  { key: "tier",               label: "Tier Pricing" },
  { key: "contracts",          label: "Contract Prices" },
  { key: "scheduled",          label: "Scheduled" },
  { key: "margin-rules",       label: "Margin Rules" },
  { key: "simulator",          label: "Simulator" },
];

const BOOK_TYPE_LABEL: Record<PriceBook["type"], string> = {
  retail:         "Retail",
  wholesale:      "Wholesale",
  location:       "Location",
  marketplace:    "Marketplace",
  "customer-group": "Customer Group",
};

const BOOK_TYPE_CLS: Record<PriceBook["type"], string> = {
  retail:         "bg-blue-100 text-blue-700",
  wholesale:      "bg-purple-100 text-purple-700",
  location:       "bg-teal-100 text-teal-700",
  marketplace:    "bg-orange-100 text-orange-700",
  "customer-group": "bg-indigo-100 text-indigo-700",
};

const CONTRACT_STATUS_CLS: Record<ContractPrice["status"], string> = {
  active:  "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  expired: "bg-slate-100 text-slate-500",
};

const SCHED_STATUS_CLS: Record<ScheduledPrice["status"], string> = {
  upcoming: "bg-blue-100 text-blue-700",
  active:   "bg-emerald-100 text-emerald-700",
  ended:    "bg-slate-100 text-slate-500",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {action}
    </div>
  );
}

function TableShell({ cols, children, empty }: { cols: string[]; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
          <tr>{cols.map(c => <th key={c} className="px-5 py-3">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {empty
            ? <tr><td colSpan={cols.length} className="py-12 text-center text-sm text-slate-400">No records found.</td></tr>
            : children}
        </tbody>
      </table>
    </div>
  );
}

// ── Price Books Tab ───────────────────────────────────────────────────────────

function PriceBooksTab() {
  const [books, setBooks]   = useState<PriceBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: PriceBook[] }>("/api/v1/pricing/price-books").then(r => {
      setBooks(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="space-y-4">
      <SectionHeader
        title={`${books.length} price books`}
        action={
          <Can permission="pricing.manage">
            <button className="rounded-lg bg-[#5D5FEF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
              + New Price Book
            </button>
          </Can>
        }
      />
      <TableShell cols={["Name", "Type", "Products", "Currency", "Status", ""]} empty={books.length === 0}>
        {books.map(b => (
          <tr key={b.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-5 py-3.5">
              <p className="font-semibold text-slate-900">{b.name}</p>
              {b.description && <p className="text-xs text-slate-400">{b.description}</p>}
            </td>
            <td className="px-5 py-3.5">
              <Badge label={BOOK_TYPE_LABEL[b.type]} cls={BOOK_TYPE_CLS[b.type]} />
            </td>
            <td className="px-5 py-3.5 text-slate-600">{b.productCount.toLocaleString()}</td>
            <td className="px-5 py-3.5 text-slate-600">{b.currency}</td>
            <td className="px-5 py-3.5">
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${b.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {b.active ? "Active" : "Inactive"}
              </span>
            </td>
            <td className="px-5 py-3.5">
              <Can permission="pricing.manage">
                <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Edit
                </button>
              </Can>
            </td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}

// ── Customer Overrides Tab ────────────────────────────────────────────────────
// Folded in from the old /catalog/price-book page (FE-47): per-customer price
// overrides via /customers/:id/product-prices. One pricing surface for all
// price management.

interface OverrideProduct { id: string; sku: string; name: string; price_cents: number; category: string; }
interface OverrideCustomer { id: string; name: string; email: string | null; }
interface PriceOverride { product_id: string; price_cents: number; updated_at: number; }

function CustomerOverridesTab() {
  const [products, setProducts] = useState<OverrideProduct[]>([]);
  const [customers, setCustomers] = useState<OverrideCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [editing, setEditing] = useState<{ productId: string; value: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: OverrideProduct[] }>("/api/v1/catalog?pageSize=200")
        .then((r) => setProducts(r.items ?? []))
        .finally(() => setLoading(false)),
    );
    safeLoad(
      apiGet<{ items: OverrideCustomer[] }>("/api/v1/customers?pageSize=200")
        .then((r) => setCustomers(r.items ?? [])),
    );
  }, []);

  useEffect(() => {
    if (!selectedCustomer) { setOverrides(new Map()); return; }
    safeLoad(
      apiGet<{ items: PriceOverride[] }>(`/api/v1/customers/${selectedCustomer}/product-prices`)
        .then((r) => {
          const map = new Map<string, number>();
          for (const o of r.items ?? []) map.set(o.product_id, o.price_cents);
          setOverrides(map);
        }),
    );
  }, [selectedCustomer]);

  const handleSave = async (productId: string) => {
    if (!selectedCustomer || !editing || editing.productId !== productId) return;
    const cents = Math.round(parseFloat(editing.value) * 100);
    if (isNaN(cents) || cents < 0) return;
    setSaving(true);
    try {
      await apiPost(`/api/v1/customers/${selectedCustomer}/product-prices`, { productId, priceCents: cents });
      setOverrides((prev) => new Map(prev).set(productId, cents));
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const filtered = products.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedCustomer}
          onChange={(e) => setSelectedCustomer(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#5D5FEF]"
          aria-label="Customer"
        >
          <option value="">Select customer to edit prices</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-48 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#5D5FEF]"
        />
        {!selectedCustomer && (
          <p className="text-xs text-slate-400">Select a customer to view and edit their custom prices.</p>
        )}
      </div>

      <TableShell cols={["SKU", "Product", "Category", "Standard", "Custom", "Discount", ""]} empty={!loading && filtered.length === 0}>
        {loading
          ? [1, 2, 3, 4, 5].map((i) => (
              <tr key={i}>
                {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                  <td key={j} className="px-5 py-3"><div className="h-4 animate-pulse rounded bg-slate-100" /></td>
                ))}
              </tr>
            ))
          : filtered.map((p) => {
              const override = overrides.get(p.id);
              const isEditing = editing?.productId === p.id;
              const discountPct = override && override < p.price_cents
                ? Math.round((1 - override / p.price_cents) * 100)
                : null;
              return (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.sku}</td>
                  <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                  <td className="px-5 py-3 capitalize text-slate-500">{p.category}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-500">{formatMoney(p.price_cents)}</td>
                  <td className="px-5 py-3 text-right">
                    {isEditing ? (
                      <input
                        type="number"
                        autoFocus
                        min="0"
                        step="0.01"
                        value={editing.value}
                        onChange={(e) => setEditing({ productId: p.id, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") void handleSave(p.id); if (e.key === "Escape") setEditing(null); }}
                        className="w-24 rounded border border-[#5D5FEF] px-2 py-0.5 text-right text-sm outline-none"
                        aria-label={`Custom price for ${p.name}`}
                      />
                    ) : (
                      <span className={`tabular-nums font-medium ${override ? "text-[#5D5FEF]" : "text-slate-400"}`}>
                        {override ? formatMoney(override) : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {discountPct !== null ? <span className="text-xs font-semibold text-emerald-600">-{discountPct}%</span> : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {selectedCustomer && (
                      isEditing ? (
                        <div className="flex justify-end gap-1">
                          <button disabled={saving} onClick={() => void handleSave(p.id)} className="rounded-lg bg-[#5D5FEF] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4B4DC8] disabled:opacity-40">Save</button>
                          <button onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                        </div>
                      ) : (
                        <Can permission="pricing.manage">
                          <button
                            onClick={() => setEditing({ productId: p.id, value: override ? (override / 100).toFixed(2) : (p.price_cents / 100).toFixed(2) })}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {override ? "Edit" : "Set"}
                          </button>
                        </Can>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
      </TableShell>
    </div>
  );
}

// ── Tier Pricing Tab ──────────────────────────────────────────────────────────

function TierPricingTab() {
  const [rules, setRules]   = useState<TierRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: TierRule[] }>("/api/v1/pricing/tier-rules").then(r => {
      setRules(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-3 text-sm text-blue-700">
        Tier pricing applies quantity-break discounts at checkout. Rules are evaluated per line item after contract and customer-group prices.
      </div>
      <SectionHeader
        title={`${rules.length} tier rules`}
        action={
          <Can permission="pricing.manage">
            <button className="rounded-lg bg-[#5D5FEF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
              + New Tier Rule
            </button>
          </Can>
        }
      />
      <div className="space-y-3">
        {rules.map(rule => (
          <div key={rule.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900">{rule.name}</p>
                  <Badge
                    label={rule.active ? "Active" : "Inactive"}
                    cls={rule.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}
                  />
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Scope: {rule.scope === "product" ? rule.productName : rule.scope === "category" ? rule.categoryName : "All products"}
                  {rule.customerGroup && ` · ${rule.customerGroup}`}
                </p>
              </div>
              <Can permission="pricing.manage">
                <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Edit
                </button>
              </Can>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {rule.tiers.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2">
                  <span className="text-xs text-slate-500">Qty ≥</span>
                  <span className="font-bold text-slate-900">{t.minQty}</span>
                  <span className="text-xs text-slate-400">→</span>
                  <span className="font-bold text-[#5D5FEF]">{t.discountPct}% off</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">No tier pricing rules configured.</p>
        )}
      </div>
    </div>
  );
}

// ── Contract Prices Tab ───────────────────────────────────────────────────────

function ContractPricesTab() {
  const [contracts, setContracts] = useState<ContractPrice[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState("");

  useEffect(() => {
    void apiGet<{ items: ContractPrice[] }>("/api/v1/pricing/contracts").then(r => {
      setContracts(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return contracts.filter(c => !q || c.customerName.toLowerCase().includes(q) || c.productName.toLowerCase().includes(q) || c.contractNumber.toLowerCase().includes(q));
  }, [contracts, search]);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search contracts..."
          className="h-9 w-64 rounded-lg border border-slate-200 px-3 text-sm focus:border-[#5D5FEF] focus:outline-none focus:ring-2 focus:ring-[#5D5FEF]/20"
        />
        <Can permission="pricing.manage">
          <button className="ml-auto rounded-lg bg-[#5D5FEF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + New Contract
          </button>
        </Can>
      </div>

      <TableShell
        cols={["Contract #", "Customer", "Product", "SKU", "Retail", "Contract", "Discount", "Effective", "Expires", "Status", ""]}
        empty={filtered.length === 0}
      >
        {filtered.map(c => {
          const discountPct = Math.round((1 - c.contractCents / c.retailCents) * 100);
          return (
            <tr key={c.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-5 py-3.5 font-semibold text-[#5D5FEF]">{c.contractNumber}</td>
              <td className="px-5 py-3.5 text-slate-900">{c.customerName}</td>
              <td className="px-5 py-3.5 text-slate-900">{c.productName}</td>
              <td className="px-5 py-3.5 font-mono text-xs text-slate-500">{c.sku}</td>
              <td className="px-5 py-3.5 text-slate-500 line-through">{formatMoney(c.retailCents)}</td>
              <td className="px-5 py-3.5 font-semibold text-emerald-700">{formatMoney(c.contractCents)}</td>
              <td className="px-5 py-3.5 text-[#5D5FEF] font-semibold">{discountPct}%</td>
              <td className="px-5 py-3.5 text-xs text-slate-500">{fmtDate(c.effectiveDate)}</td>
              <td className="px-5 py-3.5 text-xs text-slate-500">{fmtDate(c.expiryDate)}</td>
              <td className="px-5 py-3.5">
                <Badge label={c.status} cls={CONTRACT_STATUS_CLS[c.status]} />
              </td>
              <td className="px-5 py-3.5">
                <Can permission="pricing.manage">
                  <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Edit
                  </button>
                </Can>
              </td>
            </tr>
          );
        })}
      </TableShell>
    </div>
  );
}

// ── Scheduled Pricing Tab ─────────────────────────────────────────────────────

function ScheduledTab() {
  const [schedules, setSchedules] = useState<ScheduledPrice[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [filter, setFilter]       = useState<ScheduledPrice["status"] | "all">("all");

  useEffect(() => {
    void apiGet<{ items: ScheduledPrice[] }>("/api/v1/pricing/scheduled").then(r => {
      setSchedules(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  const filtered = useMemo(() =>
    filter === "all" ? schedules : schedules.filter(s => s.status === filter),
  [schedules, filter]);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-700">
        Scheduled prices override the retail base price during the window. Price changes above threshold require approval before activating.
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "upcoming", "active", "ended"] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
              filter === s ? "bg-[#5D5FEF] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {s === "all" ? "All" : s}
          </button>
        ))}
        <Can permission="pricing.manage">
          <button className="ml-auto rounded-lg bg-[#5D5FEF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + Schedule Price Change
          </button>
        </Can>
      </div>

      <TableShell
        cols={["Name", "Product", "SKU", "Original", "Scheduled", "Change", "Starts", "Ends", "Status", "Approved By", ""]}
        empty={filtered.length === 0}
      >
        {filtered.map(s => {
          const changePct = Math.round(((s.scheduledCents - s.originalCents) / s.originalCents) * 100);
          const isMarkdown = changePct < 0;
          return (
            <tr key={s.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-5 py-3.5 font-semibold text-slate-900">{s.name}</td>
              <td className="px-5 py-3.5 text-slate-700">{s.productName}</td>
              <td className="px-5 py-3.5 font-mono text-xs text-slate-500">{s.sku}</td>
              <td className="px-5 py-3.5 text-slate-500">{formatMoney(s.originalCents)}</td>
              <td className="px-5 py-3.5 font-semibold text-slate-900">{formatMoney(s.scheduledCents)}</td>
              <td className={`px-5 py-3.5 font-bold ${isMarkdown ? "text-emerald-600" : "text-red-600"}`}>
                {isMarkdown ? "" : "+"}{changePct}%
              </td>
              <td className="px-5 py-3.5 text-xs text-slate-500">{fmtDate(s.startAt)}</td>
              <td className="px-5 py-3.5 text-xs text-slate-500">{fmtDate(s.endAt)}</td>
              <td className="px-5 py-3.5">
                <Badge label={s.status} cls={SCHED_STATUS_CLS[s.status]} />
              </td>
              <td className="px-5 py-3.5 text-xs text-slate-500">
                {s.approvedBy ?? (s.approvalRequired ? <span className="text-amber-600 font-semibold">Pending</span> : "Auto")}
              </td>
              <td className="px-5 py-3.5">
                <Can permission="pricing.manage">
                  <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    {s.status === "upcoming" ? "Edit" : "View"}
                  </button>
                </Can>
              </td>
            </tr>
          );
        })}
      </TableShell>
    </div>
  );
}

// ── Margin Rules Tab ──────────────────────────────────────────────────────────

function MarginRulesTab() {
  const [rules, setRules]   = useState<MarginRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: MarginRule[] }>("/api/v1/pricing/margin-rules").then(r => {
      setRules(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  const ACTION_CLS: Record<MarginRule["action"], string> = {
    block:   "bg-red-100 text-red-700",
    warn:    "bg-amber-100 text-amber-700",
    approve: "bg-blue-100 text-blue-700",
  };

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
        Margin floor rules prevent selling below minimum margin. <strong>Block</strong> = hard stop · <strong>Warn</strong> = cashier override allowed · <strong>Approve</strong> = manager approval required.
      </div>
      <SectionHeader
        title={`${rules.length} margin rules`}
        action={
          <Can permission="pricing.manage">
            <button className="rounded-lg bg-[#5D5FEF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
              + New Rule
            </button>
          </Can>
        }
      />
      <TableShell cols={["Rule Name", "Scope", "Min Margin", "Action", "Status", ""]} empty={rules.length === 0}>
        {rules.map(r => (
          <tr key={r.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-5 py-3.5 font-semibold text-slate-900">{r.name}</td>
            <td className="px-5 py-3.5">
              <p className="text-slate-700 capitalize">{r.scope}</p>
              {r.categoryName && <p className="text-xs text-slate-400">{r.categoryName}</p>}
              {r.productName  && <p className="text-xs text-slate-400">{r.productName}</p>}
            </td>
            <td className="px-5 py-3.5">
              <span className="text-lg font-bold text-slate-900">{r.minMarginPct}%</span>
            </td>
            <td className="px-5 py-3.5">
              <Badge label={r.action.charAt(0).toUpperCase() + r.action.slice(1)} cls={ACTION_CLS[r.action]} />
            </td>
            <td className="px-5 py-3.5">
              <Badge
                label={r.active ? "Active" : "Inactive"}
                cls={r.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}
              />
            </td>
            <td className="px-5 py-3.5">
              <Can permission="pricing.manage">
                <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Edit
                </button>
              </Can>
            </td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}

// ── Simulator Tab ─────────────────────────────────────────────────────────────

const RESOLUTION_ORDER = [
  "Contract price (customer-specific)",
  "Customer group price",
  "Tier price (quantity break)",
  "Price book price",
  "Promotional price (active promotion)",
  "Scheduled markdown",
  "Retail base price",
];

function SimulatorTab() {
  const [productSku, setProductSku] = useState("SKU-001");
  const [qty, setQty]               = useState(1);
  const [customerId, setCustomerId] = useState("");
  const [result, setResult]         = useState<SimulatorResult | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const runSim = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiGet<SimulatorResult>(
        `/api/v1/pricing/simulate?sku=${productSku}&qty=${qty}&customerId=${customerId}`
      );
      setResult(r);
    } catch (err: unknown) {
      setError((err as Error).message ?? "Simulation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Price Resolution Simulator</h3>
        <p className="mb-5 text-xs text-slate-500">
          Enter a product SKU, quantity, and optionally a customer to see exactly which pricing rule applies and why.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Product SKU</label>
            <input
              value={productSku} onChange={e => setProductSku(e.target.value)}
              placeholder="e.g. SKU-001"
              className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-[#5D5FEF] focus:outline-none focus:ring-2 focus:ring-[#5D5FEF]/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Quantity</label>
            <input
              type="number" min={1} value={qty} onChange={e => setQty(Number(e.target.value))}
              className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-[#5D5FEF] focus:outline-none focus:ring-2 focus:ring-[#5D5FEF]/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Customer ID (optional)</label>
            <input
              value={customerId} onChange={e => setCustomerId(e.target.value)}
              placeholder="e.g. cust_001"
              className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-[#5D5FEF] focus:outline-none focus:ring-2 focus:ring-[#5D5FEF]/20"
            />
          </div>
        </div>
        <button
          onClick={() => void runSim()}
          disabled={loading || !productSku}
          className="mt-4 rounded-lg bg-[#5D5FEF] px-5 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8] disabled:opacity-50"
        >
          {loading ? "Resolving…" : "Resolve Price"}
        </button>
        {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}
      </div>

      {result && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Resolution Result</h3>
            <div className="text-right">
              <p className="text-xs text-slate-400">Final Price</p>
              <p className="text-2xl font-bold text-[#5D5FEF]">{formatMoney(result.finalCents)}</p>
              <p className="text-xs text-slate-500">via {result.source}</p>
            </div>
          </div>

          <ol className="space-y-2">
            {RESOLUTION_ORDER.map((ruleName, i) => {
              const step = result.steps.find(s => s.priority === i + 1);
              const applied = step?.applied ?? false;
              return (
                <li key={i} className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm ${applied ? "bg-indigo-50 border border-indigo-200" : "bg-slate-50"}`}>
                  <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${applied ? "bg-[#5D5FEF] text-white" : "bg-slate-200 text-slate-500"}`}>
                    {i + 1}
                  </span>
                  <span className={`flex-1 ${applied ? "font-semibold text-slate-900" : "text-slate-400 line-through"}`}>
                    {ruleName}
                  </span>
                  {step && (
                    <span className={`font-semibold ${applied ? "text-[#5D5FEF]" : "text-slate-400"}`}>
                      {formatMoney(step.price)}
                    </span>
                  )}
                  {applied && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">APPLIED</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {!result && (
        <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center">
          <p className="text-sm text-slate-400">Enter a SKU and click Resolve Price to see the full pricing stack.</p>
          <div className="mt-4 space-y-1 text-xs text-slate-400">
            {RESOLUTION_ORDER.map((r, i) => (
              <p key={i}>{i + 1}. {r}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TAB_KEYS: readonly Tab[] = ["price-books", "customer-overrides", "tier", "contracts", "scheduled", "margin-rules", "simulator"];

export default function PricingPage() {
  // ?tab=customer-overrides deep-links a tab (used by the old /catalog/price-book redirect).
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "price-books";
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    return t && TAB_KEYS.includes(t) ? t : "price-books";
  });

  return (
    <EnterpriseShell active="pricing" title="Pricing Engine" subtitle="Price books, tier rules, contracts, schedules, and margin floors" contentClassName="overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Pricing Engine</h1>
            <p className="mt-1 text-sm text-slate-500">
              Resolution order: Contract → Customer Group → Tier → Price Book → Promotion → Scheduled → Retail
            </p>
          </div>
        </div>

        <div className="border-b border-slate-200">
          <nav className="flex gap-1" aria-label="Pricing tabs">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
                  activeTab === t.key
                    ? "border-b-2 border-[#5D5FEF] text-[#5D5FEF]"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {activeTab === "price-books"        && <PriceBooksTab />}
        {activeTab === "customer-overrides" && <CustomerOverridesTab />}
        {activeTab === "tier"         && <TierPricingTab />}
        {activeTab === "contracts"    && <ContractPricesTab />}
        {activeTab === "scheduled"    && <ScheduledTab />}
        {activeTab === "margin-rules" && <MarginRulesTab />}
        {activeTab === "simulator"    && <SimulatorTab />}
      </div>
    </EnterpriseShell>
  );
}
