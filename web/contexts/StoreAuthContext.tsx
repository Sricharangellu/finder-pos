"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoreCustomer {
  id: string;
  name: string;
  email: string;
  created_at: number;
}

interface StoreAuthState {
  customer: StoreCustomer | null;
  token: string | null;
  loading: boolean;
  /** True while storefront customer auth has no real backend — the account
   *  surface is a UI preview and login/register are disabled outside mocks. */
  previewMode: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const TOKEN_KEY = "ascend_store_token";

// The /api/v1/ecommerce/auth/* endpoints exist only as MSW mocks — there is no
// backend customer-auth surface yet (see AUDIT_2026-07-18T005030Z §2). Until
// one ships, storefront auth is Preview-only: with mocks off (real backend)
// it is disabled up front instead of failing with a confusing 404 after submit.
// Mirrors MockWorkerInit's ENV_MOCKS switch, plus the runtime demo-mode flag.
function storeAuthPreview(): boolean {
  if (process.env.NEXT_PUBLIC_STORE_AUTH_ENABLED === "1") return false; // real backend shipped
  const envMocks =
    process.env.NEXT_PUBLIC_MOCK === "true" ||
    (process.env.NEXT_PUBLIC_MOCK !== "false" && process.env.NODE_ENV === "development");
  const demoMode =
    typeof window !== "undefined" && window.localStorage.getItem("finder_pos_demo") === "1";
  return !envMocks && !demoMode; // mocks answer these routes → usable; otherwise preview
}

// ── Context ───────────────────────────────────────────────────────────────────

const StoreAuthContext = createContext<StoreAuthState>({
  customer: null, token: null, loading: true, previewMode: true,
  login: async () => {}, register: async () => {}, logout: async () => {},
});

export function useStoreAuth() {
  return useContext(StoreAuthContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit, token?: string | null): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { ...opts, headers: { ...headers, ...(opts?.headers as Record<string, string> ?? {}) } });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data as T;
}

export function StoreAuthProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<StoreCustomer | null>(null);
  const [token, setToken]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [previewMode, setPreviewMode] = useState(true);

  // Restore session on mount
  useEffect(() => {
    setPreviewMode(storeAuthPreview()); // client-side: demo-mode flag is readable here
    const saved = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (!saved) { setLoading(false); return; }
    setToken(saved);
    apiFetch<StoreCustomer>("/api/v1/ecommerce/auth/me", {}, saved)
      .then((c) => setCustomer(c))
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (storeAuthPreview()) {
      throw new Error("Store accounts are a preview — customer sign-in isn't available yet.");
    }
    const res = await apiFetch<{ token: string; customer: StoreCustomer }>(
      "/api/v1/ecommerce/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    localStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setCustomer(res.customer);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    if (storeAuthPreview()) {
      throw new Error("Store accounts are a preview — registration isn't available yet.");
    }
    const res = await apiFetch<{ token: string; customer: StoreCustomer }>(
      "/api/v1/ecommerce/auth/register",
      { method: "POST", body: JSON.stringify({ name, email, password }) },
    );
    localStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setCustomer(res.customer);
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      await apiFetch("/api/v1/ecommerce/auth/logout", { method: "POST" }, token).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setCustomer(null);
  }, [token]);

  return (
    <StoreAuthContext.Provider value={{ customer, token, loading, previewMode, login, register, logout }}>
      {children}
    </StoreAuthContext.Provider>
  );
}
