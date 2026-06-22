"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") console.error("[PageError]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
      </div>
      <h2 className="mt-4 text-lg font-semibold text-[var(--color-text-primary)]">This page crashed</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        An unexpected error occurred loading this page.
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-[var(--color-text-secondary)]">ID: {error.digest}</p>
      )}
      <div className="mt-5 flex gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/terminal"
          className="rounded-lg border border-[var(--color-table-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-page-bg)]"
        >
          Back to terminal
        </Link>
      </div>
    </div>
  );
}
