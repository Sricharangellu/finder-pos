"use client";

import { useState } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiPost } from "@/api-client/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type ModeId =
  | "retail"
  | "restaurant"
  | "golf"
  | "wholesale"
  | "ecommerce"
  | "kiosk"
  | "hospitality"
  | "services";

interface Mode {
  id: ModeId;
  label: string;
  description: string;
  features: string[];
  configHref?: string;
  core?: boolean;
  emoji: string;
  apiKey?: string;
}

// ── Mode definitions ───────────────────────────────────────────────────────────

const MODES: Mode[] = [
  {
    id: "retail",
    label: "Retail POS",
    description: "Core point-of-sale for retail and convenience stores.",
    features: ["Register", "Catalog", "Inventory", "Customers", "Loyalty"],
    core: true,
    emoji: "🛍",
  },
  {
    id: "restaurant",
    label: "Restaurant",
    description: "Table management, kitchen display, bar tabs, and reservations.",
    features: ["Floor Plan", "Kitchen Display", "Bar Tabs", "Reservations"],
    configHref: "/restaurant/dashboard",
    emoji: "🍽",
    apiKey: "tables",
  },
  {
    id: "golf",
    label: "Golf & Country Club",
    description: "Tee sheet booking, member management, and pro shop POS.",
    features: ["Tee Times", "Bookings", "Members", "Pro Shop"],
    configHref: "/golf",
    emoji: "⛳",
    apiKey: "tee_sheet",
  },
  {
    id: "wholesale",
    label: "B2B / Wholesale",
    description: "Customer pricing tiers, credit terms, quotes, and order approvals.",
    features: ["Customer Pricing", "Quotes", "Credit Terms", "Invoicing"],
    configHref: "/settings/b2b",
    emoji: "🏭",
    apiKey: "sales_orders",
  },
  {
    id: "ecommerce",
    label: "E-commerce",
    description: "Sync products to your online store and manage online orders.",
    features: ["Online Store", "Product Listings", "Order Fulfillment", "Marketplace Sync"],
    configHref: "/ecommerce",
    emoji: "🌐",
    apiKey: "ecommerce",
  },
  {
    id: "kiosk",
    label: "Kiosk / Self-checkout",
    description: "Customer-facing self-checkout for unattended or queuing terminals.",
    features: ["Self-checkout", "Customer Display", "PIN Exit", "Idle Reset"],
    configHref: "/settings/kiosk",
    emoji: "📲",
  },
  {
    id: "hospitality",
    label: "Hospitality / Hotel",
    description: "Room billing, guest folios, spa services, and event management.",
    features: ["Room Billing", "Guest Accounts", "Spa & Events"],
    emoji: "🏨",
    apiKey: "room_billing",
  },
  {
    id: "services",
    label: "Services & Appointments",
    description: "Booking, service orders, technician scheduling, and commissions.",
    features: ["Appointments", "Service Orders", "Commission Tracking"],
    configHref: "/appointments",
    emoji: "🛠",
    apiKey: "appointments",
  },
];

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({
  enabled,
  onChange,
  disabled,
  loading,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return <div className="h-6 w-11 animate-pulse rounded-full bg-slate-200" aria-hidden="true" />;
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => !disabled && onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5D5FEF] focus-visible:ring-offset-2 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      } ${enabled ? "bg-[#5D5FEF]" : "bg-slate-200"}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "translate-x-[22px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ModesPage() {
  const [enabled, setEnabled] = useState<Set<ModeId>>(new Set(["retail"]));
  const [toggling, setToggling] = useState<ModeId | null>(null);

  const toggleMode = async (mode: Mode, on: boolean) => {
    if (mode.core) return;
    setToggling(mode.id);
    try {
      const payload = mode.apiKey
        ? { moduleFlags: { [mode.apiKey]: on } }
        : {};
      await apiPost<{ ok: boolean }>("/api/v1/settings/business-profile", payload);
      setEnabled((prev) => {
        const next = new Set(prev);
        if (on) next.add(mode.id);
        else next.delete(mode.id);
        return next;
      });
    } catch {
      /* revert on error */
    } finally {
      setToggling(null);
    }
  };

  return (
    <EnterpriseShell
      active="modes"
      title="Business Modes"
      subtitle="Enable features for your business type"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-[#111]">Business Modes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enable only the features your business needs. Everything else stays hidden from your
            team, keeping the interface simple.
          </p>
        </div>

        {/* ── Tip banner ────────────────────────────────────────────────── */}
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-amber-700">
            Enabling a mode adds new navigation items for your team. Use{" "}
            <Link href="/settings/permissions" className="font-semibold underline">Role Permissions</Link>{" "}
            to control who can access each section.
          </p>
        </div>

        {/* ── Mode cards ────────────────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((mode) => {
            const on = enabled.has(mode.id);
            const isLoading = toggling === mode.id;
            return (
              <div
                key={mode.id}
                className={`rounded-xl border p-4 shadow-sm transition-all ${
                  on
                    ? "border-[#5D5FEF]/30 bg-[#5D5FEF]/5"
                    : "border-slate-200 bg-white"
                }`}
              >
                {/* Card header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl" role="img" aria-label={mode.label}>
                      {mode.emoji}
                    </span>
                    <div>
                      <p className={`font-semibold ${on ? "text-[#111]" : "text-[#333]"}`}>
                        {mode.label}
                      </p>
                      {mode.core ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Always active
                        </span>
                      ) : (
                        <span
                          className={`text-[11px] font-medium ${on ? "text-[#5D5FEF]" : "text-slate-400"}`}
                        >
                          {on ? "Enabled" : "Disabled"}
                        </span>
                      )}
                    </div>
                  </div>
                  <Toggle
                    enabled={on}
                    onChange={(v) => void toggleMode(mode, v)}
                    disabled={!!mode.core}
                    loading={isLoading}
                  />
                </div>

                {/* Description */}
                <p className="mt-2.5 text-xs text-slate-500 leading-relaxed">
                  {mode.description}
                </p>

                {/* Feature pills */}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {mode.features.map((f) => (
                    <span
                      key={f}
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        on ? "bg-[#5D5FEF]/10 text-[#5D5FEF]" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {f}
                    </span>
                  ))}
                </div>

                {/* Configure link (shown only when enabled) */}
                {mode.configHref && on && (
                  <Link
                    href={mode.configHref}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#5D5FEF] hover:underline"
                  >
                    Configure →
                  </Link>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </EnterpriseShell>
  );
}
