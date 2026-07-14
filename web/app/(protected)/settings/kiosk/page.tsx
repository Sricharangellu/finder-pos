"use client";

import { useState } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";

// ── Types ─────────────────────────────────────────────────────────────────────

type PaymentMethod = "card" | "cash" | "loyalty" | "gift_card";

const METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Credit / Debit Card",
  cash: "Cash",
  loyalty: "Loyalty Points",
  gift_card: "Gift Card",
};

const TIMEOUT_OPTIONS = [
  { value: "30",  label: "30 seconds" },
  { value: "60",  label: "1 minute" },
  { value: "120", label: "2 minutes" },
  { value: "300", label: "5 minutes" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-[#111]">{label}</p>
        {description && <p className="text-xs text-slate-400">{description}</p>}
      </div>
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
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KioskSettingsPage() {
  const [enabled, setEnabled] = useState(false);
  const [pin, setPin] = useState("1234");
  const [showPin, setShowPin] = useState(false);
  const [idleTimeout, setIdleTimeout] = useState("120");
  const [showPrices, setShowPrices] = useState(true);
  const [allowedMethods, setAllowedMethods] = useState<Set<PaymentMethod>>(
    new Set(["card", "cash"]),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggleMethod = (m: PaymentMethod) => {
    setAllowedMethods((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => window.setTimeout(r, 700));
    setSaving(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  };

  const KIOSK_URL = "https://finder-pos.app/kiosk";

  return (
    <EnterpriseShell
      active="kiosk-settings"
      title="Kiosk Mode"
      subtitle="Self-checkout terminal setup"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-[#111]">Kiosk Mode</h1>
          <p className="mt-1 text-sm text-slate-500">
            Configure a customer-facing self-checkout terminal on a dedicated tablet or touchscreen.
            Staff use a PIN to exit kiosk mode and return to the back office.
          </p>
        </div>

        {/* ── Master enable ─────────────────────────────────────────────── */}
        <SectionCard>
          <ToggleRow
            label="Enable Kiosk Mode"
            description="When enabled, this terminal locks into a simplified customer checkout interface."
            checked={enabled}
            onChange={setEnabled}
          />
        </SectionCard>

        {enabled && (
          <div className="mt-4 space-y-4">

            {/* ── Kiosk URL ──────────────────────────────────────────── */}
            <SectionCard>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Kiosk URL
              </p>
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="flex-1 select-all font-mono text-sm text-slate-700">
                  {KIOSK_URL}
                </span>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(KIOSK_URL)}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                >
                  Copy
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Open this URL on a dedicated tablet or customer-facing display.
              </p>
            </SectionCard>

            {/* ── Exit PIN ───────────────────────────────────────────── */}
            <SectionCard>
              <label
                className="block text-sm font-medium text-[#111]"
                htmlFor="kiosk-pin"
              >
                Exit PIN
              </label>
              <p className="mt-0.5 text-xs text-slate-400">
                Staff enter this PIN to exit kiosk mode and return to the back office.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="kiosk-pin"
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  className="w-32 rounded-lg border border-slate-200 px-3 py-2 font-mono text-lg tracking-widest focus:border-brand-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((v) => !v)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  {showPin ? "Hide" : "Show"}
                </button>
              </div>
            </SectionCard>

            {/* ── Idle timeout ────────────────────────────────────────── */}
            <SectionCard>
              <label
                className="block text-sm font-medium text-[#111]"
                htmlFor="kiosk-timeout"
              >
                Idle Timeout
              </label>
              <p className="mt-0.5 text-xs text-slate-400">
                Return to the welcome screen after this period of inactivity.
              </p>
              <select
                id="kiosk-timeout"
                value={idleTimeout}
                onChange={(e) => setIdleTimeout(e.target.value)}
                className="mt-2 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
              >
                {TIMEOUT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </SectionCard>

            {/* ── Show prices ─────────────────────────────────────────── */}
            <SectionCard>
              <ToggleRow
                label="Show Product Prices"
                description="Display retail prices in the product browser and cart."
                checked={showPrices}
                onChange={setShowPrices}
              />
            </SectionCard>

            {/* ── Payment methods ─────────────────────────────────────── */}
            <SectionCard>
              <p className="text-sm font-medium text-[#111]">Allowed Payment Methods</p>
              <p className="mt-0.5 text-xs text-slate-400">
                Only selected methods will be offered to customers at checkout.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["card", "cash", "loyalty", "gift_card"] as PaymentMethod[]).map((m) => {
                  const active = allowedMethods.has(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleMethod(m)}
                      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                        active
                          ? "bg-brand-600 text-white"
                          : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {METHOD_LABELS[m]}
                    </button>
                  );
                })}
              </div>
            </SectionCard>

            {/* ── Enable mode notice ──────────────────────────────────── */}
            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>
                Kiosk mode must also be enabled in{" "}
                <Link href="/settings/modes" className="font-medium text-brand-600 hover:underline">
                  Business Modes
                </Link>{" "}
                for it to appear in the navigation.
              </p>
            </div>
          </div>
        )}

        {/* ── Save ──────────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-end gap-3">
          {saved && (
            <span className="text-sm font-medium text-emerald-600">
              Saved successfully
            </span>
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
