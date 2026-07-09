"use client";

/**
 * AuthShell — shared split-screen frame for auth pages (login, MFA,
 * forgot password). Left panel is marketing/brand; right panel hosts the
 * page-specific card. Supports light/dark mode via a toggle persisted to
 * localStorage.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { applyTheme, getPreferredTheme, setStoredTheme, type Theme } from "@/lib/theme";

const BENEFITS = [
  "Real-time inventory, purchasing, and accounting in one platform",
  "Role-based access control with full audit trails",
  "99.99% uptime SLA across global regions",
];

const METRICS = [
  { value: "2,400+", label: "Organizations" },
  { value: "50M+", label: "Transactions / mo" },
  { value: "99.99%", label: "Uptime SLA" },
];

const COMPLIANCE_BADGES = ["SOC 2 Type II", "ISO 27001", "GDPR"];

export function AuthShell({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initial = getPreferredTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setStoredTheme(next);
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950 lg:flex-row">
      {/* Left — brand / marketing panel (60%) */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-indigo-950 lg:flex lg:w-[60%] lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <DashboardPreview />

        <div className="relative z-10 flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-xl font-bold text-brand-700 shadow-lg"
          >
            F
          </div>
          <span className="text-xl font-semibold text-white">Ascend</span>
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="text-3xl font-bold leading-tight text-white xl:text-4xl">
            The operations platform trusted by retail teams worldwide
          </h1>
          <p className="mt-3 text-base text-brand-100">
            Unify point of sale, inventory, purchasing, and accounting &mdash;
            built for the speed and scale of modern retail.
          </p>

          <ul className="mt-8 flex flex-col gap-3">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-3 text-sm text-brand-50">
                <CheckIcon />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-6">
            {METRICS.map((metric) => (
              <div key={metric.label}>
                <dd className="text-2xl font-bold text-white">{metric.value}</dd>
                <dt className="mt-1 text-xs text-brand-200">{metric.label}</dt>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-brand-200">
          {COMPLIANCE_BADGES.map((badge) => (
            <span key={badge} className="flex items-center gap-1.5">
              <ShieldIcon />
              {badge}
            </span>
          ))}
        </div>
      </div>

      {/* Right — page-specific content (40%) */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-4 sm:px-8 lg:justify-end">
          {/* Mobile brand mark (left panel is hidden below lg) */}
          <div className="flex items-center gap-2 lg:hidden">
            <div
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white"
            >
              F
            </div>
            <span className="text-base font-semibold text-slate-900 dark:text-white">Ascend</span>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={theme === "dark"}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            <span className="hidden sm:inline">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 py-6 sm:px-8">
          <div className="w-full max-w-md">{children}</div>
        </div>

        <AuthFooter />
      </div>
    </div>
  );
}

function AuthFooter() {
  const links = [
    { label: "Privacy Policy", href: "#" },
    { label: "Terms of Service", href: "#" },
    { label: "Security Center", href: "#" },
    { label: "Help Center", href: "#" },
    { label: "System Status", href: "#" },
  ];

  return (
    <footer className="border-t border-slate-200 px-4 py-4 dark:border-slate-800 sm:px-8">
      <div className="flex flex-col gap-3 text-xs text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Legal and support" className="flex flex-wrap gap-x-4 gap-y-2">
          {links.map((link) => (
            <Link key={link.label} href={link.href} className="hover:text-slate-700 hover:underline dark:hover:text-slate-200">
              {link.label}
            </Link>
          ))}
        </nav>

        <label className="flex items-center gap-2">
          <span className="sr-only">Language</span>
          <select
            defaultValue="en"
            className="min-h-[36px] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <option value="en">English (US)</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="ja">日本語</option>
          </select>
        </label>
      </div>

      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
        This site is protected by reCAPTCHA and is subject to the Ascend Privacy Policy and Terms of Service.
        &copy; {new Date().getFullYear()} Ascend.
      </p>
    </footer>
  );
}

/** Decorative dashboard preview — purely visual, sits behind the marketing copy. */
function DashboardPreview() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.14]">
      <div className="absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-brand-400 blur-3xl" />
      <div className="absolute -bottom-32 -left-16 h-[24rem] w-[24rem] rounded-full bg-indigo-400 blur-3xl" />

      <div className="absolute right-10 top-24 grid w-72 grid-cols-2 gap-3 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-white/15 p-3">
            <div className="h-2 w-12 rounded bg-white/40" />
            <div className="mt-3 h-5 w-16 rounded bg-white/60" />
          </div>
        ))}
      </div>

      <div className="absolute bottom-24 right-16 flex h-32 w-80 items-end gap-2 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
        {[40, 65, 30, 80, 55, 90, 45, 70].map((h, i) => (
          <div key={i} className="flex-1 rounded-t bg-white/40" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}
