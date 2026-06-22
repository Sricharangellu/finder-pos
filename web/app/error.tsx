"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to error monitoring (Sentry etc.) when wired in production.
    if (process.env.NODE_ENV !== "production") console.error("[GlobalError]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-page-bg)] px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
      </div>
      <h1 className="mt-4 text-xl font-bold text-[var(--color-text-primary)]">Something went wrong</h1>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        An unexpected error occurred. If this keeps happening, contact support.
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-[var(--color-text-secondary)]">
          Error ID: {error.digest}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-[var(--color-primary)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
        >
          Try again
        </button>
        <a
          href="/terminal"
          className="rounded-lg border border-[var(--color-table-border)] px-5 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-page-bg)]"
        >
          Go to terminal
        </a>
      </div>
    </div>
  );
}
