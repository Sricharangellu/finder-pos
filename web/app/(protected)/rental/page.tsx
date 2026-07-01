"use client";

/**
 * FE-R1: Rental — asset availability + contract lifecycle.
 * Module-gated by module:rental_contracts.
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, safeLoad } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";

interface RentalAsset {
  id: string;
  name: string;
  category: string | null;
  daily_rate_cents: number;
  deposit_cents: number;
  status: "available" | "rented" | "maintenance";
  serial_number: string | null;
}

interface RentalContract {
  id: string;
  asset_id: string;
  asset_name: string;
  daily_rate_cents: number;
  customer_id: string | null;
  starts_at: number;
  ends_at: number;
  deposit_cents: number;
  total_cents: number;
  status: "active" | "returned" | "overdue";
  returned_at: number | null;
}

const ASSET_BADGE: Record<string, "green" | "red" | "gray"> = {
  available: "green", rented: "red", maintenance: "gray",
};

function daysBetween(start: number, end: number) {
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

export default function RentalPage() {
  const [tab, setTab]               = useState<"assets" | "contracts">("assets");
  const [assets, setAssets]         = useState<RentalAsset[]>([]);
  const [contracts, setContracts]   = useState<RentalContract[]>([]);
  const [loading, setLoading]       = useState(true);
  const [assetModal, setAssetModal] = useState(false);
  const [rentModal, setRentModal]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [returning, setReturning]   = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<RentalAsset | null>(null);
  const [aForm, setAForm]           = useState({ name: "", category: "", dailyRateCents: "", depositCents: "", serialNumber: "" });
  const [rForm, setRForm]           = useState({ startsAt: "", endsAt: "" });

  const loadAssets = () => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: RentalAsset[] }>("/api/v1/rental/assets")
        .then(r => setAssets(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  };

  const loadContracts = () => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: RentalContract[] }>("/api/v1/rental/contracts?status=active")
        .then(r => setContracts(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  };

  useEffect(() => { tab === "assets" ? loadAssets() : loadContracts(); }, [tab]);

  const handleCreateAsset = async () => {
    setSaving(true);
    try {
      await apiPost("/api/v1/rental/assets", {
        name: aForm.name,
        category: aForm.category || undefined,
        dailyRateCents: Number(aForm.dailyRateCents) || 0,
        depositCents: Number(aForm.depositCents) || 0,
        serialNumber: aForm.serialNumber || undefined,
      });
      setAssetModal(false);
      setAForm({ name: "", category: "", dailyRateCents: "", depositCents: "", serialNumber: "" });
      loadAssets();
    } finally { setSaving(false); }
  };

  const openRentModal = (asset: RentalAsset) => { setSelectedAsset(asset); setRentModal(true); };

  const handleRent = async () => {
    if (!selectedAsset || !rForm.startsAt || !rForm.endsAt) return;
    setSaving(true);
    try {
      const startsAt = new Date(rForm.startsAt).getTime();
      const endsAt   = new Date(rForm.endsAt).getTime();
      await apiPost("/api/v1/rental/contracts", { assetId: selectedAsset.id, startsAt, endsAt });
      setRentModal(false);
      setRForm({ startsAt: "", endsAt: "" });
      setSelectedAsset(null);
      tab === "assets" ? loadAssets() : loadContracts();
    } finally { setSaving(false); }
  };

  const handleReturn = async (contractId: string) => {
    setReturning(contractId);
    try {
      await apiPost(`/api/v1/rental/contracts/${contractId}/return`, {});
      loadContracts();
    } finally { setReturning(null); }
  };

  const estimatedTotal = selectedAsset && rForm.startsAt && rForm.endsAt
    ? daysBetween(new Date(rForm.startsAt).getTime(), new Date(rForm.endsAt).getTime()) * selectedAsset.daily_rate_cents
    : null;

  return (
    <EnterpriseShell active="rental" title="Rental" subtitle="Asset availability and rental contracts">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 sm:px-6">

        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {(["assets", "contracts"] as const).map(t => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                  tab === t ? "bg-brand-600 text-white" : "bg-gray-100 text-[var(--color-text-secondary)] hover:bg-gray-200"
                }`}>
                {t === "assets" ? `Assets (${assets.length})` : `Active Contracts (${contracts.length})`}
              </button>
            ))}
          </div>
          {tab === "assets" && (
            <Button variant="primary" size="sm" onClick={() => setAssetModal(true)}>+ Asset</Button>
          )}
        </div>

        {/* Assets tab */}
        {tab === "assets" && (
          loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1,2,3].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : assets.length === 0 ? (
            <Card><p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">No assets. Add one above.</p></Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {assets.map(a => (
                <div key={a.id} className="rounded-xl border border-[var(--color-table-border)] bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[var(--color-text-primary)]">{a.name}</p>
                      <p className="text-xs text-[var(--color-text-secondary)]">{a.category ?? "Uncategorised"}</p>
                    </div>
                    <Badge variant={ASSET_BADGE[a.status] ?? "gray"} size="sm">{a.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-[var(--color-text-primary)]">
                    {formatMoney(a.daily_rate_cents)}/day
                    <span className="ml-2 text-xs font-normal text-[var(--color-text-secondary)]">
                      Deposit: {formatMoney(a.deposit_cents)}
                    </span>
                  </p>
                  {a.serial_number && (
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">S/N: {a.serial_number}</p>
                  )}
                  {a.status === "available" && (
                    <Button variant="primary" size="sm" fullWidth className="mt-3" onClick={() => openRentModal(a)}>
                      Rent Out
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* Contracts tab */}
        {tab === "contracts" && (
          loading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : contracts.length === 0 ? (
            <Card><p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">No active contracts.</p></Card>
          ) : (
            <div className="space-y-2">
              {contracts.map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-xl border border-[var(--color-table-border)] bg-white px-4 py-3 shadow-sm">
                  <div>
                    <p className="font-semibold text-[var(--color-text-primary)]">{c.asset_name}</p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {fmtDate(c.starts_at)} → {fmtDate(c.ends_at)}
                      {" · "}{daysBetween(c.starts_at, c.ends_at)} days
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      Total: {formatMoney(c.total_cents)} · Deposit: {formatMoney(c.deposit_cents)}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm"
                    loading={returning === c.id}
                    onClick={() => handleReturn(c.id)}>
                    Return
                  </Button>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Add asset modal */}
      <Modal open={assetModal} onClose={() => setAssetModal(false)} title="Add Rental Asset">
        <div className="space-y-3 p-4">
          {[
            { key: "name",           label: "Name *",           placeholder: "Power Drill" },
            { key: "category",       label: "Category",         placeholder: "Tools" },
            { key: "dailyRateCents", label: "Daily rate (cents)", placeholder: "1500" },
            { key: "depositCents",   label: "Deposit (cents)",  placeholder: "5000" },
            { key: "serialNumber",   label: "Serial number",    placeholder: "SN-001" },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>
              <input type={key.includes("Cents") ? "number" : "text"} placeholder={placeholder}
                value={aForm[key as keyof typeof aForm]}
                onChange={e => setAForm(f => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setAssetModal(false)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleCreateAsset}
              disabled={!aForm.name}>Add</Button>
          </div>
        </div>
      </Modal>

      {/* Rent out modal */}
      <Modal open={rentModal} onClose={() => { setRentModal(false); setSelectedAsset(null); }}
        title={`Rent Out — ${selectedAsset?.name}`}>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Start date *</label>
              <input type="date" value={rForm.startsAt}
                onChange={e => setRForm(f => ({ ...f, startsAt: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">End date *</label>
              <input type="date" value={rForm.endsAt}
                onChange={e => setRForm(f => ({ ...f, endsAt: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
          </div>
          {estimatedTotal !== null && (
            <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm">
              <span className="text-[var(--color-text-secondary)]">Estimated total: </span>
              <span className="font-bold text-brand-700">{formatMoney(estimatedTotal)}</span>
              <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
                + {formatMoney(selectedAsset?.deposit_cents ?? 0)} deposit
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => { setRentModal(false); setSelectedAsset(null); }}>Cancel</Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleRent}
              disabled={!rForm.startsAt || !rForm.endsAt}>Confirm Rental</Button>
          </div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
