"use client";

import { useState } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiPatch } from "@/api-client/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type ApprovalMode = "auto" | "manual";
type PaymentTerm = "cod" | "net15" | "net30" | "net60";

interface CustomerGroup {
  id: string;
  name: string;
  discountPct: number;
  minOrderCents: number;
}

const TERM_LABELS: Record<PaymentTerm, string> = {
  cod:   "Cash on Delivery",
  net15: "Net 15",
  net30: "Net 30",
  net60: "Net 60",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-[#111]">{title}</p>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
        checked ? "bg-brand-600" : "bg-slate-200"
      }`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function B2BSettingsPage() {
  const [enabled, setEnabled] = useState(false);
  const [approval, setApproval] = useState<ApprovalMode>("manual");
  const [paymentTerm, setPaymentTerm] = useState<PaymentTerm>("net30");
  const [showPricesToGuests, setShowPricesToGuests] = useState(false);
  const [creditLimitEnforced, setCreditLimitEnforced] = useState(true);
  const [groups, setGroups] = useState<CustomerGroup[]>([
    { id: "gold",   name: "Gold",   discountPct: 20, minOrderCents: 50000 },
    { id: "silver", name: "Silver", discountPct: 12, minOrderCents: 25000 },
    { id: "bronze", name: "Bronze", discountPct: 5,  minOrderCents: 10000 },
  ]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateGroup = (id: string, field: keyof CustomerGroup, value: string | number) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, [field]: value } : g)),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPatch<{ ok: boolean }>("/api/v1/settings/b2b", {
        enabled,
        approval,
        paymentTerm,
        showPricesToGuests,
        creditLimitEnforced,
        groups,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const PORTAL_URL = "https://finder-pos.app/b2b/portal";

  return (
    <EnterpriseShell
      active="b2b-settings"
      title="B2B Portal"
      subtitle="Wholesale buyer configuration"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-[#111]">B2B / Wholesale Portal</h1>
          <p className="mt-1 text-sm text-slate-500">
            Configure customer pricing tiers, credit terms, and order approval for wholesale buyers.
          </p>
        </div>

        {/* ── Enable ────────────────────────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div>
            <p className="font-semibold text-[#111]">Enable B2B Portal</p>
            <p className="text-sm text-slate-500">
              Activates wholesale pricing, quotes, and the buyer-facing portal.
            </p>
          </div>
          <ToggleSwitch checked={enabled} onChange={setEnabled} />
        </div>

        {enabled && (
          <div className="space-y-4">

            {/* ── Portal URL ─────────────────────────────────────────── */}
            <SectionCard
              title="Buyer Portal URL"
              subtitle="Share this link with your wholesale customers."
            >
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="flex-1 select-all font-mono text-sm text-slate-700">
                  {PORTAL_URL}
                </span>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(PORTAL_URL)}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                >
                  Copy
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Buyers log in with their account credentials to browse products and place orders.
              </p>
            </SectionCard>

            {/* ── Customer groups ────────────────────────────────────── */}
            <SectionCard
              title="Customer Groups"
              subtitle="Assign buyers to groups with automatic pricing discounts."
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="pb-2 pr-3">Group</th>
                    <th className="pb-2 pr-3 text-right">Discount off retail</th>
                    <th className="pb-2 text-right">Min. order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groups.map((group) => (
                    <tr key={group.id} className="align-middle">
                      <td className="py-2 pr-3 font-semibold text-[#111]">{group.name}</td>
                      <td className="py-2 pr-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={group.discountPct}
                            onChange={(e) =>
                              updateGroup(group.id, "discountPct", Number(e.target.value))
                            }
                            className="w-16 rounded border border-slate-200 px-2 py-1 text-right text-sm focus:border-brand-600 focus:outline-none"
                          />
                          <span className="text-slate-400">%</span>
                        </div>
                      </td>
                      <td className="py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <span className="text-slate-400">$</span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={group.minOrderCents / 100}
                            onChange={(e) =>
                              updateGroup(
                                group.id,
                                "minOrderCents",
                                Math.round(Number(e.target.value) * 100),
                              )
                            }
                            className="w-20 rounded border border-slate-200 px-2 py-1 text-right text-sm focus:border-brand-600 focus:outline-none"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>

            {/* ── Payment terms ──────────────────────────────────────── */}
            <SectionCard
              title="Default Payment Terms"
              subtitle="Applied to new wholesale accounts unless overridden per customer."
            >
              <div className="flex flex-wrap gap-2">
                {(["cod", "net15", "net30", "net60"] as PaymentTerm[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPaymentTerm(t)}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      paymentTerm === t
                        ? "bg-brand-600 text-white"
                        : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {TERM_LABELS[t]}
                  </button>
                ))}
              </div>
            </SectionCard>

            {/* ── Order approval ─────────────────────────────────────── */}
            <SectionCard
              title="Order Approval"
              subtitle="Control whether wholesale orders need manual review before confirmation."
            >
              <div className="flex gap-2">
                {(["auto", "manual"] as ApprovalMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setApproval(mode)}
                    className={`flex-1 rounded-lg border py-2.5 text-sm font-medium transition-colors ${
                      approval === mode
                        ? "border-brand-600 bg-brand-600/5 text-brand-600"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {mode === "auto" ? "Automatic" : "Manual review"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {approval === "auto"
                  ? "Orders are confirmed immediately and sent to fulfilment."
                  : "A manager must approve each order before it moves to fulfilment."}
              </p>
            </SectionCard>

            {/* ── Other settings ─────────────────────────────────────── */}
            <SectionCard title="Other Settings">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#111]">Show prices to guests</p>
                    <p className="text-xs text-slate-400">
                      Allow non-logged-in visitors to see wholesale prices.
                    </p>
                  </div>
                  <ToggleSwitch checked={showPricesToGuests} onChange={setShowPricesToGuests} />
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-sm font-medium text-[#111]">Enforce credit limits</p>
                    <p className="text-xs text-slate-400">
                      Block checkout when a buyer exceeds their account credit limit.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={creditLimitEnforced}
                    onChange={setCreditLimitEnforced}
                  />
                </div>
              </div>
            </SectionCard>

            {/* ── Mode link notice ────────────────────────────────────── */}
            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>
                B2B mode must also be enabled in{" "}
                <Link href="/settings/modes" className="font-medium text-brand-600 hover:underline">
                  Business Modes
                </Link>{" "}
                to activate wholesale features for your team.
              </p>
            </div>
          </div>
        )}

        {/* ── Save ──────────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-end gap-3">
          {saved && (
            <span className="text-sm font-medium text-emerald-600">Saved successfully</span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>

      </div>
    </EnterpriseShell>
  );
}
