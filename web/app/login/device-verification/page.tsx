"use client";

/**
 * /login/device-verification — confirm a sign-in from a new device or
 * location. No backend device-trust events exist yet, so the device details
 * below are mocked and the confirm action is simulated.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/Button";

const MOCK_DEVICE = {
  browser: "Chrome on macOS",
  location: "San Francisco, CA, US",
  ip: "198.51.100.24",
  time: "Just now",
};

export default function DeviceVerificationPage() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    setConfirming(true);
    // Mocked: no backend device-trust endpoint exists yet.
    await new Promise((resolve) => setTimeout(resolve, 500));
    setConfirming(false);
    router.replace("/terminal");
  }

  return (
    <AuthShell>
      <div className="rounded-2xl border border-white/40 bg-white/80 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-700/20 dark:text-brand-400">
          <DeviceIcon />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">Verify it&apos;s you</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          We noticed a sign-in from a device or location we don&apos;t recognize. Please confirm this was you.
        </p>

        {/* Preview gate — no backend device-trust/new-device detection exists yet.
            This page is never reached from the real login flow today; the banner
            exists so it can't silently masquerade as a real check if that changes. */}
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700/40 dark:bg-amber-700/10 dark:text-amber-300">
          Preview: device details below are illustrative — new-device detection isn&apos;t wired to a real backend yet.
        </div>

        <dl className="mt-6 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800/60">
          <Row label="Device" value={MOCK_DEVICE.browser} />
          <Row label="Location" value={MOCK_DEVICE.location} />
          <Row label="IP address" value={MOCK_DEVICE.ip} />
          <Row label="Time" value={MOCK_DEVICE.time} />
        </dl>

        <div className="mt-6 flex flex-col gap-3">
          <Button type="button" fullWidth loading={confirming} disabled={confirming} size="lg" onClick={() => void handleConfirm()}>
            {confirming ? "Confirming…" : "Yes, this was me"}
          </Button>
          <Link
            href="/login/security-alert"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-danger-300 px-4 text-sm font-semibold text-danger-700 transition-colors hover:bg-danger-50 dark:border-danger-700/40 dark:text-danger-300 dark:hover:bg-danger-700/10"
          >
            No, secure my account
          </Link>
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
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-900 dark:text-white">{value}</dd>
    </div>
  );
}

function DeviceIcon() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}
