"use client";

/**
 * MockWorkerInit — starts the MSW browser worker.
 *
 * Active when:
 *   - NODE_ENV === "development"
 *   - NEXT_PUBLIC_MOCK=true (build-time env var)
 *   - URL contains ?demo=1  (sets localStorage and activates demo mode)
 *   - localStorage["ascend_demo"] === "1" (persists across page loads)
 *
 * In production without any of the above, this component renders children
 * immediately with no delay and the worker never starts.
 */

import { useEffect, useState, type ReactNode } from "react";

// NEXT_PUBLIC_MOCK is the explicit switch (see web/next.config.mjs):
//   "true"  → mocks on everywhere.
//   "false" → mocks off everywhere, including local dev, so the app talks to
//             the real backend (Supabase-backed). Required for real-backend runs.
//   unset   → default on in development only.
const ENV_MOCKS =
  process.env.NEXT_PUBLIC_MOCK === "true" ||
  (process.env.NEXT_PUBLIC_MOCK !== "false" &&
    process.env.NODE_ENV === "development");

export default function MockWorkerInit({ children }: { children: ReactNode }) {
  // Production non-demo starts as ready; env mocks and demo mode block until worker registers.
  const [ready, setReady] = useState(!ENV_MOCKS);

  useEffect(() => {
    if (ENV_MOCKS) {
      // Env-driven path: block render until worker registers (original behaviour).
      let active = true;
      const fallback = window.setTimeout(() => { if (active) setReady(true); }, 4_000);
      import("./browser")
        .then(({ startWorker }) => startWorker())
        .catch(() => {})
        .finally(() => { window.clearTimeout(fallback); if (active) setReady(true); });
      return () => { active = false; window.clearTimeout(fallback); };
    }

    // Runtime demo mode — check for ?demo=1 or the persisted localStorage flag.
    let isDemo = false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("demo") === "1") {
        localStorage.setItem("ascend_demo", "1");
        // Strip the ?demo param from the URL so it doesn't persist visually.
        const clean = new URL(window.location.href);
        clean.searchParams.delete("demo");
        window.history.replaceState(null, "", clean.toString());
      }
      isDemo = localStorage.getItem("ascend_demo") === "1";
    } catch {
      // localStorage blocked (private browsing edge cases) — bail out.
    }

    if (!isDemo) return; // Normal production: nothing to do.

    // Demo mode: block rendering until the worker is active so that the first
    // login request is guaranteed to be intercepted by MSW.
    setReady(false);
    let active = true;
    const fallback = window.setTimeout(() => { if (active) setReady(true); }, 4_000);
    import("./browser")
      .then(({ startWorker }) => startWorker())
      .catch(() => {})
      .finally(() => { window.clearTimeout(fallback); if (active) setReady(true); });
    return () => { active = false; window.clearTimeout(fallback); };
  }, []);

  if (!ready) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-slate-50"
        role="status"
        aria-label="Preparing workspace"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  return children;
}
