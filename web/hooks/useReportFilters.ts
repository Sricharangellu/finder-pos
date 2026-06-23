"use client";

/**
 * FE-48: useReportFilters — URL state management for report filter bars.
 *
 * Serialises the filter state into a base64 JSON ?definition= URL param so
 * every report view is bookmarkable, shareable, and deep-linkable.
 *
 * JSON shape (Implementation Prompt §6.1 + §16):
 * {
 *   metric, dimension, granularity,
 *   periodType, periodCount, startDate, endDate, comparison,
 *   order: { column, direction },
 *   reportView, optionalAggregates, constraints
 * }
 *
 * Usage:
 *   const { filters, setFilter, toParams } = useReportFilters({ metric: "revenue" });
 *   const queryString = toParams();  // ?from=...&to=...
 */

import { useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export type Granularity   = "day" | "week" | "month";
export type Comparison    = "none" | "previous_period" | "previous_year";
export type ReportView    = "table" | "chart";
export type SortDirection = "asc" | "desc";

export interface ReportDefinition {
  metric?: string;
  dimension?: string;
  granularity?: Granularity;
  periodType?: "relative" | "absolute";
  periodCount?: number;
  startDate?: string;      // YYYY-MM-DD
  endDate?: string;        // YYYY-MM-DD
  comparison?: Comparison;
  order?: { column: string; direction: SortDirection };
  reportView?: ReportView;
  optionalAggregates?: string[];
  constraints?: Record<string, string>;
}

const DEFAULTS: ReportDefinition = {
  granularity: "day",
  periodType: "relative",
  periodCount: 30,
  comparison: "none",
  reportView: "table",
};

function encode(def: ReportDefinition): string {
  return btoa(JSON.stringify(def));
}

function decode(b64: string): ReportDefinition {
  try {
    return JSON.parse(atob(b64)) as ReportDefinition;
  } catch {
    return {};
  }
}

/** Convert a ReportDefinition to API query params (from/to/etc). */
export function definitionToParams(def: ReportDefinition): URLSearchParams {
  const p = new URLSearchParams();
  if (def.startDate) p.set("from", String(new Date(def.startDate).getTime()));
  if (def.endDate)   p.set("to",   String(new Date(def.endDate + "T23:59:59").getTime()));
  if (def.periodType === "relative" && def.periodCount && !def.startDate) {
    const from = Date.now() - def.periodCount * 86_400_000;
    p.set("from", String(from));
  }
  if (def.dimension) p.set("dimension", def.dimension);
  if (def.metric)    p.set("metric", def.metric);
  if (def.order)     p.set("sort", `${def.order.column}:${def.order.direction}`);
  return p;
}

export function useReportFilters(initial: ReportDefinition = {}) {
  const router    = useRouter();
  const pathname  = usePathname();
  const params    = useSearchParams();
  const initRef   = useRef({ ...DEFAULTS, ...initial });

  // Read current definition from URL or fall back to defaults.
  const filters: ReportDefinition = useMemo(() => {
    const raw = params.get("definition");
    return raw ? { ...initRef.current, ...decode(raw) } : initRef.current;
  }, [params]);

  // Write a new filter value and push to URL.
  const setFilter = useCallback(
    <K extends keyof ReportDefinition>(key: K, value: ReportDefinition[K]) => {
      const next = { ...filters, [key]: value };
      const encoded = encode(next);
      router.replace(`${pathname}?definition=${encoded}`, { scroll: false });
    },
    [filters, pathname, router],
  );

  // Bulk-update filters in one navigation.
  const setFilters = useCallback(
    (patch: Partial<ReportDefinition>) => {
      const next = { ...filters, ...patch };
      const encoded = encode(next);
      router.replace(`${pathname}?definition=${encoded}`, { scroll: false });
    },
    [filters, pathname, router],
  );

  // Reset all filters to initial defaults.
  const resetFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  // Convert to API query params string.
  const toParams = useCallback(
    () => definitionToParams(filters).toString(),
    [filters],
  );

  return { filters, setFilter, setFilters, resetFilters, toParams };
}
