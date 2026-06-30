"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { apiPatch, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { Customer } from "./shared";
import { INPUT_CLASS, LABEL_CLASS, tierLabel, ReadField } from "./shared";

export function GeneralTab({
  customer,
  editMode,
  onSaved,
  onSaveError,
  onCancel,
}: {
  customer: Customer;
  editMode: boolean;
  onSaved: (updated: Customer) => void;
  onSaveError: (msg: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: customer.name,
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    company: customer.company ?? "",
    dba: customer.dba ?? "",
    taxId: customer.taxId ?? "",
    licenseNo: customer.licenseNo ?? "",
    state: customer.state ?? "",
    tier: customer.tier?.toString() ?? "",
    status: customer.status,
    billingAddress: customer.billingAddress ?? "",
    shippingAddress: customer.shippingAddress ?? "",
    creditLimitDollars: customer.credit_limit_cents != null ? (customer.credit_limit_cents / 100).toFixed(2) : "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      company: customer.company ?? "",
      dba: customer.dba ?? "",
      taxId: customer.taxId ?? "",
      licenseNo: customer.licenseNo ?? "",
      state: customer.state ?? "",
      tier: customer.tier?.toString() ?? "",
      status: customer.status,
      billingAddress: customer.billingAddress ?? "",
      shippingAddress: customer.shippingAddress ?? "",
      creditLimitDollars: customer.credit_limit_cents != null ? (customer.credit_limit_cents / 100).toFixed(2) : "",
    });
  }, [customer]);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const creditLimitCents = form.creditLimitDollars.trim()
        ? Math.round(parseFloat(form.creditLimitDollars) * 100)
        : null;
      const body: Record<string, unknown> = {
        name: form.name || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        company: form.company || undefined,
        dba: form.dba || undefined,
        taxId: form.taxId || undefined,
        licenseNo: form.licenseNo || undefined,
        state: form.state || undefined,
        tier: form.tier ? Number(form.tier) : undefined,
        status: form.status || undefined,
        billingAddress: form.billingAddress || undefined,
        shippingAddress: form.shippingAddress || undefined,
        creditLimitCents: creditLimitCents !== null && !isNaN(creditLimitCents) ? creditLimitCents : undefined,
      };
      const updated = await apiPatch<Customer>(`/api/v1/customers/${customer.id}`, body);
      onSaved(updated);
    } catch (err) {
      onSaveError(err instanceof ApiResponseError ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (editMode) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-100 px-4 py-3">
          <p className="text-sm font-medium text-slate-800">Editing customer profile</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              onClick={() => void handleSave()}
            >
              Save changes
            </Button>
          </div>
        </div>

        <Card title="Contact information">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LABEL_CLASS}>Name</label>
              <input type="text" value={form.name} onChange={(e) => update("name", e.target.value)} className={INPUT_CLASS} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Email</label>
              <input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} className={INPUT_CLASS} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Phone</label>
              <input type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} className={INPUT_CLASS} />
            </div>
          </div>
        </Card>

        <Card title="Business information">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>Company</label>
              <input type="text" value={form.company} onChange={(e) => update("company", e.target.value)} className={INPUT_CLASS} />
            </div>
            <div>
              <label className={LABEL_CLASS}>DBA</label>
              <input type="text" value={form.dba} onChange={(e) => update("dba", e.target.value)} className={INPUT_CLASS} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Tax ID</label>
              <input type="text" value={form.taxId} onChange={(e) => update("taxId", e.target.value)} className={INPUT_CLASS} />
            </div>
            <div>
              <label className={LABEL_CLASS}>License No.</label>
              <input type="text" value={form.licenseNo} onChange={(e) => update("licenseNo", e.target.value)} className={INPUT_CLASS} />
            </div>
            <div>
              <label className={LABEL_CLASS}>State</label>
              <input type="text" value={form.state} onChange={(e) => update("state", e.target.value)} placeholder="e.g. CA" className={INPUT_CLASS} />
            </div>
          </div>
        </Card>

        <Card title="Account settings">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>Tier</label>
              <select value={form.tier} onChange={(e) => update("tier", e.target.value)} className={INPUT_CLASS}>
                <option value="">Standard</option>
                <option value="1">Tier 1</option>
                <option value="2">Tier 2</option>
                <option value="3">Tier 3</option>
                <option value="4">Tier 4</option>
                <option value="5">Tier 5</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Status</label>
              <select value={form.status} onChange={(e) => update("status", e.target.value)} className={INPUT_CLASS}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS}>Credit Limit ($, optional)</label>
              <input type="number" min="0" step="0.01" value={form.creditLimitDollars} onChange={(e) => update("creditLimitDollars", e.target.value)} placeholder="No limit" className={INPUT_CLASS} />
              <p className="mt-1 text-xs text-slate-400">Leave empty for no credit limit (pay-as-you-go).</p>
            </div>
          </div>
        </Card>

        <Card title="Addresses">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>Billing Address</label>
              <textarea value={form.billingAddress} onChange={(e) => update("billingAddress", e.target.value)} rows={3} className={INPUT_CLASS} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Shipping Address</label>
              <textarea value={form.shippingAddress} onChange={(e) => update("shippingAddress", e.target.value)} rows={3} className={INPUT_CLASS} />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card title="Contact information">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ReadField label="Name" value={customer.name} />
          </div>
          <ReadField label="Email" value={customer.email} />
          <ReadField label="Phone" value={customer.phone} />
        </div>
      </Card>

      <Card title="Business information">
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadField label="Company" value={customer.company} />
          <ReadField label="DBA" value={customer.dba} />
          <ReadField label="Tax ID" value={customer.taxId} />
          <ReadField label="License No." value={customer.licenseNo} />
          <ReadField label="State" value={customer.state} />
        </div>
      </Card>

      <Card title="Account settings">
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadField label="Tier" value={tierLabel(customer.tier)} />
          <ReadField label="Status" value={customer.status} />
          <ReadField label="Loyalty Points" value={String(customer.points)} />
          {customer.credit_limit_cents !== undefined && (
            <ReadField label="Credit Limit" value={formatMoney(customer.credit_limit_cents)} />
          )}
        </div>
      </Card>

      <Card title="Addresses">
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadField label="Billing Address" value={customer.billingAddress} />
          <ReadField label="Shipping Address" value={customer.shippingAddress} />
        </div>
      </Card>
    </div>
  );
}
