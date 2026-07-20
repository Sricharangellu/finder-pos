"use client";

import { useEffect, useState } from "react";

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

/**
 * Reads/writes the user's page-size preference to localStorage, scoped per
 * page via `storageKey` — falls back to `fallback` on the server or when
 * nothing's been saved yet.
 */
export function usePersistedPageSize(storageKey: string, fallback: number): [number, (n: number) => void] {
  const [pageSize, setPageSizeState] = useState(fallback);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
    const parsed = saved ? Number(saved) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) setPageSizeState(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const setPageSize = (n: number) => {
    setPageSizeState(n);
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, String(n));
  };

  return [pageSize, setPageSize];
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: {
  /** Zero-indexed current page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F0F0F0] bg-[#FAFAFA] px-5 py-3 text-sm text-[#555]">
      <div className="flex items-center gap-2">
        <label htmlFor="pagination-page-size" className="text-xs font-medium text-[#555]">Rows per page</label>
        <select
          id="pagination-page-size"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-brand-600 focus:outline-none"
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      <span className="tabular-nums">
        {total === 0 ? "0 results" : `${rangeStart}–${rangeEnd} of ${total}`}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page <= 0}
          className="h-8 rounded border border-[#D9D9D9] px-3 text-sm text-[#555] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Prev
        </button>
        <span className="px-2 text-xs tabular-nums text-[#888]">Page {page + 1} of {pageCount}</span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          disabled={page >= pageCount - 1}
          className="h-8 rounded border border-[#D9D9D9] px-3 text-sm text-[#555] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
