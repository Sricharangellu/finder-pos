"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { StoreAuthProvider, useStoreAuth } from "@/contexts/StoreAuthContext";

// ── Auth guard (inside provider) ──────────────────────────────────────────────

function StoreGuard({ children }: { children: React.ReactNode }) {
  const { customer, loading } = useStoreAuth();
  const pathname = usePathname();
  const router   = useRouter();

  const isLoginPage = pathname === "/store/login";

  useEffect(() => {
    if (!loading && !customer && !isLoginPage) {
      router.replace("/store/login");
    }
    if (!loading && customer && isLoginPage) {
      router.replace("/store");
    }
  }, [loading, customer, isLoginPage, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#5D5FEF] border-t-transparent" />
      </div>
    );
  }

  if (!customer && !isLoginPage) return null;

  return <>{children}</>;
}

// ── Store header ──────────────────────────────────────────────────────────────

function StoreHeader() {
  const { customer, logout } = useStoreAuth();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        {/* Brand */}
        <a href="/store" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#5D5FEF]">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 01-8 0"/>
            </svg>
          </div>
          <span className="text-base font-bold text-[#111]">FinderPOS Store</span>
        </a>

        {/* Nav */}
        <nav className="flex items-center gap-4">
          {customer ? (
            <>
              <a href="/store" className="hidden sm:block text-sm font-medium text-slate-500 hover:text-[#111] transition-colors">
                Products
              </a>
              {/* Customer menu */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/store/account")}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#5D5FEF] text-[11px] font-bold text-white">
                    {customer.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:inline">{customer.name.split(" ")[0]}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void logout().then(() => router.replace("/store/login"))}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors"
                  title="Sign out"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            </>
          ) : (
            <a href="/store/login" className="rounded-xl bg-[#5D5FEF] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#4849d0] transition-colors">
              Sign in
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

function StoreLayoutInner({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      import("@/mocks/browser").then(({ startWorker }) => startWorker()).catch(() => {});
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <StoreHeader />
      <main>
        <StoreGuard>{children}</StoreGuard>
      </main>
      <footer className="mt-16 border-t border-slate-200 bg-white py-8 text-center text-xs text-slate-400">
        Powered by FinderPOS · Private store — members only
      </footer>
    </div>
  );
}

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreAuthProvider>
      <StoreLayoutInner>{children}</StoreLayoutInner>
    </StoreAuthProvider>
  );
}
