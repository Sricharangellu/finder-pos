"use client";

/**
 * /signup — two-step account creation.
 *
 * Step 1: Store details (name, email, password)
 * Step 2: Business type selection — locked after this point.
 *         Only Ascend support can change the type later.
 */

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/Button";
import { useAuth } from "@/lib/useAuth";
import { apiPost } from "@/api-client/client";

// ── Business types ────────────────────────────────────────────────────────────

const BUSINESS_TYPES = [
  {
    key: "retail",
    icon: "🏪",
    name: "Retail Store",
    desc: "Touch-screen POS, barcode scanner, gift cards, loyalty, discounts",
    highlight: ["POS Terminal", "Loyalty", "Gift Cards", "Discounts"],
  },
  {
    key: "wholesale",
    icon: "📦",
    name: "B2B / Wholesale",
    desc: "Sales orders, purchase orders, invoicing, B2B accounts, credit terms",
    highlight: ["Sales Orders", "Purchasing", "Invoicing", "Accounts"],
  },
  {
    key: "restaurant",
    icon: "🍽️",
    name: "Restaurant / Café",
    desc: "Table management, kitchen display, bar tabs, menu modifiers",
    highlight: ["Tables", "Kitchen Display", "Bar Tabs", "Reservations"],
  },
  {
    key: "golf",
    icon: "⛳",
    name: "Golf / Sports Club",
    desc: "Tee sheet, bookings, memberships, pro shop POS",
    highlight: ["Tee Sheet", "Memberships", "Bookings", "Pro Shop"],
  },
  {
    key: "services",
    icon: "✂️",
    name: "Services & Repairs",
    desc: "Appointment scheduling, service orders, membership plans",
    highlight: ["Appointments", "Service Orders", "Memberships"],
  },
  {
    key: "healthcare",
    icon: "🏥",
    name: "Healthcare / Pharmacy",
    desc: "Prescriptions, patient records, insurance billing, expiry tracking",
    highlight: ["Prescriptions", "Patient Records", "Insurance"],
  },
  {
    key: "hospitality",
    icon: "🏨",
    name: "Hotel / Resort",
    desc: "Room billing, guest accounts, spa services, event management",
    highlight: ["Room Billing", "Guest Accounts", "Spa & Events"],
  },
  {
    key: "ecommerce",
    icon: "🛒",
    name: "E-Commerce",
    desc: "Online store, pick-pack-ship, marketplace sync, shipping labels",
    highlight: ["Online Store", "Fulfilment", "Marketplace", "Shipping"],
  },
  {
    key: "manufacturing",
    icon: "🏭",
    name: "Manufacturing",
    desc: "Production orders, bill of materials, raw materials, quality control",
    highlight: ["Production Orders", "BOM", "Raw Materials"],
  },
] as const;

type BizKey = typeof BUSINESS_TYPES[number]["key"];

// ── Field component ───────────────────────────────────────────────────────────

function Field({
  id, label, type = "text", value, onChange, onBlur, error, placeholder, autoComplete, required,
}: {
  id: string; label: string; type?: string; value: string;
  onChange: (v: string) => void; onBlur?: () => void; error?: string | null;
  placeholder?: string; autoComplete?: string; required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
      </label>
      <input
        id={id} type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className={`w-full rounded-md border px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600 transition-colors ${
          error ? "border-red-400 bg-red-50" : "border-slate-300 bg-white hover:border-slate-400"
        }`}
      />
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SignupPage() {
  const router = useRouter();
  const { register, loginError, isLoading } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state
  const [storeName, setStoreName]         = useState("");
  const [email, setEmail]                 = useState("");
  const [password, setPassword]           = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched]             = useState({ storeName: false, email: false, password: false, confirmPassword: false });

  // Step 2 state
  const [selectedType, setSelectedType]   = useState<BizKey | null>(null);
  // Covers the whole finish flow (register → set business type → redirect) so
  // the button stays disabled through the post-register window, not just while
  // the hook's isLoading is true during the register call itself.
  const [finishing, setFinishing]         = useState(false);

  // ── Validation ────────────────────────────────────────────────────────────

  const storeNameError = useMemo(() => {
    if (!touched.storeName) return null;
    if (!storeName.trim()) return "Store name is required.";
    if (storeName.trim().length < 2) return "Store name must be at least 2 characters.";
    return null;
  }, [storeName, touched.storeName]);

  const emailError = useMemo(() => {
    if (!touched.email) return null;
    if (!email.trim()) return "Email is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
    return null;
  }, [email, touched.email]);

  const passwordError = useMemo(() => {
    if (!touched.password) return null;
    if (!password) return "Password is required.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    return null;
  }, [password, touched.password]);

  const confirmPasswordError = useMemo(() => {
    if (!touched.confirmPassword) return null;
    if (password !== confirmPassword) return "Passwords do not match.";
    return null;
  }, [password, confirmPassword, touched.confirmPassword]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleStep1(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched({ storeName: true, email: true, password: true, confirmPassword: true });
    if (!storeName.trim() || !email.trim() || !password || password !== confirmPassword || password.length < 8) return;
    setStep(2);
  }

  async function handleFinish() {
    if (!selectedType || finishing) return;
    setFinishing(true);

    // Same auth pathway as /login: apiPost + typed errors + session/status.
    const ok = await register(storeName.trim(), email.trim(), password);
    if (!ok) {
      setFinishing(false);
      return; // reason surfaced via loginError, rendered below
    }

    // Set and lock the business type — drives the entire nav and module set.
    await apiPost("/api/v1/settings/business-profile", { businessType: selectedType, lock: true })
      .catch(() => {}); // non-fatal — will default to retail

    router.replace("/dashboard");
    // Leave `finishing` true — we are navigating away; keeps the button locked.
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const progressPct = step === 1 ? 40 : 90;

  return (
    <AuthShell>
      <div className="w-full max-w-lg mx-auto">

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 text-white text-xl font-bold mb-3">F</div>
          <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500">
            {step === 1 ? "Set up your workspace in under a minute." : "Choose your business type — this shapes your entire interface."}
          </p>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className={step === 1 ? "font-semibold text-slate-700" : "text-slate-400"}>Account details</span>
            <span className={step === 2 ? "font-semibold text-slate-700" : "text-slate-400"}>Business type</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200">
            <div className="h-1.5 rounded-full bg-brand-600 transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* ── Step 1: Account details ── */}
        {step === 1 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <form onSubmit={(e) => void handleStep1(e)} noValidate className="space-y-4">
              <Field
                id="storeName" label="Store name" value={storeName}
                onChange={setStoreName} error={storeNameError}
                placeholder="e.g. Blue Sky Trading" autoComplete="organization" required
                onBlur={() => setTouched(t => ({ ...t, storeName: true }))}
              />
              <Field
                id="email" label="Email" type="email" value={email}
                onChange={setEmail} error={emailError}
                placeholder="you@example.com" autoComplete="email" required
                onBlur={() => setTouched(t => ({ ...t, email: true }))}
              />
              <Field
                id="password" label="Password" type="password" value={password}
                onChange={setPassword} error={passwordError}
                placeholder="8+ characters" autoComplete="new-password" required
                onBlur={() => setTouched(t => ({ ...t, password: true }))}
              />
              <Field
                id="confirmPassword" label="Confirm password" type="password" value={confirmPassword}
                onChange={setConfirmPassword} error={confirmPasswordError}
                placeholder="Re-enter your password" autoComplete="new-password" required
                onBlur={() => setTouched(t => ({ ...t, confirmPassword: true }))}
              />
              <Button type="submit" variant="primary" size="lg" fullWidth>
                Continue →
              </Button>
            </form>
            <p className="mt-4 text-center text-xs text-slate-500">
              By creating an account you agree to our{" "}
              <span className="font-medium text-slate-700">Terms of Service</span> and{" "}
              <span className="font-medium text-slate-700">Privacy Policy</span>.
            </p>
          </div>
        )}

        {/* ── Step 2: Business type ── */}
        {step === 2 && (
          <div>
            {/* Lock notice */}
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
              </svg>
              <span>
                <strong>This selection is permanent.</strong> Your business type configures the modules, interface, and workflows available to your team. Only Ascend support can change it later.
              </span>
            </div>

            {/* Type grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {BUSINESS_TYPES.map((bt) => {
                const active = selectedType === bt.key;
                return (
                  <button
                    key={bt.key}
                    type="button"
                    onClick={() => setSelectedType(bt.key)}
                    className={`text-left rounded-xl border p-4 transition-all ${
                      active
                        ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                    aria-pressed={active}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl leading-none mt-0.5">{bt.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm leading-tight ${active ? "text-brand-700" : "text-slate-800"}`}>
                          {bt.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 leading-snug">{bt.desc}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {bt.highlight.map(h => (
                            <span key={h} className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              active ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"
                            }`}>{h}</span>
                          ))}
                        </div>
                      </div>
                      {active && (
                        <svg className="h-5 w-5 text-brand-600 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {loginError && (
              <div role="alert" className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {loginError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                ← Back
              </button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                fullWidth
                disabled={!selectedType || finishing || isLoading}
                loading={finishing || isLoading}
                onClick={() => void handleFinish()}
              >
                {finishing || isLoading ? "Setting up your workspace…" : "Launch my workspace"}
              </Button>
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-slate-900 hover:underline">Sign in</Link>
        </p>
      </div>
    </AuthShell>
  );
}
