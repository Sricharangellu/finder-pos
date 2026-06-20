"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { getUser } from "@/lib/auth";
import { apiGet, apiPut, apiPost, apiDelete } from "@/api-client/client";
import { useToast } from "@/components/Toast";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/Badge";
import type { ShippingMethod, PaymentTerm, PaymentMode, TaxRate, Account, Deposit } from "@/api-client/types";

type Section = "store" | "shipping" | "terms" | "modes" | "tax" | "flags" | "security" | "coa" | "deposits" | "loyalty" | "api-keys" | "currencies";

interface Business { [key: string]: unknown }

export default function SettingsPage() {
  const role = getUser()?.role ?? "cashier";
  const canManage = role === "owner" || role === "manager";
  const [section, setSection] = useState<Section>("store");
  const { addToast } = useToast();

  return (
    <EnterpriseShell active="settings" title="Settings" subtitle="Store, payments, shipping, and feature flags" contentClassName="overflow-y-auto">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-5 px-4 py-6 xl:grid-cols-[16rem_1fr]">
        <Card className="h-fit p-2">
          <nav aria-label="Settings sections" className="flex flex-col gap-1">
            {(["store", "shipping", "terms", "modes", "tax", "flags", "security", "coa", "deposits", "loyalty", "api-keys", "currencies"] as Section[]).map((s) => (
              <SectionButton key={s} active={section === s} onClick={() => setSection(s)} label={sectionLabel(s)} />
            ))}
          </nav>
        </Card>

        <div className="flex flex-col gap-5 min-w-0">
          {section === "store" && <StoreSection canManage={canManage} addToast={addToast} />}
          {section === "shipping" && <ShippingSection canManage={canManage} addToast={addToast} />}
          {section === "terms" && <TermsSection canManage={canManage} addToast={addToast} />}
          {section === "modes" && <ModesSection canManage={canManage} addToast={addToast} />}
          {section === "tax" && <TaxSection canManage={canManage} addToast={addToast} />}
          {section === "flags" && <FlagsSection canManage={canManage} addToast={addToast} />}
          {section === "security" && <SecuritySection />}
          {section === "coa" && <CoaSection canManage={canManage} addToast={addToast} />}
          {section === "deposits" && <DepositsSection canManage={canManage} addToast={addToast} />}
          {section === "loyalty" && <LoyaltyTiersSection canManage={canManage} addToast={addToast} />}
          {section === "api-keys" && <ApiKeysSection canManage={canManage} addToast={addToast} />}
          {section === "currencies" && <CurrenciesSection />}
        </div>
      </div>
    </EnterpriseShell>
  );
}

function sectionLabel(s: Section): string {
  return { store: "Store profile", shipping: "Shipping methods", terms: "Payment terms", modes: "Payment modes", tax: "Tax rates", flags: "Feature flags", security: "Security", coa: "Chart of Accounts", deposits: "Deposits", loyalty: "Loyalty Tiers", "api-keys": "API Keys", currencies: "Currencies" }[s];
}

// ─── Store Profile ────────────────────────────────────────────────────────────

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

function StoreSection({ canManage, addToast }: { canManage: boolean; addToast: ReturnType<typeof useToast>["addToast"] }) {
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
    } finally {
      setBusy(false);
    }
  };

  const current = editing ?? data;

  return (
    <Card className="flex flex-col gap-4">
      {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
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
              <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
              <input
                type={type ?? "text"}
                value={String(editing[key] ?? "")}
                onChange={(e) => setEditing((prev) => ({ ...prev!, [key]: e.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-950 focus:ring-2 focus:ring-slate-950 outline-none"
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

// ─── Shipping Methods ─────────────────────────────────────────────────────────

function ShippingSection({ canManage, addToast }: { canManage: boolean; addToast: ReturnType<typeof useToast>["addToast"] }) {
  const [items, setItems] = useState<ShippingMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; amountCents: string; freeLimit: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShippingMethod | null>(null);

  const load = useCallback(() => {
    apiGet<{ items: ShippingMethod[] }>("/api/v1/settings/shipping-methods").then((r) => setItems(r.items ?? []));
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
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f!, name: e.target.value }))} placeholder="Name" className="flex-1 min-w-32 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
              <input value={form.amountCents} onChange={(e) => setForm((f) => ({ ...f!, amountCents: e.target.value }))} placeholder="Rate ($)" type="number" min="0" step="0.01" className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
              <input value={form.freeLimit} onChange={(e) => setForm((f) => ({ ...f!, freeLimit: e.target.value }))} placeholder="Free above ($)" type="number" min="0" step="0.01" className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
                <Button size="sm" variant="primary" loading={busy} disabled={!form.name.trim()} onClick={add}>Add</Button>
              </div>
            </div>
          </div>
        )}
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"><th className="px-4 py-3">Name</th><th className="px-4 py-3">Rate</th><th className="px-4 py-3">Free above</th>{canManage && <th className="px-4 py-3" />}</tr></thead>
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

// ─── Payment Terms ────────────────────────────────────────────────────────────

function TermsSection({ canManage, addToast }: { canManage: boolean; addToast: ReturnType<typeof useToast>["addToast"] }) {
  const [items, setItems] = useState<PaymentTerm[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; daysDue: string; description: string } | null>(null);

  const load = useCallback(() => {
    apiGet<{ items: PaymentTerm[] }>("/api/v1/settings/payment-terms").then((r) => setItems(r.items ?? []));
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
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f!, name: e.target.value }))} placeholder='e.g. "Net 30"' className="flex-1 min-w-32 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.daysDue} onChange={(e) => setForm((f) => ({ ...f!, daysDue: e.target.value }))} placeholder="Days due" type="number" min="0" className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f!, description: e.target.value }))} placeholder="Description (optional)" className="flex-1 min-w-48 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!form.name.trim()} onClick={add}>Add</Button>
            </div>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"><th className="px-4 py-3">Name</th><th className="px-4 py-3">Days due</th><th className="px-4 py-3">Description</th></tr></thead>
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

// ─── Payment Modes ────────────────────────────────────────────────────────────

function ModesSection({ canManage, addToast }: { canManage: boolean; addToast: ReturnType<typeof useToast>["addToast"] }) {
  const [items, setItems] = useState<PaymentMode[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    apiGet<{ items: PaymentMode[] }>("/api/v1/settings/payment-modes").then((r) => setItems(r.items ?? []));
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
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 flex gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Bank transfer"' className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
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

// ─── Tax Rates ────────────────────────────────────────────────────────────────

function TaxSection({ canManage, addToast }: { canManage: boolean; addToast: ReturnType<typeof useToast>["addToast"] }) {
  const [items, setItems] = useState<TaxRate[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; ratePct: string; category: string; state: string } | null>(null);

  const load = useCallback(() => {
    apiGet<{ items: TaxRate[] }>("/api/v1/settings/tax-rates").then((r) => setItems(r.items ?? []));
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
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f!, name: e.target.value }))} placeholder='e.g. "CA Sales Tax"' className="flex-1 min-w-32 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.ratePct} onChange={(e) => setForm((f) => ({ ...f!, ratePct: e.target.value }))} placeholder="Rate %" type="number" min="0" step="0.01" className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.category} onChange={(e) => setForm((f) => ({ ...f!, category: e.target.value }))} placeholder="Category (optional)" className="flex-1 min-w-32 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.state} onChange={(e) => setForm((f) => ({ ...f!, state: e.target.value }))} placeholder="State (optional)" className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!form.name.trim() || !form.ratePct} onClick={add}>Add</Button>
            </div>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"><th className="px-4 py-3">Name</th><th className="px-4 py-3">Rate</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">State</th></tr></thead>
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

// ─── Feature Flags ────────────────────────────────────────────────────────────

function FlagsSection({ canManage, addToast }: { canManage: boolean; addToast: ReturnType<typeof useToast>["addToast"] }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  useEffect(() => {
    apiGet<Record<string, boolean>>("/api/v1/settings/feature-flags").then((f) => setFlags(f));
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

// ─── Security ─────────────────────────────────────────────────────────────────

interface MfaStatus {
  enabled: boolean;
  setupRequired: boolean;
}

interface MfaSetupData {
  secret: string;
  otpauthUrl: string;
}

function SecuritySection() {
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    apiGet<MfaStatus>("/api/identity/mfa/status")
      .then(setMfaStatus)
      .catch(() => setStatusError("Failed to load MFA status."));
  }, []);

  const startSetup = async () => {
    setBusy(true);
    try {
      const data = await apiPost<MfaSetupData>("/api/identity/mfa/setup", {});
      setSetupData(data);
    } catch (e) {
      addToast({ title: "Setup failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const verifyAndEnable = async () => {
    if (!verifyCode.trim()) return;
    setBusy(true);
    try {
      await apiPost("/api/identity/mfa/verify", { code: verifyCode.trim() });
      setMfaStatus({ enabled: true, setupRequired: false });
      setSetupData(null);
      setVerifyCode("");
      addToast({ title: "MFA enabled", description: "Your account is now protected with MFA.", variant: "success" });
    } catch (e) {
      addToast({ title: "Verification failed", description: e instanceof Error ? e.message : "Invalid code", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const disableMfa = async () => {
    setBusy(true);
    setConfirmDisable(false);
    try {
      await apiPost("/api/identity/mfa/disable", {});
      setMfaStatus({ enabled: false, setupRequired: false });
      addToast({ title: "MFA disabled", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed to disable MFA", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <ConfirmDialog
        open={confirmDisable}
        title="Disable MFA"
        message="Are you sure you want to disable multi-factor authentication? Your account will be less secure."
        confirmLabel="Disable MFA"
        destructive
        onConfirm={() => void disableMfa()}
        onCancel={() => setConfirmDisable(false)}
      />

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Multi-factor authentication</h2>
            <p className="text-sm text-slate-500">Add an extra layer of sign-in security to your account.</p>
          </div>
          {mfaStatus?.enabled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              MFA is active
            </span>
          ) : (
            <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Not enabled</span>
          )}
        </div>

        {statusError && (
          <p className="text-sm text-red-600">{statusError}</p>
        )}

        {mfaStatus === null && !statusError && (
          <p className="text-sm text-slate-400">Loading MFA status…</p>
        )}

        {mfaStatus !== null && !mfaStatus.enabled && !setupData && (
          <Button variant="primary" size="sm" loading={busy} onClick={() => void startSetup()}>
            Enable MFA
          </Button>
        )}

        {setupData && (
          <div className="flex flex-col gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-700">
              Enter this code in your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code below to confirm.
            </p>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Manual entry secret</p>
              <code className="block rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm tracking-widest text-slate-950 select-all">
                {setupData.secret}
              </code>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase text-slate-500">
                6-digit verification code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono tracking-widest outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                />
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  disabled={verifyCode.length !== 6}
                  onClick={() => void verifyAndEnable()}
                >
                  Verify &amp; Enable
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setSetupData(null); setVerifyCode(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {mfaStatus?.enabled && (
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={() => setConfirmDisable(true)}
            >
              Disable MFA
            </Button>
          </div>
        )}
      </Card>

      <BackupCodesCard />

      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-950">Security posture</h2>
        <div className="flex flex-col gap-2 text-sm">
          <SecurityRow label="Role-based access" value="Enabled" ok />
          <SecurityRow label="Access token TTL" value="15 minutes" ok />
          <SecurityRow label="MFA" value={mfaStatus?.enabled ? "Enabled" : "Not enabled"} ok={mfaStatus?.enabled} />
          <SecurityRow label="Refresh token rotation" value="Planned (BE-2)" />
          <SecurityRow label="Rate limiting" value="In-memory (DB-2 pending)" />
          <SecurityRow label="Row-level security" value="Planned (DB-1)" />
          <SecurityRow label="Audit log" value="Backend-owned" ok />
        </div>
      </Card>
    </div>
  );
}

// ─── Backup Codes ─────────────────────────────────────────────────────────────

type BackupCodesState = "idle" | "revealed" | "hidden";

function generateCodes(): string[] {
  const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    const part = (arr: Uint8Array, start: number) =>
      Array.from(arr.slice(start, start + 4)).map((b) => CHARS[b % CHARS.length]).join("");
    return `${part(buf, 0)}-${part(buf, 4)}`;
  });
}

function BackupCodesCard() {
  const [codesState, setCodesState] = useState<BackupCodesState>("idle");
  const [codes, setCodes] = useState<string[]>([]);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const { addToast } = useToast();

  const generate = () => {
    const newCodes = generateCodes();
    setCodes(newCodes);
    setCodesState("revealed");
    setConfirmRegen(false);
    void fetch("/api/v1/auth/backup-codes", { method: "POST" });
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      addToast({ title: "Backup codes copied", variant: "success" });
    } catch {
      addToast({ title: "Could not copy", description: "Copy the codes manually.", variant: "error" });
    }
  };

  const download = () => {
    const blob = new Blob([codes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "finderpos-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Backup codes</h2>
          <p className="text-sm text-slate-500">Generate one-time recovery codes in case you lose access to your authenticator app.</p>
        </div>
        {codesState !== "idle" && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            {codes.length} codes remaining
          </span>
        )}
      </div>

      {codesState === "idle" && (
        <Button variant="primary" size="sm" onClick={generate}>Generate</Button>
      )}

      {codesState === "revealed" && (
        <>
          <p className="text-sm text-slate-500">Save these somewhere safe. Each code can only be used once.</p>
          <div className="grid grid-cols-4 gap-2 rounded-md border border-slate-200 bg-slate-50 p-4">
            {codes.map((c) => (
              <span key={c} className="font-mono text-sm font-semibold tracking-wider text-slate-950 select-all">
                {c}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void copyAll()}>Copy all</Button>
            <Button variant="secondary" size="sm" onClick={download}>Download .txt</Button>
            <Button variant="ghost" size="sm" onClick={() => setCodesState("hidden")}>Hide codes</Button>
            {confirmRegen ? (
              <span className="flex items-center gap-2 text-sm text-slate-600">
                This will invalidate all existing codes. Continue?
                <button
                  type="button"
                  className="font-semibold text-red-600 hover:text-red-700"
                  onClick={generate}
                >
                  Yes, regenerate
                </button>
                <button
                  type="button"
                  className="text-slate-500 hover:text-slate-700"
                  onClick={() => setConfirmRegen(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setConfirmRegen(true)}>Regenerate codes</Button>
            )}
          </div>
        </>
      )}

      {codesState === "hidden" && (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm text-slate-600">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            {codes.length} codes remaining
          </span>
          <Button variant="secondary" size="sm" onClick={() => setCodesState("revealed")}>Show codes</Button>
        </div>
      )}
    </Card>
  );
}

// ─── Chart of Accounts ───────────────────────────────────────────────────────

// Account uses the shared Account type from api-client/types

function CoaSection({ canManage, addToast }: { canManage: boolean; addToast: ReturnType<typeof useToast>["addToast"] }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", type: "asset" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: Account[] }>("/api/v1/accounting/accounts")
      .then(r => setAccounts(r.items ?? []))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    setBusy(true);
    try {
      await apiPost("/api/v1/accounting/accounts", { code: form.code.trim(), name: form.name.trim(), type: form.type });
      setShowAdd(false);
      setForm({ code: "", name: "", type: "asset" });
      load();
      addToast({ title: "Account added", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  const typeOrder = ["asset", "liability", "income", "expense"];
  const grouped = typeOrder.reduce<Record<string, Account[]>>((acc, t) => {
    acc[t] = accounts.filter(a => a.type === t);
    return acc;
  }, {});
  // also capture any unexpected types
  accounts.forEach(a => {
    if (!typeOrder.includes(a.type)) {
      if (!grouped[a.type]) grouped[a.type] = [];
      grouped[a.type]!.push(a);
    }
  });

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Chart of Accounts</h2>
          <p className="text-sm text-slate-500">General ledger accounts grouped by type.</p>
        </div>
        {canManage && !showAdd && <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>Add account</Button>}
      </div>
      {showAdd && canManage && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap gap-3">
            <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="Code (e.g. 1000)" className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Account name" className="flex-1 min-w-40 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950">
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!form.code.trim() || !form.name.trim()} onClick={add}>Add</Button>
            </div>
          </div>
        </div>
      )}
      {loading ? (
        <div className="px-4 py-8 text-center text-sm text-slate-400">Loading accounts…</div>
      ) : accounts.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-400">No accounts yet. Add your first account above.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {Object.entries(grouped).filter(([, rows]) => rows.length > 0).map(([type, rows]) => (
            <div key={type}>
              <div className="bg-slate-50 px-4 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{type}</span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {rows.sort((a, b) => a.code.localeCompare(b.code)).map(account => (
                    <tr key={account.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 w-24"><span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{account.code}</span></td>
                      <td className="px-4 py-3 font-medium text-slate-900">{account.name}</td>
                      <td className="px-4 py-3 text-slate-500 capitalize">{account.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Deposits ─────────────────────────────────────────────────────────────────

// Deposit uses the shared Deposit type from api-client/types

function DepositsSection({ canManage, addToast }: { canManage: boolean; addToast: ReturnType<typeof useToast>["addToast"] }) {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ amountCents: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: Deposit[] }>("/api/v1/accounting/deposits")
      .then(r => setDeposits(r.items ?? []))
      .catch(() => setDeposits([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const cents = Math.round(parseFloat(form.amountCents || "0") * 100);
    if (cents <= 0) return;
    setBusy(true);
    try {
      await apiPost("/api/v1/accounting/deposits", { totalCents: cents, note: form.note.trim() || undefined });
      setShowAdd(false);
      setForm({ amountCents: "", note: "" });
      load();
      addToast({ title: "Deposit created", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  const statusColor = (s: string) => {
    if (s === "completed" || s === "deposited") return "text-emerald-700";
    if (s === "pending") return "text-amber-700";
    return "text-slate-500";
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Batch Deposits</h2>
          <p className="text-sm text-slate-500">Record cash and payment deposits to the bank.</p>
        </div>
        {canManage && !showAdd && <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>New deposit</Button>}
      </div>
      {showAdd && canManage && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap gap-3">
            <input value={form.amountCents} onChange={e => setForm(f => ({ ...f, amountCents: e.target.value }))} placeholder="Amount ($)" type="number" min="0" step="0.01" className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Note (optional)" className="flex-1 min-w-40 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={parseFloat(form.amountCents || "0") <= 0} onClick={add}>Create</Button>
            </div>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
          <th className="px-4 py-3">Deposit #</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">Amount</th>
          <th className="px-4 py-3">Date</th>
          <th className="px-4 py-3">Note</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
          {!loading && deposits.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No deposits yet</td></tr>}
          {deposits.map(d => (
            <tr key={d.id}>
              <td className="px-4 py-3 font-medium">{d.batch_number}</td>
              <td className={`px-4 py-3 capitalize font-medium ${statusColor(d.status)}`}>{d.status.replace(/_/g, " ")}</td>
              <td className="px-4 py-3">{formatMoney(d.total_cents)}</td>
              <td className="px-4 py-3 text-slate-500">{new Date(d.created_at).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-slate-500">{d.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ─── Loyalty Tiers ───────────────────────────────────────────────────────────

interface LoyaltyTierRule {
  id: string;
  tier_level: number;
  name: string;
  min_points: number;
  point_multiplier: number;
  discount_pct: number;
}

const DEFAULT_TIERS = [
  { level: 1, name: "Bronze", minPoints: 0, multiplier: 1.0, discount: 0 },
  { level: 2, name: "Silver", minPoints: 500, multiplier: 1.25, discount: 2 },
  { level: 3, name: "Gold", minPoints: 1500, multiplier: 1.5, discount: 5 },
  { level: 4, name: "Platinum", minPoints: 5000, multiplier: 2.0, discount: 10 },
];

function LoyaltyTiersSection({ canManage, addToast }: { canManage: boolean; addToast: ReturnType<typeof useToast>["addToast"] }) {
  const [tiers, setTiers] = useState<LoyaltyTierRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", minPoints: "", pointMultiplier: "", discountPct: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: LoyaltyTierRule[] }>("/api/v1/customers/loyalty-tiers")
      .then(r => setTiers(r.items ?? []))
      .catch(() => setTiers([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (level: number) => {
    const existing = tiers.find(t => t.tier_level === level);
    const def = DEFAULT_TIERS.find(d => d.level === level);
    setForm({
      name: existing?.name ?? def?.name ?? "",
      minPoints: String(existing?.min_points ?? def?.minPoints ?? 0),
      pointMultiplier: String(existing?.point_multiplier ?? def?.multiplier ?? 1),
      discountPct: String(existing?.discount_pct ?? def?.discount ?? 0),
    });
    setEditing(level);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await apiPut(`/api/v1/customers/loyalty-tiers/${editing}`, {
        name: form.name.trim(),
        tierLevel: editing,
        minPoints: parseInt(form.minPoints, 10) || 0,
        pointMultiplier: parseFloat(form.pointMultiplier) || 1,
        discountPct: parseFloat(form.discountPct) || 0,
      });
      setEditing(null);
      load();
      addToast({ title: "Tier saved", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  const seedDefaults = async () => {
    setBusy(true);
    try {
      for (const d of DEFAULT_TIERS) {
        await apiPut(`/api/v1/customers/loyalty-tiers/${d.level}`, {
          name: d.name, tierLevel: d.level, minPoints: d.minPoints, pointMultiplier: d.multiplier, discountPct: d.discount,
        });
      }
      load();
      addToast({ title: "Default tiers created", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  const tierLabel = (level: number) => DEFAULT_TIERS.find(d => d.level === level)?.name ?? `Tier ${level}`;
  const tierColor = (level: number) => {
    return ["", "text-amber-700", "text-slate-500", "text-yellow-600", "text-violet-700"][level] ?? "text-slate-700";
  };

  return (
    <Card title="Loyalty Tier Rules" className="overflow-hidden">
      <p className="text-sm text-slate-500 mb-4">
        Configure named tiers (Bronze → Platinum) with point thresholds, earn multipliers, and automatic purchase discounts.
        Customers auto-upgrade when their point balance crosses a tier threshold.
      </p>
      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />)}</div>
      ) : (
        <>
          {tiers.length === 0 && (
            <div className="mb-4 rounded-md border border-dashed border-slate-200 p-4 text-center">
              <p className="text-sm text-slate-500">No tier rules configured.</p>
              {canManage && (
                <button onClick={seedDefaults} disabled={busy} className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
                  Seed default tiers (Bronze / Silver / Gold / Platinum)
                </button>
              )}
            </div>
          )}
          <div className="space-y-2">
            {[1, 2, 3, 4].map(level => {
              const rule = tiers.find(t => t.tier_level === level);
              return (
                <div key={level} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <span className={`font-semibold ${tierColor(level)}`}>{rule?.name ?? tierLabel(level)}</span>
                    {rule ? (
                      <span className="ml-3 text-xs text-slate-500">
                        ≥{rule.min_points.toLocaleString()} pts · {rule.point_multiplier}× earn · {rule.discount_pct}% discount
                      </span>
                    ) : (
                      <span className="ml-3 text-xs text-slate-400 italic">not configured</span>
                    )}
                  </div>
                  {canManage && (
                    <button onClick={() => openEdit(level)} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
                      {rule ? "Edit" : "Configure"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {editing !== null && (
        <div className="mt-4 rounded-md border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="font-semibold text-slate-900">Edit Tier {editing}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" placeholder="e.g. Gold" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Min Points</label>
              <input type="number" value={form.minPoints} onChange={e => setForm(f => ({ ...f, minPoints: e.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Point Multiplier</label>
              <input type="number" step="0.25" value={form.pointMultiplier} onChange={e => setForm(f => ({ ...f, pointMultiplier: e.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Discount %</label>
              <input type="number" step="0.5" value={form.discountPct} onChange={e => setForm(f => ({ ...f, discountPct: e.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={busy || !form.name.trim()} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-slate-800">
              {busy ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(null)} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
  return `${Math.floor(diffMonths / 12)} year${Math.floor(diffMonths / 12) > 1 ? "s" : ""} ago`;
}

const ALL_SCOPES = ["read", "write", "admin"] as const;

function ApiKeysSection({ canManage, addToast }: { canManage: boolean; addToast: ReturnType<typeof useToast>["addToast"] }) {
  const [items, setItems] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", scopes: [] as string[], expiresAt: "" });
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; copied: boolean } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: ApiKey[] }>("/api/identity/api-keys")
      .then(r => setItems(r.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: form.name.trim() };
      if (form.scopes.length > 0) body.scopes = JSON.stringify(form.scopes);
      if (form.expiresAt) body.expiresAt = form.expiresAt;
      const res = await apiPost<{ id: string; key: string; prefix: string }>("/api/identity/api-keys", body);
      setNewKey({ key: res.key, copied: false });
      setShowForm(false);
      setForm({ name: "", scopes: [], expiresAt: "" });
      load();
      addToast({ title: "API key created", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed to create key", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await apiDelete(`/api/identity/api-keys/${id}`);
      setDeleteTarget(null);
      if (newKey) setNewKey(null);
      load();
      addToast({ title: "API key revoked", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed to revoke key", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  const toggleScope = (scope: string) => {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(scope) ? f.scopes.filter(s => s !== scope) : [...f.scopes, scope],
    }));
  };

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey.key);
      setNewKey(k => k ? { ...k, copied: true } : k);
    } catch {
      // clipboard not available
    }
  };

  return (
    <>
      <ConfirmDialog
        open={!!deleteTarget}
        title="Revoke API key"
        message={`Revoke key "${deleteTarget?.name}"? Any integrations using this key will stop working immediately.`}
        confirmLabel="Revoke"
        destructive
        onConfirm={() => deleteTarget && void revoke(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">API Keys</h2>
            <p className="text-sm text-slate-500">API keys grant programmatic access to FinderPOS. Only show the full key once at creation — it cannot be retrieved again.</p>
          </div>
          {canManage && !showForm && (
            <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>Create key</Button>
          )}
        </div>

        {/* New key callout */}
        {newKey && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-4">
            <div className="flex items-start gap-3">
              <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-amber-600">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800">Your new API key (shown once)</p>
                <p className="mt-1 text-xs text-amber-700">Copy this key now. You will not be able to see it again after you dismiss this notice.</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate rounded bg-amber-100 px-3 py-1.5 font-mono text-xs text-amber-950 border border-amber-200">
                    {newKey.key}
                  </code>
                  <Button size="sm" variant="secondary" onClick={() => void copyKey()}>
                    {newKey.copied ? "Copied!" : "Copy"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setNewKey(null)}>Dismiss</Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Inline create form */}
        {showForm && canManage && (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
            <div className="flex flex-wrap gap-3">
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Key name (e.g. Shopify integration)"
                className="flex-1 min-w-48 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
              />
              <input
                type="date"
                value={form.expiresAt}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                className="w-44 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                title="Expiry date (optional)"
              />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-xs font-semibold uppercase text-slate-500">Scopes</span>
              {ALL_SCOPES.map(scope => (
                <label key={scope} className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={form.scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                  <span className="capitalize">{scope}</span>
                </label>
              ))}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button size="sm" variant="primary" loading={busy} disabled={!form.name.trim()} onClick={() => void create()}>Create</Button>
              </div>
            </div>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              <th className="px-4 py-3">Key name</th>
              <th className="px-4 py-3">Prefix</th>
              <th className="px-4 py-3">Scopes</th>
              <th className="px-4 py-3">Last used</th>
              <th className="px-4 py-3">Expires</th>
              {canManage && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No API keys. Create one to enable programmatic access.</td></tr>
            )}
            {items.map(key => {
              let parsedScopes: string[] = [];
              try { parsedScopes = JSON.parse(key.scopes ?? "[]"); } catch { parsedScopes = []; }
              return (
                <tr key={key.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-950">{key.name}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                      {key.key_prefix}{"••••••••"}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {parsedScopes.length > 0 ? parsedScopes.join(", ") : "all"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {key.last_used_at ? relativeTime(key.last_used_at) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {key.expires_at ? new Date(key.expires_at).toLocaleDateString() : "Never"}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="danger" onClick={() => setDeleteTarget(key)}>Revoke</Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

// ─── Currencies ───────────────────────────────────────────────────────────────

interface Currency {
  currency_code: string;
  currency_name: string;
  symbol: string;
  exchange_rate: number;
  is_base: boolean;
  is_active: boolean;
}

function CurrenciesSection() {
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
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No currencies configured
                </td>
              </tr>
            )}
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
                  {c.is_active
                    ? <Badge variant="green">Active</Badge>
                    : <Badge variant="gray">Inactive</Badge>}
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-950 break-words">{value}</p>
    </div>
  );
}

function SecurityRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <span className="text-slate-600">{label}</span>
      <span className={`font-semibold ${ok ? "text-emerald-700" : "text-slate-500"}`}>{value}</span>
    </div>
  );
}

function SectionButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[44px] rounded-md px-3 text-left text-sm font-medium transition-colors ${active ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"}`}
    >
      {label}
    </button>
  );
}
