"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/api-client/client";
import type { useToast } from "@/components/Toast";

interface CustomerAddress {
  id: string;
  address_type: string;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  is_default: boolean;
}

type AddrForm = {
  address_type: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  is_default: boolean;
};

const BLANK_ADDR: AddrForm = {
  address_type: "billing",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  zip: "",
  country: "US",
  is_default: false,
};

export function AddressesTab({
  customerId,
  canEdit,
  addToast,
}: {
  customerId: string;
  canEdit: boolean;
  addToast: ReturnType<typeof useToast>["addToast"];
}) {
  const [items, setItems] = useState<CustomerAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AddrForm>(BLANK_ADDR);
  const [editTarget, setEditTarget] = useState<CustomerAddress | null>(null);
  const [editForm, setEditForm] = useState<AddrForm>(BLANK_ADDR);
  const [deleteTarget, setDeleteTarget] = useState<CustomerAddress | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: CustomerAddress[] }>(`/api/v1/customers/${customerId}/addresses`)
      .then((r) => setItems(r.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!form.address_line1.trim() || !form.city.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/api/v1/customers/${customerId}/addresses`, {
        addressType: form.address_type,
        addressLine1: form.address_line1.trim(),
        addressLine2: form.address_line2.trim() || null,
        city: form.city.trim(),
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        country: form.country || "US",
        isDefault: form.is_default,
      });
      setShowForm(false);
      setForm(BLANK_ADDR);
      load();
      addToast({ title: "Address added", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (addr: CustomerAddress) => {
    setEditTarget(addr);
    setEditForm({
      address_type: addr.address_type,
      address_line1: addr.address_line1 ?? "",
      address_line2: addr.address_line2 ?? "",
      city: addr.city ?? "",
      state: addr.state ?? "",
      zip: addr.zip ?? "",
      country: addr.country ?? "US",
      is_default: addr.is_default,
    });
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setBusy(true);
    try {
      await apiPatch(`/api/v1/customers/${customerId}/addresses/${editTarget.id}`, {
        addressType: editForm.address_type,
        addressLine1: editForm.address_line1.trim() || null,
        addressLine2: editForm.address_line2.trim() || null,
        city: editForm.city.trim() || null,
        state: editForm.state.trim() || null,
        zip: editForm.zip.trim() || null,
        country: editForm.country || null,
        isDefault: editForm.is_default,
      });
      setEditTarget(null);
      load();
      addToast({ title: "Address updated", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await apiDelete(`/api/v1/customers/${customerId}/addresses/${id}`);
      setDeleteTarget(null);
      load();
      addToast({ title: "Address removed", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove address"
        message={`Remove this ${deleteTarget?.address_type ?? ""} address?`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => deleteTarget && void remove(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setEditTarget(null)}
        >
          <div
            className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-slate-900">Edit Address</h2>
            <div className="space-y-3">
              <div className="flex gap-3">
                <select
                  value={editForm.address_type}
                  onChange={(e) => setEditForm((f) => ({ ...f, address_type: e.target.value }))}
                  className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                >
                  <option value="billing">Billing</option>
                  <option value="shipping">Shipping</option>
                </select>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.is_default}
                    onChange={(e) => setEditForm((f) => ({ ...f, is_default: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                  Default
                </label>
              </div>
              <input
                value={editForm.address_line1}
                onChange={(e) => setEditForm((f) => ({ ...f, address_line1: e.target.value }))}
                placeholder="Address line 1"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
              />
              <input
                value={editForm.address_line2}
                onChange={(e) => setEditForm((f) => ({ ...f, address_line2: e.target.value }))}
                placeholder="Address line 2"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
              />
              <div className="flex gap-3">
                <input
                  value={editForm.city}
                  onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))}
                  placeholder="City"
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                />
                <input
                  value={editForm.state}
                  onChange={(e) => setEditForm((f) => ({ ...f, state: e.target.value }))}
                  placeholder="State"
                  className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                />
                <input
                  value={editForm.zip}
                  onChange={(e) => setEditForm((f) => ({ ...f, zip: e.target.value }))}
                  placeholder="ZIP"
                  className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} onClick={() => void saveEdit()}>Save</Button>
            </div>
          </div>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-950">Addresses</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {items.length}
            </span>
          </div>
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Cancel" : "+ Add address"}
            </Button>
          )}
        </div>

        {showForm && canEdit && (
          <div className="space-y-3 border-b border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex flex-wrap gap-3">
              <select
                value={form.address_type}
                onChange={(e) => setForm((f) => ({ ...f, address_type: e.target.value }))}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
              >
                <option value="billing">Billing</option>
                <option value="shipping">Shipping</option>
              </select>
              <input
                value={form.address_line1}
                onChange={(e) => setForm((f) => ({ ...f, address_line1: e.target.value }))}
                placeholder="Address line 1 (required)"
                className="min-w-48 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
              />
              <input
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="City (required)"
                className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
              />
              <input
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                placeholder="State"
                className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
              />
              <input
                value={form.zip}
                onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
                placeholder="ZIP"
                className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                />
                Set as default
              </label>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setShowForm(false); setForm(BLANK_ADDR); }}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy}
                  disabled={!form.address_line1.trim() || !form.city.trim()}
                  onClick={() => void add()}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3">City / State / ZIP</th>
              <th className="px-4 py-3">Default</th>
              {canEdit && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No addresses yet.</td></tr>
            )}
            {items.map((addr) => (
              <tr key={addr.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 capitalize text-slate-700">{addr.address_type}</td>
                <td className="px-4 py-3">
                  <p>{addr.address_line1}</p>
                  {addr.address_line2 && (
                    <p className="text-xs text-slate-500">{addr.address_line2}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {[addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}
                </td>
                <td className="px-4 py-3">
                  {addr.is_default ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                      Default
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                {canEdit && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => startEdit(addr)}
                        className="text-xs text-slate-500 underline hover:text-slate-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(addr)}
                        className="text-xs text-red-500 underline hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
