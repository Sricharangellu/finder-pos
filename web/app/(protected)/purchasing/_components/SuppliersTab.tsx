"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { hasRole } from "@/lib/auth";
import type { Supplier, SuppliersResponse } from "@/api-client/types";

export function SuppliersTab() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = hasRole("manager");

  const load = useCallback(async () => {
    try {
      const res = await apiGet<SuppliersResponse>("/api/v1/purchasing/suppliers");
      setSuppliers(res.items ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const addSupplier = async () => {
    if (!supplierName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/v1/purchasing/suppliers", {
        name: supplierName.trim(),
        email: supplierEmail.trim() || undefined,
      });
      setSupplierName("");
      setSupplierEmail("");
      await load();
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Could not create supplier.");
    } finally { setBusy(false); }
  };

  const INPUT = "mt-1 min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950";

  return (
    <div className="p-4">
      {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      <ul className="flex flex-col gap-2">
        {suppliers.length === 0 && <li className="text-sm text-slate-500">No suppliers yet.</li>}
        {suppliers.map((s) => (
          <li key={s.id} className="rounded-md border border-slate-200 px-3 py-2">
            <p className="text-sm font-medium text-slate-950">{s.name}</p>
            <p className="text-xs text-slate-500">{s.email ?? "No email on file"}</p>
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="mt-4 flex max-w-sm flex-col gap-2 border-t border-slate-200 pt-4">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Supplier name</span>
            <input type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. Acme Coffee Co" className={INPUT} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Email (optional)</span>
            <input type="email" value={supplierEmail} onChange={(e) => setSupplierEmail(e.target.value)} placeholder="orders@supplier.example" className={INPUT} />
          </label>
          <Button variant="secondary" size="sm" disabled={busy || !supplierName.trim()} onClick={() => void addSupplier()}>
            Add supplier
          </Button>
        </div>
      )}
    </div>
  );
}
