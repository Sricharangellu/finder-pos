"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UserProfile } from "@/api-client/types";
import { useAuth } from "@/lib/useAuth";

export type ReportGranularity = "day" | "week" | "month";
export type ComparisonPeriod = "none" | "previous_period" | "previous_year";

export interface FinderDateRange {
  startDate: string;
  endDate: string;
  preset: "today" | "current_week" | "current_month" | "custom";
}

interface PersistedFinderContext {
  storeId: string;
  outletId: string;
  dateRange: FinderDateRange;
  comparisonPeriod: ComparisonPeriod;
  granularity: ReportGranularity;
  registerId: string;
  activeSessionId: string | null;
}

interface FinderContextValue extends PersistedFinderContext {
  currentUser: UserProfile | null;
  setStoreId: (value: string) => void;
  setOutletId: (value: string) => void;
  setDateRange: (value: FinderDateRange) => void;
  setComparisonPeriod: (value: ComparisonPeriod) => void;
  setGranularity: (value: ReportGranularity) => void;
  setRegisterId: (value: string) => void;
  setActiveSessionId: (value: string | null) => void;
  setLocation: (outletId: string, registerId: string) => void;
}

const STORAGE_KEY = "ascend_global_context_v1";

function currentWeek(): FinderDateRange {
  const now = new Date();
  const start = new Date(now);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end), preset: "current_week" };
}

const DEFAULT_STATE: PersistedFinderContext = {
  storeId: "demo-store",
  outletId: "all",
  dateRange: currentWeek(),
  comparisonPeriod: "none",
  granularity: "day",
  registerId: "reg_01",
  activeSessionId: null,
};

const FinderContext = createContext<FinderContextValue | null>(null);

export function FinderContextProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<PersistedFinderContext>(DEFAULT_STATE);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      setState((current) => ({ ...current, ...(JSON.parse(saved) as Partial<PersistedFinderContext>) }));
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Reconcile the persisted register selection with the backend's actual
  // registers. The default "reg_01" only exists in mock data — a real tenant
  // gets generated register ids, and a stale selection strands the terminal
  // on "register not found" until the user manually switches. Runs once on
  // mount: the API client transparently refreshes the session on 401, and a
  // fully unauthenticated visitor just falls into the catch below. (Do not
  // gate this on the user profile — it lives in sessionStorage and is empty
  // after a browser restart even when the refresh cookie is still valid.)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { apiGet } = await import("@/api-client/client");
        const res = await apiGet<{ items: Array<{ id: string; registers?: Array<{ id: string }> }> }>(
          "/api/v1/outlets",
        );
        if (cancelled) return;
        const registers = res.items.flatMap((o) =>
          (o.registers ?? []).map((r) => ({ outletId: o.id, registerId: r.id })),
        );
        if (registers.length === 0) return;
        setState((current) => {
          if (registers.some((r) => r.registerId === current.registerId)) return current;
          const first = registers[0]!;
          return { ...current, outletId: first.outletId, registerId: first.registerId };
        });
      } catch {
        // Offline or unauthenticated — keep the persisted selection.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback(<K extends keyof PersistedFinderContext>(key: K, value: PersistedFinderContext[K]) => {
    setState((current) => ({ ...current, [key]: value }));
  }, []);

  const setStoreId = useCallback((next: string) => update("storeId", next), [update]);
  const setOutletId = useCallback((next: string) => update("outletId", next), [update]);
  const setDateRange = useCallback((next: FinderDateRange) => update("dateRange", next), [update]);
  const setComparisonPeriod = useCallback((next: ComparisonPeriod) => update("comparisonPeriod", next), [update]);
  const setGranularity = useCallback((next: ReportGranularity) => update("granularity", next), [update]);
  const setRegisterId = useCallback((next: string) => update("registerId", next), [update]);
  const setActiveSessionId = useCallback((next: string | null) => update("activeSessionId", next), [update]);
  const setLocation = useCallback((outletId: string, registerId: string) => {
    setState((current) => ({ ...current, outletId, registerId }));
  }, []);

  const value = useMemo<FinderContextValue>(() => ({
    ...state,
    currentUser: user,
    setStoreId,
    setOutletId,
    setDateRange,
    setComparisonPeriod,
    setGranularity,
    setRegisterId,
    setActiveSessionId,
    setLocation,
  }), [
    setActiveSessionId,
    setComparisonPeriod,
    setDateRange,
    setGranularity,
    setLocation,
    setOutletId,
    setRegisterId,
    setStoreId,
    state,
    user,
  ]);

  return <FinderContext.Provider value={value}>{children}</FinderContext.Provider>;
}

export function useFinderContext(): FinderContextValue {
  const context = useContext(FinderContext);
  if (!context) throw new Error("useFinderContext must be used within FinderContextProvider");
  return context;
}
