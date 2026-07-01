"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiGet, apiPut, apiPost, apiDelete, safeLoad } from "@/api-client/client";
import { useToast } from "@/components/Toast";
import { formatMoney } from "@/lib/money";
import type { ShippingMethod, PaymentTerm, PaymentMode, TaxRate } from "@/api-client/types";

type AddToast = ReturnType<typeof useToast>["addToast"];

// ── ReadField ──────────────────────────────────────────────────────────────────

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 break-words font-semibold text-slate-950">{value}</p>
    </div>
  );
}

// ── StoreSection ───────────────────────────────────────────────────────────────

interface Business { [key: string]: unknown }

const BUSINESS_FIELDS: { key: string; label: string; type?: string }[] = [
  { key: "name", label: "Store name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State / Province" },
  { key: "zip", label: "ZIP / Postal code" },
  { key: "country", label: "Country" },
  { key: "currency", label: "Currency" },
  { key: "timezone", label: "Timezone" },
  { key: "receiptFooter", label: "Receipt footer" },
  { key: "taxId", label: "Tax ID" },
];

export function StoreSection({ canManage, addToast }: { canManage: boolean; addToast: AddToast }) {
  const [data, setData] = useState<Business>({});
  const [editing, setEditing] = useState<Business | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Business>("/api/v1/settings/business")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const updated = await apiPut<Business>("/api/v1/settings/business", editing);
      setData(updated);
      setEditing(null);
      addToast({ title: "Store profile saved", variant: "success" });
    } catch (e) {
      addToast({ title: "Save failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  const current = editing ?? data;

  return (
    <Card className="flex flex-col gap-4">
      {error && <div role="alert" className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Store profile</h2>
          <p className="text-sm text-slate-500">Business identity used on receipts, invoices, and reports.</p>
        </div>
        {canManage && !editing && (
          <Button variant="secondary" size="sm" onClick={() => setEditing({ ...data })}>Edit</Button>
        )}
        {editing && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" size="sm" loading={busy} onClick={save}>Save</Button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {BUSINESS_FIELDS.map(({ key, label, type }) =>
          editing ? (
            <div key={key}>
              <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
              <input
                type={type ?? "text"}
                value={String(editing[key] ?? "")}
                onChange={(e) => setEditing((prev) => ({ ...prev!, [key]: e.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
              />
            </div>
          ) : (
            <ReadField key={key} label={label} value={String(current[key] ?? "—")} />
          )
        )}
      </div>
    </Card>
  );
}

// ── ShippingSection ────────────────────────────────────────────────────────────

export function ShippingSection({ canManage, addToast }: { canManage: boolean; addToast: AddToast }) {
  const [items, setItems] = useState<ShippingMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; amountCents: string; freeLimit: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShippingMethod | null>(null);

  const load = useCallback(() => {
    safeLoad(apiGet<{ items: ShippingMethod[] }>("/api/v1/settings/shipping-methods").then((r) => setItems(r.items ?? [])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form || !form.name.trim()) return;
    setBusy(true);
    try {
      await apiPost("/api/v1/settings/shipping-methods", {
        name: form.name.trim(),
        amountCents: Math.round(parseFloat(form.amountCents || "0") * 100),
        freeLimitCents: form.freeLimit ? Math.round(parseFloat(form.freeLimit) * 100) : undefined,
      });
      setForm(null);
      load();
      addToast({ title: "Shipping method added", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await apiDelete(`/api/v1/settings/shipping-methods/${id}`);
      setDeleteTarget(null);
      load();
      addToast({ title: "Shipping method removed", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  return (
    <>
      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove shipping method"
        message={`Remove "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => deleteTarget && remove(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Shipping methods</h2>
            <p className="text-sm text-slate-500">Available options at checkout and on invoices.</p>
          </div>
          {canManage && !form && (
            <Button variant="primary" size="sm" onClick={() => setForm({ name: "", amountCents: "0", freeLimit: "" })}>Add method</Button>
          )}
        </div>
        {form && canManage && (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex flex-wrap gap-3">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f!, name: e.target.value }))} placeholder="Name"
                className="min-w-32 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
              <input value={form.amountCents} onChange={(e) => setForm((f) => ({ ...f!, amountCents: e.target.value }))} placeholder="Rate ($)" type="number" min="0" step="0.01"
                className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
              <input value={form.freeLimit} onChange={(e) => setForm((f) => ({ ...f!, freeLimit: e.target.value }))} placeholder="Free above ($)" type="number" min="0" step="0.01"
                className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
                <Button size="sm" variant="primary" loading={busy} disabled={!form.name.trim()} onClick={add}>Add</Button>
              </div>
            </div>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Rate</th><th className="px-4 py-3">Free above</th>
              {canManage && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No shipping methods yet</td></tr>}
            {items.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3">{formatMoney(m.amount_cents)}</td>
                <td className="px-4 py-3">{m.free_limit_cents ? formatMoney(m.free_limit_cents) : "—"}</td>
                {canManage && <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => setDeleteTarget(m)}>Remove</Button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

// ── TermsSection ───────────────────────────────────────────────────────────────

export function TermsSection({ canManage, addToast }: { canManage: boolean; addToast: AddToast }) {
  const [items, setItems] = useState<PaymentTerm[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; daysDue: string; description: string } | null>(null);

  const load = useCallback(() => {
    safeLoad(apiGet<{ items: PaymentTerm[] }>("/api/v1/settings/payment-terms").then((r) => setItems(r.items ?? [])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form || !form.name.trim()) return;
    setBusy(true);
    try {
      await apiPost("/api/v1/settings/payment-terms", { name: form.name.trim(), daysDue: parseInt(form.daysDue || "0", 10), description: form.description.trim() || undefined });
      setForm(null);
      load();
      addToast({ title: "Payment term added", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Payment terms</h2>
          <p className="text-sm text-slate-500">Net terms available on invoices and sales orders.</p>
        </div>
        {canManage && !form && <Button variant="primary" size="sm" onClick={() => setForm({ name: "", daysDue: "30", description: "" })}>Add term</Button>}
      </div>
      {form && canManage && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap gap-3">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f!, name: e.target.value }))} placeholder='e.g. "Net 30"'
              className="min-w-32 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.daysDue} onChange={(e) => setForm((f) => ({ ...f!, daysDue: e.target.value }))} placeholder="Days due" type="number" min="0"
              className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f!, description: e.target.value }))} placeholder="Description (optional)"
              className="min-w-48 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!form.name.trim()} onClick={add}>Add</Button>
            </div>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Days due</th><th className="px-4 py-3">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-400">No payment terms yet</td></tr>}
          {items.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-3 font-medium">{t.name}</td>
              <td className="px-4 py-3">{t.days_due}</td>
              <td className="px-4 py-3 text-slate-500">{t.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── ModesSection ───────────────────────────────────────────────────────────────

export function ModesSection({ canManage, addToast }: { canManage: boolean; addToast: AddToast }) {
  const [items, setItems] = useState<PaymentMode[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    safeLoad(apiGet<{ items: PaymentMode[] }>("/api/v1/settings/payment-modes").then((r) => setItems(r.items ?? [])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiPost("/api/v1/settings/payment-modes", { name: name.trim() });
      setName(""); setAdding(false);
      load();
      addToast({ title: "Payment mode added", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Payment modes</h2>
          <p className="text-sm text-slate-500">Tender types accepted at checkout (cash, card, etc.).</p>
        </div>
        {canManage && !adding && <Button variant="primary" size="sm" onClick={() => setAdding(true)}>Add mode</Button>}
      </div>
      {adding && canManage && (
        <div className="flex gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Bank transfer"'
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
          <Button size="sm" variant="secondary" onClick={() => { setAdding(false); setName(""); }}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!name.trim()} onClick={add}>Add</Button>
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No payment modes yet</li>}
        {items.map((m) => <li key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm"><span className="font-medium">{m.name}</span></li>)}
      </ul>
    </Card>
  );
}

// ── TaxSection ─────────────────────────────────────────────────────────────────

export function TaxSection({ canManage, addToast }: { canManage: boolean; addToast: AddToast }) {
  const [items, setItems] = useState<TaxRate[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; ratePct: string; category: string; state: string } | null>(null);

  const load = useCallback(() => {
    safeLoad(apiGet<{ items: TaxRate[] }>("/api/v1/settings/tax-rates").then((r) => setItems(r.items ?? [])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form || !form.name.trim()) return;
    setBusy(true);
    try {
      await apiPost("/api/v1/settings/tax-rates", {
        name: form.name.trim(),
        rateBps: Math.round(parseFloat(form.ratePct || "0") * 100),
        applyToCategory: form.category.trim() || undefined,
        state: form.state.trim() || undefined,
      });
      setForm(null);
      load();
      addToast({ title: "Tax rate added", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Tax rates</h2>
          <p className="text-sm text-slate-500">Configured rates applied to line items at checkout.</p>
        </div>
        {canManage && !form && <Button variant="primary" size="sm" onClick={() => setForm({ name: "", ratePct: "", category: "", state: "" })}>Add rate</Button>}
      </div>
      {form && canManage && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap gap-3">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f!, name: e.target.value }))} placeholder='e.g. "CA Sales Tax"'
              className="min-w-32 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.ratePct} onChange={(e) => setForm((f) => ({ ...f!, ratePct: e.target.value }))} placeholder="Rate %" type="number" min="0" step="0.01"
              className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.category} onChange={(e) => setForm((f) => ({ ...f!, category: e.target.value }))} placeholder="Category (optional)"
              className="min-w-32 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.state} onChange={(e) => setForm((f) => ({ ...f!, state: e.target.value }))} placeholder="State (optional)"
              className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!form.name.trim() || !form.ratePct} onClick={add}>Add</Button>
            </div>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <th className="px-4 py-3">Name</th><th className="px-4 py-3">Rate</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">State</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No tax rates yet</td></tr>}
          {items.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-3 font-medium">{t.name}</td>
              <td className="px-4 py-3">{(t.rate_bps / 100).toFixed(2)}%</td>
              <td className="px-4 py-3 text-slate-500">{t.apply_to_category ?? "All"}</td>
              <td className="px-4 py-3 text-slate-500">{t.state ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── FlagsSection ───────────────────────────────────────────────────────────────

export function FlagsSection({ canManage, addToast }: { canManage: boolean; addToast: AddToast }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  useEffect(() => {
    safeLoad(apiGet<Record<string, boolean>>("/api/v1/settings/feature-flags").then((f) => setFlags(f)));
  }, []);

  const merged = useMemo(() => ({ ...flags, ...dirty }), [flags, dirty]);

  const toggle = (key: string) => {
    if (!canManage) return;
    setDirty((d) => ({ ...d, [key]: !merged[key] }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await apiPut<Record<string, boolean>>("/api/v1/settings/feature-flags", merged);
      setFlags(updated);
      setDirty({});
      addToast({ title: "Feature flags saved", variant: "success" });
    } catch (e) {
      addToast({ title: "Save failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setSaving(false); }
  };

  const hasDirty = Object.keys(dirty).length > 0;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Feature flags</h2>
          <p className="text-sm text-slate-500">Per-tenant toggles. Manager or owner required to change.</p>
        </div>
        {canManage && hasDirty && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDirty({})}>Reset</Button>
            <Button size="sm" variant="primary" loading={saving} onClick={save}>Save changes</Button>
          </div>
        )}
      </div>
      <ul className="divide-y divide-slate-100">
        {Object.entries(merged).length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No feature flags configured</li>}
        {Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)).map(([key, enabled]) => (
          <li key={key} className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="font-mono text-sm font-semibold text-slate-950">{key}</span>
            <button
              type="button"
              disabled={!canManage}
              aria-pressed={enabled}
              onClick={() => toggle(key)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-slate-950" : "bg-slate-300"} ${!canManage ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
              <span className="sr-only">{key}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── CurrenciesSection ──────────────────────────────────────────────────────────

interface Currency {
  currency_code: string;
  currency_name: string;
  symbol: string;
  exchange_rate: number;
  is_base: boolean;
  is_active: boolean;
}

export function CurrenciesSection() {
  const [items, setItems] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ items: Currency[] }>("/api/v1/settings/currencies")
      .then((r) => setItems(r.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Currencies</h2>
          <p className="text-sm text-slate-500">Exchange rates and supported currencies for multi-currency orders</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              <th className="px-4 py-3">Symbol</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Exchange Rate</th>
              <th className="px-4 py-3">Base</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No currencies configured</td></tr>}
            {items.map((c) => (
              <tr key={c.currency_code} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold text-slate-950">{c.symbol}</td>
                <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{c.currency_code}</td>
                <td className="px-4 py-3 text-slate-700">{c.currency_name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {c.is_base
                    ? <span className="text-slate-400">Base currency</span>
                    : `1 ${items.find((x) => x.is_base)?.currency_code ?? "USD"} = ${c.exchange_rate} ${c.currency_code}`}
                </td>
                <td className="px-4 py-3">
                  {c.is_base ? <Badge variant="green">Base</Badge> : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  {c.is_active ? <Badge variant="green">Active</Badge> : <Badge variant="gray">Inactive</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
        Exchange rates are updated manually. To set a new base currency or add currencies, contact support or update via the API.
      </div>
    </div>
  );
}
