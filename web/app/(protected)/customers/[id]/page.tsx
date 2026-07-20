"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { useToast } from "@/components/Toast";
import { getUser } from "@/lib/auth";
import type {
  Customer,
  CustomerSummary,
  CustomerFinancials,
  DetailTab,
  CustomerLoyalty,
  CustomerSearchResult,
  MergeStep,
} from "./_components/shared";
import { INPUT_CLASS, tierLabel, statusColor } from "./_components/shared";
import { GeneralTab } from "./_components/GeneralTab";
import { LoyaltyCard } from "./_components/LoyaltyCard";
import { TransactionsTab } from "./_components/TransactionsTab";
import { FinancialsTab } from "./_components/FinancialsTab";
import { StoreCreditTab } from "./_components/StoreCreditTab";
import { AddressesTab } from "./_components/AddressesTab";
import { ContactsTab } from "./_components/ContactsTab";
import { NotesPanel } from "./_components/NotesPanel";
import { OrdersTab } from "./_components/OrdersTab";

// ─── Merge Modal ──────────────────────────────────────────────────────────────

function MergeModal({
  primary,
  onClose,
  onMerged,
}: {
  primary: { id: string; name: string; email: string | null; points: number };
  onClose: () => void;
  onMerged: () => void;
}) {
  const [step, setStep] = useState<MergeStep>("search");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [duplicate, setDuplicate] = useState<CustomerSearchResult | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debouncedQ.trim()) { setResults([]); return; }
    setSearching(true);
    apiGet<{ items: CustomerSearchResult[] }>(`/api/v1/customers/search?q=${encodeURIComponent(debouncedQ)}`)
      .then((r) => setResults((r.items ?? []).filter((c) => c.id !== primary.id).slice(0, 5)))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [debouncedQ, primary.id]);

  const handleConfirmMerge = async () => {
    if (!duplicate) return;
    setMerging(true); setMergeError(null);
    try {
      await apiPost(`/api/v1/customers/${primary.id}/merge`, { merge_from_id: duplicate.id });
      onMerged();
      onClose();
    } catch (err) {
      setMergeError(err instanceof ApiResponseError ? err.message : "Merge failed.");
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-md bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Merge duplicate customer</h2>
          <button type="button" onClick={onClose} aria-label="Close merge modal" className="flex h-9 w-9 items-center justify-center rounded-md text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === "search" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Search for the duplicate record to merge into <span className="font-semibold text-slate-950">{primary.name}</span>. The primary record&apos;s name and email will be kept; loyalty points will be summed.
              </p>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Search by name or email</label>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Type to search…"
                  className={INPUT_CLASS}
                  autoFocus
                />
              </div>
              {searching && <p className="text-sm text-slate-400" aria-busy="true">Searching…</p>}
              {!searching && debouncedQ && results.length === 0 && (
                <p className="text-sm text-slate-500">No customers found matching &ldquo;{debouncedQ}&rdquo;.</p>
              )}
              {results.length > 0 && (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {results.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-950">{r.name}</p>
                        <p className="text-xs text-slate-500">{r.email} &middot; {r.phone}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setDuplicate(r); setStep("confirm"); }}
                        className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Merge into this record
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === "confirm" && duplicate && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                You are about to merge <span className="font-semibold text-slate-950">{duplicate.name}</span> into <span className="font-semibold text-slate-950">{primary.name}</span>. This cannot be undone.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-success-200 bg-success-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-success-700">Kept (Primary)</p>
                  <p className="mt-1 text-sm font-medium text-slate-950">{primary.name}</p>
                  <p className="text-xs text-slate-600">{primary.email ?? "—"}</p>
                  <p className="mt-1 text-xs text-slate-500">Points: {primary.points} + duplicate&apos;s points</p>
                  <p className="text-xs text-slate-500">All orders from duplicate will be reassigned here</p>
                </div>
                <div className="rounded-md border border-danger-200 bg-danger-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-danger-700">Deleted (Duplicate)</p>
                  <p className="mt-1 text-sm font-medium text-slate-950">{duplicate.name}</p>
                  <p className="text-xs text-slate-600">{duplicate.email}</p>
                  <p className="mt-1 text-xs text-slate-500">{duplicate.phone}</p>
                </div>
              </div>
              {mergeError && (
                <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">{mergeError}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
          {step === "confirm" ? (
            <>
              <button type="button" onClick={() => setStep("search")} className="min-h-[40px] rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</button>
              <button
                type="button"
                onClick={() => void handleConfirmMerge()}
                disabled={merging}
                className="min-h-[40px] rounded-md bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-60"
              >
                {merging ? "Merging…" : "Confirm Merge"}
              </button>
            </>
          ) : (
            <button type="button" onClick={onClose} className="min-h-[40px] rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          )}
        </div>
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
        <div className="mb-5 h-4 w-24 animate-pulse rounded bg-slate-200" />
        <div className="mb-3 h-8 w-64 animate-pulse rounded bg-slate-200" />
        <div className="mb-6 flex gap-2">
          <div className="h-6 w-16 animate-pulse rounded bg-slate-200" />
          <div className="h-6 w-16 animate-pulse rounded bg-slate-200" />
        </div>
        <div className="mb-6 flex gap-1 border-b border-slate-200">
          {["General", "Transactions", "Financials", "Store Credit"].map((t) => (
            <div key={t} className="mr-1 h-10 w-24 animate-pulse rounded-t bg-slate-200" />
          ))}
        </div>
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i}>
                <div className="mb-1 h-3 w-20 animate-pulse rounded bg-slate-200" />
                <div className="h-10 animate-pulse rounded-md bg-slate-200" />
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
  const [loyalty, setLoyalty] = useState<CustomerLoyalty | null>(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("general");
  const [editMode, setEditMode] = useState(false);
  const [showMerge, setShowMerge] = useState(false);

  const user = getUser();
  const canEdit = user?.role === "owner" || user?.role === "manager";

  const loadData = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoyaltyLoading(true);
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
        setError(err instanceof ApiResponseError ? err.message : "Could not load customer.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    apiGet<CustomerLoyalty>(`/api/v1/customers/${customerId}/loyalty`, { signal: controller.signal })
      .then((loy) => { if (!controller.signal.aborted) setLoyalty(loy); })
      .catch(() => { if (!controller.signal.aborted) setLoyalty(null); })
      .finally(() => { if (!controller.signal.aborted) setLoyaltyLoading(false); });

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
          <Link href="/customers" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-950 hover:underline">
            <BackIcon /> Back to Customers
          </Link>
          <div className="rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {error ?? "Customer not found."}
          </div>
        </div>
      </EnterpriseShell>
    );
  }

  const tabs: Array<{ key: DetailTab; label: string }> = [
    { key: "general", label: "General" },
    { key: "transactions", label: "Transactions" },
    { key: "orders", label: "Orders" },
    { key: "financials", label: "Financials" },
    { key: "store-credit", label: "Store Credit" },
    { key: "contacts", label: "Contacts" },
    { key: "addresses", label: "Addresses" },
  ];

  return (
    <EnterpriseShell
      active="customers"
      title={customer.name}
      subtitle="Customer profile"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
        <div>
          <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-slate-950 hover:underline">
            <BackIcon /> Back to Customers
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">{customer.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-950">
                {tierLabel(customer.tier)}
              </span>
              <span className={`inline-flex rounded px-2.5 py-0.5 text-xs font-semibold capitalize ${statusColor(customer.status)}`}>
                {customer.status}
              </span>
              {customer.verified && (
                <span className="inline-flex rounded bg-success-100 px-2.5 py-0.5 text-xs font-semibold text-success-700">
                  Verified
                </span>
              )}
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowMerge(true)}>
                Merge duplicate
              </Button>
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
            </div>
          )}
        </div>

        <div className="flex gap-1 border-b border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={[
                "border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "border-slate-950 text-slate-950"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

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
        {activeTab === "orders" && <OrdersTab customerId={customerId} />}
        {activeTab === "financials" && (
          <FinancialsTab customer={customer} summary={summary} financials={financials} />
        )}
        {activeTab === "store-credit" && (
          <StoreCreditTab customer={customer} financials={financials} canEdit={canEdit} />
        )}
        {activeTab === "contacts" && (
          <ContactsTab customerId={customerId} canEdit={canEdit} addToast={addToast} />
        )}
        {activeTab === "addresses" && (
          <AddressesTab customerId={customerId} canEdit={canEdit} addToast={addToast} />
        )}

        {activeTab !== "contacts" && activeTab !== "addresses" && (
          <>
            <LoyaltyCard loyalty={loyalty} loading={loyaltyLoading} />
            <NotesPanel customerId={customerId} canEdit={canEdit} addToast={addToast} />
          </>
        )}
      </div>

      {showMerge && (
        <MergeModal
          primary={{ id: customer.id, name: customer.name, email: customer.email, points: customer.points }}
          onClose={() => setShowMerge(false)}
          onMerged={() => {
            addToast({ title: "Merged successfully. Duplicate record deleted.", variant: "success" });
            loadData();
          }}
        />
      )}
    </EnterpriseShell>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
