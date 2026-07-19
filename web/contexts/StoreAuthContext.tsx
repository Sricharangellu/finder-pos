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
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const TOKEN_KEY = "ascend_store_token";

// ── Context ───────────────────────────────────────────────────────────────────

const StoreAuthContext = createContext<StoreAuthState>({
  customer: null, token: null, loading: true,
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

  // Restore session on mount
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (!saved) { setLoading(false); return; }
    setToken(saved);
    apiFetch<StoreCustomer>("/api/v1/ecommerce/auth/me", {}, saved)
      .then((c) => setCustomer(c))
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ token: string; customer: StoreCustomer }>(
      "/api/v1/ecommerce/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    localStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setCustomer(res.customer);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
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
    <StoreAuthContext.Provider value={{ customer, token, loading, login, register, logout }}>
      {children}
    </StoreAuthContext.Provider>
  );
}
