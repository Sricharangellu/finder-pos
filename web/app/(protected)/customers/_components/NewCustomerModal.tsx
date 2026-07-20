"use client";

import { useState } from "react";
import { invalidateQuery } from "@/lib/useQuery";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { apiPost, errorMessage, fieldErrors } from "@/api-client/client";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  name: "", email: "", phone: "", notes: "", dateOfBirthStr: "",
  company: "", contactPerson: "", taxId: "", licenseNo: "",
  dba: "", state: "", billingAddress: "", shippingAddress: "",
  creditLimitDollars: "", tier: "5", salesRepId: "",
});

// ── FormField helper ──────────────────────────────────────────────────────────

function FormField({ label, required, hint, error, children }: {
  label: string; required?: boolean; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-slate-700">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
        {hint && <span className="ml-1 text-xs font-normal text-slate-400">{hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

const inputCls = "form-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-700";

// ── NewCustomerModal ──────────────────────────────────────────────────────────

export function NewCustomerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<NewCustomerForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Per-field validation messages from the backend (`error.details`), keyed by
  // the API payload field name (not the local form-state key).
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  function setField<K extends keyof NewCustomerForm>(key: K, value: NewCustomerForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setFieldErrs({});
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
      setForm(emptyForm());
      invalidateQuery("customers:list");
      onClose();
    } catch (err) {
      setFieldErrs(fieldErrors(err));
      setSaveError(errorMessage(err, "Failed to create customer."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Customer"
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          {saveError && <p role="alert" className="text-sm text-red-600">{saveError}</p>}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="new-customer-form" variant="primary" size="sm" disabled={saving}>
              {saving ? "Creating..." : "Create customer"}
            </Button>
          </div>
        </div>
      }
    >
      <form id="new-customer-form" onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
        {/* Customer type toggle */}
        <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {(["retail", "business"] as CustomerType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setField("customerType", t)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-colors ${
                form.customerType === t
                  ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "retail" ? "Retail Customer" : "Business Account"}
            </button>
          ))}
        </div>

        {form.customerType === "retail" ? (
          <div className="grid gap-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Customer details</p>
            <FormField label="Full name" required error={fieldErrs.name}>
              <input type="text" value={form.name} onChange={(e) => setField("name", e.target.value)}
                required placeholder="Ada Lovelace" className={inputCls} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Phone" hint="Required for loyalty" error={fieldErrs.phone}>
                <input type="tel" value={form.phone} onChange={(e) => setField("phone", e.target.value)}
                  placeholder="+1 (555) 000-0000" className={inputCls} />
              </FormField>
              <FormField label="Email" error={fieldErrs.email}>
                <input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)}
                  placeholder="ada@example.com" className={inputCls} />
              </FormField>
            </div>
            <FormField label="Date of birth" hint="Optional — used for age verification and birthday rewards" error={fieldErrs.dateOfBirth}>
              <input type="date" value={form.dateOfBirthStr} onChange={(e) => setField("dateOfBirthStr", e.target.value)}
                className={inputCls} />
            </FormField>
            <FormField label="Notes" error={fieldErrs.notes}>
              <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)}
                rows={2} placeholder="Preferences, allergies, or other notes"
                className={`${inputCls} resize-none`} />
            </FormField>
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Company information</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Company name" required error={fieldErrs.company}>
                <input type="text" value={form.company} onChange={(e) => setField("company", e.target.value)}
                  required placeholder="Acme Corp" className={inputCls} />
              </FormField>
              <FormField label="DBA (doing business as)" hint="Optional" error={fieldErrs.dba}>
                <input type="text" value={form.dba} onChange={(e) => setField("dba", e.target.value)}
                  placeholder="Acme Retail" className={inputCls} />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Tax ID / EIN" required error={fieldErrs.taxId}>
                <input type="text" value={form.taxId} onChange={(e) => setField("taxId", e.target.value)}
                  required placeholder="12-3456789" className={inputCls} />
              </FormField>
              <FormField label="License no." hint="Optional" error={fieldErrs.licenseNo}>
                <input type="text" value={form.licenseNo} onChange={(e) => setField("licenseNo", e.target.value)}
                  placeholder="LIC-0001" className={inputCls} />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="State" required error={fieldErrs.state}>
                <input type="text" value={form.state} onChange={(e) => setField("state", e.target.value)}
                  required maxLength={2} placeholder="CA" className={`${inputCls} uppercase`} />
              </FormField>
              <FormField label="Payment tier (1–5)" hint="1=VIP, 5=standard" error={fieldErrs.tier}>
                <select value={form.tier} onChange={(e) => setField("tier", e.target.value)} className={inputCls}>
                  {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </FormField>
            </div>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Primary contact</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Contact person" required error={fieldErrs.contactPerson ?? fieldErrs.name}>
                <input type="text" value={form.contactPerson} onChange={(e) => setField("contactPerson", e.target.value)}
                  required placeholder="Jane Smith" className={inputCls} />
              </FormField>
              <FormField label="Phone" required error={fieldErrs.phone}>
                <input type="tel" value={form.phone} onChange={(e) => setField("phone", e.target.value)}
                  required placeholder="+1 (555) 000-0000" className={inputCls} />
              </FormField>
            </div>
            <FormField label="Email" error={fieldErrs.email}>
              <input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)}
                placeholder="billing@acmecorp.com" className={inputCls} />
            </FormField>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Addresses</p>
            <FormField label="Billing address" required error={fieldErrs.billingAddress}>
              <textarea value={form.billingAddress} onChange={(e) => setField("billingAddress", e.target.value)}
                required rows={2} placeholder="123 Main St, Suite 100, Los Angeles, CA 90001"
                className={`${inputCls} resize-none`} />
            </FormField>
            <FormField label="Shipping address" hint="Leave blank to use billing address" error={fieldErrs.shippingAddress}>
              <textarea value={form.shippingAddress} onChange={(e) => setField("shippingAddress", e.target.value)}
                rows={2} placeholder="Same as billing" className={`${inputCls} resize-none`} />
            </FormField>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Account settings</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Credit limit ($)" hint="Optional — leave blank for prepay only" error={fieldErrs.creditLimitCents}>
                <input type="number" value={form.creditLimitDollars} onChange={(e) => setField("creditLimitDollars", e.target.value)}
                  min="0" step="0.01" placeholder="0.00" className={inputCls} />
              </FormField>
              <FormField label="Sales rep ID" hint="Optional" error={fieldErrs.salesRepId}>
                <input type="text" value={form.salesRepId} onChange={(e) => setField("salesRepId", e.target.value)}
                  placeholder="rep_..." className={inputCls} />
              </FormField>
            </div>
            <FormField label="Notes" error={fieldErrs.notes}>
              <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)}
                rows={2} placeholder="Account notes, special terms, or reminders"
                className={`${inputCls} resize-none`} />
            </FormField>
          </div>
        )}
      </form>
    </Modal>
  );
}
