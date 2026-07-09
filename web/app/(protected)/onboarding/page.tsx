"use client";

/**
 * UX-1: Onboarding Wizard — first-run experience for new tenants.
 *
 * Business types render from the capabilities registry
 * (GET /api/v1/capabilities → availableBusinessTypes) so onboarding and the
 * backend business packs can never drift; the static list below is only the
 * fail-open fallback plus icon/description enrichment. Retail is the first
 * pack completed end-to-end — every other type is labeled Preview, because
 * setup must not present every vertical as equally complete.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, safeLoad } from "@/api-client/client";
import { invalidateModuleFlagsCache } from "@/hooks/useModuleFlags";
import { useCapabilities } from "@/contexts/CapabilitiesContext";

const BUSINESS_TYPES = [
  { key: "retail",        icon: "🏪", name: "Retail Store",         desc: "Convenience, fashion, electronics, pharmacy, pet, sporting goods" },
  { key: "restaurant",    icon: "🍽️", name: "Restaurant / Café",    desc: "Dine-in, takeaway, bar, food truck, bakery, coffee shop" },
  { key: "wholesale",     icon: "📦", name: "B2B / Wholesale",       desc: "Distributor, wholesaler, FMCG supplier, food & beverage" },
  { key: "hospitality",   icon: "🏨", name: "Hotel / Resort",        desc: "Room billing, guest accounts, spa, events, boutique hotel" },
  { key: "services",      icon: "✂️", name: "Services & Repairs",    desc: "Salon, spa, repair shop, laundry, tailoring, car wash" },
  { key: "healthcare",    icon: "🏥", name: "Healthcare / Pharmacy", desc: "Pharmacy, clinic, medical store, diagnostic lab, optical" },
  { key: "manufacturing", icon: "🏭", name: "Manufacturing",         desc: "Factory outlet, production floor, direct-to-consumer brand" },
  { key: "ecommerce",     icon: "🛒", name: "E-Commerce",            desc: "Online store, marketplace seller, click-and-collect, D2C" },
  { key: "automotive",    icon: "🚗", name: "Automotive",            desc: "Auto parts, tire shop, vehicle workshop, service center" },
  { key: "rental",        icon: "🔑", name: "Rental",                desc: "Equipment hire, vehicle rental, event equipment, tool hire" },
  { key: "entertainment", icon: "🎭", name: "Entertainment",         desc: "Cinema, theme park, museum, gaming center, sports venue" },
  { key: "education",     icon: "🎓", name: "Education",             desc: "Training institute, coaching center, school, university" },
  { key: "golf",          icon: "⛳", name: "Golf / Sports",         desc: "Golf course, driving range, pro shop, sports club, resort" },
];

type Step = "welcome" | "type" | "confirm";

/** Only retail has passed its end-to-end release gates so far. */
const READY_TYPES = new Set(["retail"]);

export default function OnboardingPage() {
  const router = useRouter();
  const { capabilities } = useCapabilities();
  const [step, setStep]             = useState<Step>("welcome");
  const [selected, setSelected]     = useState<string | null>(null);
  const [saving, setSaving]         = useState(false);

  // Registry-driven type list: capabilities is the authority for WHICH types
  // exist; the static list enriches icons/descriptions. Retail sorts first.
  const businessTypes = useMemo(() => {
    const meta = new Map(BUSINESS_TYPES.map((b) => [b.key, b]));
    const source = capabilities?.availableBusinessTypes?.length
      ? capabilities.availableBusinessTypes.map((bt) => ({
          key: bt.key,
          icon: meta.get(bt.key)?.icon ?? bt.icon,
          name: meta.get(bt.key)?.name ?? bt.name,
          desc: meta.get(bt.key)?.desc ?? bt.description,
        }))
      : BUSINESS_TYPES;
    return [...source].sort((a, b) =>
      Number(READY_TYPES.has(b.key)) - Number(READY_TYPES.has(a.key)),
    );
  }, [capabilities]);

  const selectedBt = businessTypes.find(b => b.key === selected);
  const selectedReady = selected !== null && READY_TYPES.has(selected);

  const progress = { welcome: 25, type: 65, confirm: 100 }[step];

  const handleFinish = () => {
    if (!selected) return;
    setSaving(true);
    safeLoad(
      apiPost("/api/v1/settings/business-profile", { businessType: selected })
        .then(() => { invalidateModuleFlagsCache(); router.replace("/dashboard"); })
        .catch(() => router.replace("/dashboard")),
    );
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-[#030B25] via-[#071435] to-[#0a1535] px-4 py-12">

      {/* Branding */}
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white shadow-lg">F</div>
        <div>
          <p className="text-xl font-bold text-white leading-none">Ascend</p>
          <p className="text-xs text-white/40">Enterprise Platform</p>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-8 w-full max-w-lg">
        <div className="h-1 rounded-full bg-white/10">
          <div className="h-1 rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-white/30">
          <span>Welcome</span><span>Business type</span><span>Launch</span>
        </div>
      </div>

      {/* ── Step: Welcome ──────────────────────────────────────────── */}
      {step === "welcome" && (
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl text-center">
          <div className="mb-5 text-5xl">👋</div>
          <h1 className="mb-2 text-2xl font-bold text-[var(--color-text-primary)]">Welcome to Ascend</h1>
          <p className="mb-6 text-sm text-[var(--color-text-secondary)]">
            The enterprise POS that adapts to your business — retail, restaurant, wholesale, healthcare, automotive, and more. Let's set you up in under a minute.
          </p>
          <div className="mb-6 grid grid-cols-3 gap-3">
            {[
              { icon: "⚡", label: "30-second setup" },
              { icon: "🎯", label: "Right features unlocked" },
              { icon: "🔓", label: "Change anytime" },
            ].map(({ icon, label }) => (
              <div key={label} className="rounded-xl bg-brand-50 p-3 text-center">
                <div className="text-2xl">{icon}</div>
                <p className="mt-1 text-[11px] font-medium text-brand-700">{label}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStep("type")}
            className="w-full rounded-xl bg-brand-600 py-3.5 text-base font-semibold text-white hover:bg-brand-700 transition-colors"
          >
            Get Started →
          </button>
        </div>
      )}

      {/* ── Step: Choose business type ─────────────────────────────── */}
      {step === "type" && (
        <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
          <h2 className="mb-1 text-xl font-bold text-[var(--color-text-primary)]">What type of business are you?</h2>
          <p className="mb-5 text-sm text-[var(--color-text-secondary)]">
            Select your industry — we'll activate exactly the right modules for you.
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {businessTypes.map((bt) => {
              const ready = READY_TYPES.has(bt.key);
              return (
                <button
                  key={bt.key}
                  type="button"
                  onClick={() => { setSelected(bt.key); setStep("confirm"); }}
                  className={`group relative flex flex-col rounded-xl border-2 p-3 text-left transition-all hover:border-brand-500 hover:bg-brand-50 hover:shadow-sm ${
                    selected === bt.key ? "border-brand-600 bg-brand-50" : "border-slate-200"
                  }`}
                >
                  <span
                    className={`absolute right-2 top-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                      ready ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {ready ? "Ready" : "Preview"}
                  </span>
                  <span className="mb-1.5 text-2xl">{bt.icon}</span>
                  <span className="text-sm font-semibold leading-tight text-[var(--color-text-primary)]">{bt.name}</span>
                  <span className="mt-0.5 text-[11px] leading-tight text-[var(--color-text-secondary)] line-clamp-2">{bt.desc}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-[var(--color-text-secondary)]">
            <span className="font-semibold">Ready</span> = fully built and verified end-to-end.{" "}
            <span className="font-semibold">Preview</span> = the module pack activates, but its complete
            workflow is still being finished — Retail first.
          </p>
          <button type="button" onClick={() => setStep("welcome")}
            className="mt-4 w-full text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
            ← Back
          </button>
        </div>
      )}

      {/* ── Step: Confirm + launch ─────────────────────────────────── */}
      {step === "confirm" && selectedBt && (
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl text-center">
          <div className="mb-3 text-5xl">{selectedBt.icon}</div>
          <h2 className="mb-1 text-xl font-bold text-[var(--color-text-primary)]">{selectedBt.name}</h2>
          <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{selectedBt.desc}</p>

          <div className="mb-6 rounded-xl bg-green-50 border border-green-200 px-4 py-4 text-left space-y-1.5">
            {[
              "The right modules will be activated automatically",
              "Other features stay hidden to keep the interface clean",
              "Add individual modules later via Setup → Business Profile",
              "Switch business type at any time without losing data",
            ].map((line) => (
              <p key={line} className="flex items-start gap-2 text-sm text-green-800">
                <span className="mt-0.5 text-green-600">✓</span>
                {line}
              </p>
            ))}
          </div>

          {!selectedReady && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left">
              <p className="text-sm font-semibold text-amber-800">This business type is a Preview</p>
              <p className="mt-1 text-xs text-amber-700">
                Its module pack activates now, but the complete end-to-end workflow is still being
                finished — Retail is the first fully verified pack. You can start here and every
                shared feature (products, inventory, customers, payments, reports) works today.
              </p>
            </div>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={handleFinish}
            className="w-full rounded-xl bg-brand-600 py-3.5 text-base font-semibold text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {saving ? "Setting up…" : `Launch as ${selectedBt.name} →`}
          </button>
          <button
            type="button"
            onClick={() => setStep("type")}
            className="mt-3 w-full text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            ← Choose different type
          </button>
        </div>
      )}

      <p className="mt-8 text-xs text-white/20">You can change your business profile anytime in Settings</p>
    </div>
  );
}
