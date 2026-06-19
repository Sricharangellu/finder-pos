"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPatch, apiPost } from "@/api-client/client";
import { useToast } from "@/components/Toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type RuleType = "simple" | "volume" | "bxgy";
type DiscountType = "fixed" | "percent";
type ApplyTo = "order" | "product" | "category";
type DiscountStatus = "active" | "paused" | "archived";

interface Discount {
  id: string;
  name: string;
  coupon_code: string | null;
  rule_type: RuleType;
  discount_type: DiscountType;
  value: number;
  apply_to: ApplyTo;
  status: DiscountStatus;
  auto_applicable: number;
  used_count: number;
  usage_limit: number | null;
  start_date?: string | null;
  end_date?: string | null;
  min_order_cents?: number | null;
  min_qty?: number | null;
  buy_qty?: number | null;
  get_qty?: number | null;
  tier_restriction?: number | null;
  per_customer_limit?: number | null;
}

interface NewDiscountForm {
  name: string;
  rule_type: RuleType;
  discount_type: DiscountType;
  value: string;
  apply_to: ApplyTo;
  coupon_code: string;
  auto_applicable: boolean;
  min_order_cents: string;
  min_qty: string;
  buy_qty: string;
  get_qty: string;
  usage_limit: string;
  per_customer_limit: string;
  start_date: string;
  end_date: string;
  tier_restriction: string;
}

const defaultForm: NewDiscountForm = {
  name: "",
  rule_type: "simple",
  discount_type: "percent",
  value: "",
  apply_to: "order",
  coupon_code: "",
  auto_applicable: false,
  min_order_cents: "",
  min_qty: "",
  buy_qty: "",
  get_qty: "",
  usage_limit: "",
  per_customer_limit: "",
  start_date: "",
  end_date: "",
  tier_restriction: "",
};

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "active"
      ? "bg-green-100 text-green-800"
      : status === "paused"
      ? "bg-yellow-100 text-yellow-800"
      : "bg-gray-100 text-gray-600";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${classes}`}
    >
      {status}
    </span>
  );
}

// ─── Rule type badge ─────────────────────────────────────────────────────────

function RuleTypeBadge({ ruleType }: { ruleType: string }) {
  const label =
    ruleType === "bxgy" ? "Buy X Get Y" : ruleType === "volume" ? "Volume" : "Simple";
  const classes =
    ruleType === "bxgy"
      ? "bg-purple-100 text-purple-800"
      : ruleType === "volume"
      ? "bg-blue-100 text-blue-800"
      : "bg-brand-100 text-brand-800";
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

// ─── Status actions dropdown ──────────────────────────────────────────────────

function StatusActionsDropdown({
  discount,
  onStatusChange,
  onEdit,
}: {
  discount: Discount;
  onStatusChange: (id: string, status: DiscountStatus) => void;
  onEdit: (discount: Discount) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const allActions = [
    { label: "Activate", status: "active" },
    { label: "Pause", status: "paused" },
    { label: "Archive", status: "archived" },
  ] satisfies { label: string; status: DiscountStatus }[];
  const actions = allActions.filter((a) => a.status !== discount.status);

  return (
    <div className="relative" ref={ref}>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        Actions
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="py-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEdit(discount);
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100"
            >
              Edit
            </button>
            {actions.map((a) => (
              <button
                key={a.status}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onStatusChange(discount.id, a.status);
                }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New discount slide-over panel ────────────────────────────────────────────

function NewDiscountPanel({
  open,
  onClose,
  onCreated,
  editingDiscount,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  editingDiscount: Discount | null;
}) {
  const { addToast } = useToast();
  const [form, setForm] = useState<NewDiscountForm>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingDiscount) {
      setForm({
        name: editingDiscount.name,
        rule_type: editingDiscount.rule_type,
        discount_type: editingDiscount.discount_type,
        value: editingDiscount.discount_type === "fixed" 
          ? (editingDiscount.value / 100).toFixed(2) 
          : String(editingDiscount.value),
        apply_to: editingDiscount.apply_to,
        coupon_code: editingDiscount.coupon_code || "",
        auto_applicable: editingDiscount.auto_applicable === 1,
        min_order_cents: editingDiscount.min_order_cents 
          ? (editingDiscount.min_order_cents / 100).toFixed(2) 
          : "",
        min_qty: editingDiscount.min_qty ? String(editingDiscount.min_qty) : "",
        buy_qty: editingDiscount.buy_qty ? String(editingDiscount.buy_qty) : "",
        get_qty: editingDiscount.get_qty ? String(editingDiscount.get_qty) : "",
        usage_limit: editingDiscount.usage_limit ? String(editingDiscount.usage_limit) : "",
        per_customer_limit: editingDiscount.per_customer_limit ? String(editingDiscount.per_customer_limit) : "",
        start_date: editingDiscount.start_date ? new Date(Number(editingDiscount.start_date)).toISOString().split("T")[0] : "",
        end_date: editingDiscount.end_date ? new Date(Number(editingDiscount.end_date)).toISOString().split("T")[0] : "",
        tier_restriction: editingDiscount.tier_restriction ? String(editingDiscount.tier_restriction) : "",
      });
    } else {
      setForm(defaultForm);
    }
  }, [editingDiscount, open]);

  function set<K extends keyof NewDiscountForm>(key: K, value: NewDiscountForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    const numValue = parseFloat(form.value);
    if (isNaN(numValue) || numValue <= 0) {
      setError("Discount value must be a positive number.");
      return;
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      ruleType: form.rule_type,
      discountType: form.discount_type,
      value: form.discount_type === "fixed" ? Math.round(numValue * 100) : numValue,
      applyTo: form.apply_to === "order" ? "cart" : form.apply_to, // normalize order->cart
      autoApplicable: form.coupon_code ? false : form.auto_applicable,
    };

    if (form.coupon_code.trim()) payload.couponCode = form.coupon_code.trim().toUpperCase();
    if (form.min_order_cents.trim()) {
      const dollars = parseFloat(form.min_order_cents);
      if (!isNaN(dollars)) payload.minOrderCents = Math.round(dollars * 100);
    }
    if (form.usage_limit.trim()) {
      const n = parseInt(form.usage_limit, 10);
      if (!isNaN(n) && n > 0) payload.usageLimit = n;
    }
    if (form.per_customer_limit.trim()) {
      const n = parseInt(form.per_customer_limit, 10);
      if (!isNaN(n) && n > 0) payload.perCustomerLimit = n;
    }
    if (form.start_date) payload.startDate = new Date(form.start_date + "T00:00:00").getTime();
    if (form.end_date) payload.endDate = new Date(form.end_date + "T23:59:59").getTime();
    if (form.tier_restriction.trim()) {
      const parts = form.tier_restriction.split(",").map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
      if (parts.length > 0) payload.tierRestriction = parts;
    }
    if (form.rule_type === "volume" && form.min_qty.trim()) {
      const n = parseInt(form.min_qty, 10);
      if (!isNaN(n) && n > 0) payload.minQty = n;
    }
    if (form.rule_type === "bxgy") {
      const buyQty = parseInt(form.buy_qty, 10);
      const getQty = parseInt(form.get_qty, 10);
      if (!isNaN(buyQty) && buyQty > 0) payload.buyQty = buyQty;
      if (!isNaN(getQty) && getQty > 0) payload.getQty = getQty;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (editingDiscount) {
        await apiPatch(`/api/v1/discounts/${editingDiscount.id}`, payload);
        addToast({ title: "Discount updated", variant: "success" });
      } else {
        await apiPost("/api/v1/discounts", payload);
        addToast({ title: "Discount created", variant: "success" });
      }
      setForm(defaultForm);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save discount.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const inputCls =
    "min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600";
  const labelCls = "block text-xs font-medium text-gray-700 mb-1";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-label="New discount"
        className="fixed right-0 top-0 z-40 h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">New Discount Rule</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-600 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-5">
          {error && (
            <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className={labelCls}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Summer Sale 20%"
              className={inputCls}
            />
          </div>

          {/* Rule type */}
          <div>
            <p className={labelCls}>Rule type</p>
            <div className="flex gap-3">
              {(["simple", "volume", "bxgy"] as const).map((rt) => (
                <label key={rt} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="rule_type"
                    value={rt}
                    checked={form.rule_type === rt}
                    onChange={() => set("rule_type", rt)}
                    className="h-4 w-4 border-gray-300 text-brand-600 focus:ring-brand-600"
                  />
                  <span className="text-sm text-gray-700 capitalize">
                    {rt === "bxgy" ? "Buy X Get Y" : rt}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Discount type + value */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className={labelCls}>Discount type</p>
              <div className="flex gap-3">
                {(["percent", "fixed"] as const).map((dt) => (
                  <label key={dt} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="discount_type"
                      value={dt}
                      checked={form.discount_type === dt}
                      onChange={() => set("discount_type", dt)}
                      className="h-4 w-4 border-gray-300 text-brand-600 focus:ring-brand-600"
                    />
                    <span className="text-sm text-gray-700 capitalize">{dt}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>
                Value {form.discount_type === "fixed" ? "($)" : "(%)"}
                <span className="text-red-500"> *</span>
              </label>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
                placeholder={form.discount_type === "fixed" ? "5.00" : "10"}
                className={inputCls}
              />
            </div>
          </div>

          {/* Apply to */}
          <div>
            <label className={labelCls}>Apply to</label>
            <select
              value={form.apply_to}
              onChange={(e) => set("apply_to", e.target.value as ApplyTo)}
              className={inputCls}
            >
              <option value="order">Order</option>
              <option value="product">Product</option>
              <option value="category">Category</option>
            </select>
          </div>

          {/* Coupon code */}
          <div>
            <label className={labelCls}>Coupon code (optional)</label>
            <input
              type="text"
              value={form.coupon_code}
              onChange={(e) => set("coupon_code", e.target.value.toUpperCase())}
              placeholder="e.g. SAVE20"
              className={inputCls}
            />
          </div>

          {/* Auto-applicable (only when no coupon code) */}
          {!form.coupon_code && (
            <div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.auto_applicable}
                  onChange={(e) => set("auto_applicable", e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600"
                />
                <span className="text-sm text-gray-700">
                  Auto-applicable (apply automatically without a code)
                </span>
              </label>
            </div>
          )}

          {/* Min order cents */}
          <div>
            <label className={labelCls}>Minimum order amount ($, optional)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.min_order_cents}
              onChange={(e) => set("min_order_cents", e.target.value)}
              placeholder="0.00"
              className={inputCls}
            />
          </div>

          {/* Volume: min qty */}
          {form.rule_type === "volume" && (
            <div>
              <label className={labelCls}>Minimum quantity</label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.min_qty}
                onChange={(e) => set("min_qty", e.target.value)}
                placeholder="e.g. 5"
                className={inputCls}
              />
            </div>
          )}

          {/* Buy X Get Y quantities */}
          {form.rule_type === "bxgy" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Buy quantity</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.buy_qty}
                  onChange={(e) => set("buy_qty", e.target.value)}
                  placeholder="e.g. 2"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Get quantity</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.get_qty}
                  onChange={(e) => set("get_qty", e.target.value)}
                  placeholder="e.g. 1"
                  className={inputCls}
                />
              </div>
            </div>
          )}

          {/* Usage limits */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Total usage limit (optional)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.usage_limit}
                onChange={(e) => set("usage_limit", e.target.value)}
                placeholder="Unlimited"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Per-customer limit (optional)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.per_customer_limit}
                onChange={(e) => set("per_customer_limit", e.target.value)}
                placeholder="Unlimited"
                className={inputCls}
              />
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start date (optional)</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => set("start_date", e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>End date (optional)</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => set("end_date", e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {/* Tier restriction */}
          <div>
            <label className={labelCls}>Tier restriction (1-5, optional)</label>
            <input
              type="number"
              min="1"
              max="5"
              step="1"
              value={form.tier_restriction}
              onChange={(e) => set("tier_restriction", e.target.value)}
              placeholder="No restriction"
              className={inputCls}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 border-t border-gray-100 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              fullWidth
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" fullWidth loading={submitting}>
              Create Discount
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DiscountsPage() {
  const { addToast } = useToast();
  const [items, setItems] = useState<Discount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await apiGet<{ items: Discount[] }>("/api/v1/discounts");
      setItems(r.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load discounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatusChange = async (id: string, status: DiscountStatus) => {
    setStatusBusy(id);
    try {
      await apiPatch(`/api/v1/discounts/${id}/status`, { status });
      addToast({
        title: `Discount ${status}`,
        description: `Status updated to ${status}.`,
        variant: "success",
      });
      await load();
    } catch (e) {
      addToast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Could not update status.",
        variant: "error",
      });
    } finally {
      setStatusBusy(null);
    }
  };

  const handleEdit = (discount: Discount) => {
    setEditingDiscount(discount);
    setPanelOpen(true);
  };

  function valueLabel(d: Discount) {
    if (d.rule_type === "bxgy") return "Buy/Get";
    return d.discount_type === "fixed" ? formatMoney(d.value) : `${d.value}%`;
  }

  return (
    <EnterpriseShell active="discounts" title="Discounts" subtitle="Promotions & coupon rules">
      <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6">
        {error && (
          <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <Card
          title="Discount Rules"
          description="Simple, volume, and Buy-X-Get-Y promotions with coupon or auto-apply."
          noPadding
        >
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
            <p className="text-sm text-gray-500">
              {items.length} rule{items.length !== 1 ? "s" : ""} configured
            </p>
            <Button variant="primary" size="sm" onClick={() => { setEditingDiscount(null); setPanelOpen(true); }}>
              + New Discount
            </Button>
          </div>

          {/* Table */}
          {loading ? (
            <div className="p-6 text-sm text-gray-500" aria-busy="true">
              Loading discounts…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                     <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Discount</th>
                    <th className="px-5 py-3">Coupon code</th>
                    <th className="px-5 py-3">Applies to</th>
                    <th className="px-5 py-3 text-right">Usage</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-400">
                        No discount rules yet. Create one to get started.
                      </td>
                    </tr>
                  )}
                  {items.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-5 py-3 font-medium text-gray-900">
                        {d.name}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        <RuleTypeBadge ruleType={d.rule_type} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-gray-700">
                        {valueLabel(d)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-gray-600">
                        {d.coupon_code ?? (d.auto_applicable ? (
                          <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700 not-italic font-sans text-xs">
                            auto
                          </span>
                        ) : "—")}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 capitalize text-gray-600">
                        {d.apply_to}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-gray-500">
                        {d.used_count}
                        {d.usage_limit != null ? `/${d.usage_limit}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        {statusBusy === d.id ? (
                          <span className="text-xs text-gray-400">Updating…</span>
                        ) : (
                          <StatusActionsDropdown
                            discount={d}
                            onStatusChange={handleStatusChange}
                            onEdit={handleEdit}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <NewDiscountPanel
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setEditingDiscount(null); }}
        onCreated={() => void load()}
        editingDiscount={editingDiscount}
      />
    </EnterpriseShell>
  );
}
