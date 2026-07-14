"use client";

import { Fragment, useMemo, useState } from "react";
import { TableSkeleton } from "@/components/TableSkeleton";
import { formatMoney } from "@/lib/money";
import { CustomerDetailPanel } from "./CustomerDetailPanel";
import type { CustomerView } from "./CustomerDetailPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#F97316", "#EAB308", "#8B5CF6", "#10B981", "#EC4899", "#3B82F6"];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

function customerCode(id: string, name: string): string {
  const slug = (name.split(" ")[0] ?? "Customer").replace(/[^a-zA-Z]/g, "");
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `${slug}-${String(Math.abs(h) % 10000).padStart(4, "0")}`;
}

// ── GroupBadge ────────────────────────────────────────────────────────────────

function GroupBadge({ segment }: { segment: CustomerView["segment"] }) {
  const color =
    segment === "Loyal" ? "border-emerald-500 text-emerald-400" :
    segment === "New" ? "border-blue-500 text-blue-400" :
    segment === "At risk" ? "border-amber-500 text-amber-400" :
    "border-slate-400 text-slate-400";
  return (
    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {segment}
    </span>
  );
}

// ── CustomerTable ─────────────────────────────────────────────────────────────

type SegmentFilter = "All" | "Loyal" | "Regular" | "New" | "At risk";

interface Props {
  customers: CustomerView[];
  loading: boolean;
  error: string | null;
}

export function CustomerTable({ customers, loading, error }: Props) {
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<SegmentFilter>("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      const code = customerCode(c.id, c.name).toLowerCase();
      const matchQ = !q ||
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        code.includes(q);
      const matchGroup = groupFilter === "All" || c.segment === groupFilter;
      return matchQ && matchGroup;
    });
  }, [customers, query, groupFilter]);

  return (
    <>
      {/* Filter bar */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-3 px-4 py-4">
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Search by name / code / contact
            </label>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, phone, or code…"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
            />
          </div>
          <div className="w-44">
            <label className="mb-1 block text-xs font-medium text-slate-500">Customer group</label>
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value as SegmentFilter)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
            >
              <option value="All">All groups</option>
              <option value="Loyal">Loyal</option>
              <option value="Regular">Regular</option>
              <option value="New">New</option>
              <option value="At risk">At risk</option>
            </select>
          </div>
          <div className="ml-auto flex items-center gap-4 pb-0.5">
            <button
              type="button"
              onClick={() => { setQuery(""); setGroupFilter("All"); }}
              className="text-sm text-brand-600 hover:underline"
            >
              Clear filters
            </button>
            <button type="button" className="text-sm text-slate-500 hover:text-slate-700">
              More filters
            </button>
            <button
              type="button"
              className="rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0]"
            >
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <span className="text-sm text-slate-500">{visible.length} customers</span>
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
        </div>

        {loading ? (
          <TableSkeleton headers={["Customer", "Loyalty", "Account", ""]} rows={8} />
        ) : error ? (
          <div className="p-6 text-sm text-red-600" role="alert">{error}</div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-[#111]">No customers found.</p>
            <p className="mt-1 text-sm text-[#666]">Try clearing the filters or add a new customer.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" className="rounded border-slate-300" aria-label="Select all" />
                </th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Loyalty</th>
                <th className="px-4 py-3 text-left">Account</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((c) => (
                <Fragment key={c.id}>
                  <tr
                    className="cursor-pointer hover:bg-[#FAFAFA]"
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="rounded border-slate-300" aria-label={`Select ${c.name}`} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                          style={{ backgroundColor: avatarColor(c.name) }}
                        >
                          {avatarInitials(c.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[#111]">{c.name}</span>
                            <GroupBadge segment={c.segment} />
                          </div>
                          <div className="mt-0.5 text-xs text-[#666]">
                            {customerCode(c.id, c.name)}{c.phone ? ` | ${c.phone}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-[#111]">{c.loyaltyPoints.toLocaleString()}</span>
                      <span className="ml-1 text-xs text-[#666]">pts</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-[#111]">{formatMoney(c.spendCents)}</span>
                      <span className="ml-1 text-xs text-[#666]">lifetime</span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button type="button" aria-label={`Edit ${c.name}`} className="text-slate-400 hover:text-brand-600">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </td>
                  </tr>

                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <CustomerDetailPanel customer={c} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
