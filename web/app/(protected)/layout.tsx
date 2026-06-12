"use client";

/**
 * Protected route layout — wraps all routes under app/(protected)/.
 *
 * Enforces authentication: if the user is not logged in (and no valid
 * refresh token exists), redirects to /login.
 *
 * This is a Client Component because it reads the in-memory auth state.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { OfflineBanner } from "@/components/OfflineBanner";
import { getUser } from "@/lib/auth";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  // Loading: attempting silent refresh — show nothing to avoid flash
  if (status === "loading") {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-gray-50"
        aria-label="Loading…"
        aria-busy="true"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  // Unauthenticated: redirect is in flight; render nothing
  if (status === "unauthenticated") {
    return null;
  }

  const role = getUser()?.role ?? "cashier";
  const canSeeReports = role === "owner" || role === "manager";

  return (
    <div className="flex min-h-screen flex-col">
      <OfflineBanner />
      <nav
        aria-label="Primary"
        className="flex items-center gap-1 border-b border-gray-200 bg-white px-4 py-2"
      >
        <span className="mr-2 font-bold text-brand-600">Finder POS</span>
        <Link
          href="/terminal"
          className="rounded px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Terminal
        </Link>
        {canSeeReports ? (
          <Link
            href="/reports"
            className="rounded px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Reports
          </Link>
        ) : null}
      </nav>
      {children}
    </div>
  );
}
