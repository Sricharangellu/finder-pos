"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, ApiResponseError } from "@/api-client/client";
import type { Bill } from "@/api-client/types";
import { BillsView } from "./_components/BillsView";

/**
 * Bill List container — fetches supplier bills (server-side filtered by supplier
 * and status) plus the supplier list for the filter dropdown, and wires the
 * filter state to the API. Bills are auto-drafted when a PO is received.
 */
export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Suppliers are stable — load once for the filter dropdown.
  useEffect(() => {
    apiGet<{ items: Array<{ id: string; name: string }> }>("/api/v1/purchasing/suppliers")
      .then((d) => setSuppliers(d.items ?? []))
      .catch(() => { /* filter still works with the names embedded on each bill */ });
  }, []);

  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    cursor ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (supplierFilter) qs.set("supplierId", supplierFilter);
      if (statusFilter) qs.set("status", statusFilter);
      if (cursor) qs.set("cursor", cursor);
      const q = qs.toString();
      const data = await apiGet<{ items: Bill[]; nextCursor?: string | null }>(`/api/v1/billing/bills${q ? `?${q}` : ""}`);
      // Cursor pages append; a fresh load (filter change) replaces.
      setBills((prev) => (cursor ? [...prev, ...(data.items ?? [])] : (data.items ?? [])));
      setNextCursor(data.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load bills.");
    } finally {
      cursor ? setLoadingMore(false) : setLoading(false);
    }
  }, [supplierFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <EnterpriseShell
      active="bills"
      title="Bills"
      subtitle="Supplier bills (accounts payable) — filter by supplier and status"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        <BillsView
          bills={bills}
          suppliers={suppliers}
          supplierFilter={supplierFilter}
          statusFilter={statusFilter}
          loading={loading}
          error={error}
          onSupplierChange={setSupplierFilter}
          onStatusChange={setStatusFilter}
        />
        {nextCursor && !loading && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void load(nextCursor)}
              className="rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more bills"}
            </button>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
