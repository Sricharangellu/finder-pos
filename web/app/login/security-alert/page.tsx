"use client";

/**
 * /login/security-alert — notice shown when a user reports an unrecognized
 * sign-in from /login/device-verification. No backend security-event
 * pipeline exists yet; this page is UI only and the "secure account" action
 * routes to the (mocked) reset-password flow.
 */

import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/Button";

const MOCK_EVENT = {
  browser: "Chrome on macOS",
  location: "San Francisco, CA, US",
  ip: "198.51.100.24",
  time: "Just now",
};

export default function SecurityAlertPage() {
  return (
    <AuthShell>
      <div className="rounded-2xl border border-white/40 bg-white/80 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-100 text-danger-700 dark:bg-danger-700/20 dark:text-danger-400">
          <AlertIcon />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">We&apos;ve flagged this sign-in</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Thanks for letting us know. We&apos;ve recorded this sign-in attempt as suspicious and recommend
          resetting your password right away. We&apos;ve also signed out any other active sessions.
        </p>

        {/* Preview gate — no backend security-event pipeline exists yet; nothing
            is actually recorded or signed out. See device-verification/page.tsx. */}
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700/40 dark:bg-amber-700/10 dark:text-amber-300">
          Preview: this event isn&apos;t actually recorded and no sessions are actually signed out yet.
        </div>

        <dl className="mt-6 flex flex-col gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm dark:border-danger-700/40 dark:bg-danger-700/10">
          <Row label="Device" value={MOCK_EVENT.browser} />
          <Row label="Location" value={MOCK_EVENT.location} />
          <Row label="IP address" value={MOCK_EVENT.ip} />
          <Row label="Time" value={MOCK_EVENT.time} />
        </dl>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/login/forgot-password"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-danger-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-danger-700"
          >
            Reset my password
          </Link>
          <Button variant="secondary" type="button" fullWidth size="lg" disabled>
            Contact support
          </Button>
        </div>

        <Link href="/login" className="mt-6 block text-center text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
          &larr; Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-600 dark:text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-900 dark:text-white">{value}</dd>
    </div>
  );
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}
