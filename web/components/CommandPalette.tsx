"use client";

/**
 * CommandPalette — ⌘K / Ctrl+K global search overlay.
 *
 * Triggered by:
 *   - keyboard shortcut (⌘K on Mac, Ctrl+K elsewhere)
 *   - clicking the search button in EnterpriseShell header
 *
 * Behaviour:
 *   - Debounced fetch to GET /api/v1/search?q=
 *   - Results grouped by type (products, customers, orders, …)
 *   - Keyboard navigation: ↑ ↓ to move, Enter to navigate, Esc to close
 *   - Clicking a result navigates and closes the palette
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { apiGet, ApiResponseError } from "@/api-client/client";
import type { SearchHit, SearchResponse } from "@/api-client/types";

// ─── Route mapping ────────────────────────────────────────────────────────────

function hrefForHit(hit: SearchHit): string {
  switch (hit.type) {
    case "product":     return `/inventory`;
    case "customer":    return `/customers`;
    case "vendor":      return `/purchasing`;
    case "invoice":     return `/finance`;
    case "sales_order": return `/sales`;
    case "quotation":   return `/sales`;
    case "purchase_order": return `/purchasing`;
    case "order":       return `/orders`;
    default:            return `/dashboard`;
  }
}

const GROUP_LABELS: Record<string, string> = {
  products: "Products",
  customers: "Customers",
  vendors: "Vendors",
  invoices: "Invoices",
  salesOrders: "Sales Orders",
  quotations: "Quotations",
  purchaseOrders: "Purchase Orders",
  orders: "Orders",
};

// ─── Icons ────────────────────────────────────────────────────────────────────

function HitIcon({ type }: { type: SearchHit["type"] }) {
  switch (type) {
    case "product":
      return (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      );
    case "customer":
      return (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case "order":
      return (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 12h6" /><path d="M9 16h4" />
        </svg>
      );
    case "vendor":
    case "purchase_order":
      return (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9h18l-2-5H5L3 9Z" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" />
        </svg>
      );
    case "invoice":
    case "sales_order":
    case "quotation":
      return (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    default:
      return (
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
  }
}

// ─── CommandPalette ───────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Record<string, SearchHit[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // Flatten all hits in display order for keyboard nav
  const allHits = useMemo<SearchHit[]>(() => {
    return Object.values(results).flat();
  }, [results]);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults({});
      setError(null);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiGet<SearchResponse>(
          `/api/v1/search?q=${encodeURIComponent(q)}`,
        );
        setResults(data.results);
        setActiveIdx(0);
      } catch (err) {
        setError(
          err instanceof ApiResponseError ? err.message : "Search failed.",
        );
        setResults({});
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Focus input when opened, reset state when closed
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults({});
      setError(null);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const navigate = useCallback(
    (hit: SearchHit) => {
      router.push(hrefForHit(hit));
      onClose();
    },
    [router, onClose],
  );

  // Keyboard navigation within the palette
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (allHits.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % allHits.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + allHits.length) % allHits.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = allHits[activeIdx];
        if (hit) navigate(hit);
      }
    },
    [allHits, activeIdx, navigate, onClose],
  );

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-hit-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  const groupEntries = Object.entries(results).filter(
    ([, hits]) => hits.length > 0,
  );
  const hasResults = groupEntries.length > 0;
  let globalIdx = 0;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Panel */}
      <div
        className="mx-4 w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-slate-400"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            placeholder="Search products, orders, customers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder-slate-400 outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && (
            <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
          )}
          <kbd className="hidden shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-400 sm:block">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto">
          {!query.trim() ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-400">
                Type to search across products, orders, customers, and more.
              </p>
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          ) : !loading && !hasResults ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-400">
                No results for &ldquo;{query}&rdquo;
              </p>
            </div>
          ) : (
            <div className="py-2">
              {groupEntries.map(([group, hits]) => (
                <div key={group}>
                  <div className="px-4 pb-1 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {GROUP_LABELS[group] ?? group}
                    </p>
                  </div>
                  {hits.map((hit) => {
                    const idx = globalIdx++;
                    const isActive = idx === activeIdx;
                    return (
                      <button
                        key={hit.id}
                        type="button"
                        data-hit-idx={idx}
                        onClick={() => navigate(hit)}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          isActive
                            ? "bg-slate-950 text-white"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className={`shrink-0 ${isActive ? "text-slate-300" : "text-slate-400"}`}
                        >
                          <HitIcon type={hit.type} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {hit.label}
                          </span>
                          {hit.sublabel && (
                            <span
                              className={`block truncate text-xs ${isActive ? "text-slate-400" : "text-slate-400"}`}
                            >
                              {hit.sublabel}
                            </span>
                          )}
                        </span>
                        <span
                          className={`shrink-0 text-xs ${isActive ? "text-slate-400" : "text-slate-300"}`}
                        >
                          ↵
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5">↑</kbd>
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5">↵</kbd>
              open
            </span>
          </div>
          <span className="text-[11px] text-slate-400">Ascend Search</span>
        </div>
      </div>
    </div>
  );
}
