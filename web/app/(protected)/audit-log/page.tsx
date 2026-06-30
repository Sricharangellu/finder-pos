"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, ApiResponseError } from "@/api-client/client";
import type { AuditEvent, AuditLogResponse, AuditAction } from "@/api-client/types";
import { fmtDateTime } from "@/lib/date";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_BADGE: Record<AuditAction, "blue" | "green" | "red" | "yellow" | "gray" | "purple"> = {
  created: "green",
  updated: "blue",
  deleted: "red",
  login: "gray",
  logout: "gray",
  exported: "purple",
  refunded: "yellow",
  voided: "red",
  approved: "green",
  rejected: "red",
};

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  product: "Product",
  order: "Order",
  purchase_order: "Purchase Order",
  discount: "Discount",
  custom_role: "Custom Role",
  report: "Report",
  settings: "Settings",
  session: "Session",
};

const RESOURCE_TYPES = ["", "product", "order", "purchase_order", "discount", "custom_role", "report", "settings", "session"];
const ACTIONS: Array<"" | AuditAction> = ["", "created", "updated", "deleted", "login", "logout", "exported", "refunded", "voided", "approved", "rejected"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filters
  const [actorQ, setActorQ] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [action, setAction] = useState<"" | AuditAction>("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (actorQ.trim()) params.set("actor", actorQ.trim());
      if (resourceType) params.set("resource_type", resourceType);
      if (action) params.set("action", action);
      const data = await apiGet<AuditLogResponse>(`/api/v1/audit-log?${params.toString()}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load audit log.");
    } finally { setLoading(false); }
  }, [actorQ, resourceType, action, offset]);

  useEffect(() => { void load(); }, [load]);

  const applyFilters = () => { setOffset(0); void load(); };

  return (
    <EnterpriseShell active="audit-log" title="Audit Log" subtitle="Full history of user actions" contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Actor (email)</label>
            <input
              value={actorQ}
              onChange={e => setActorQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") applyFilters(); }}
              placeholder="Filter by email…"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-52 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Resource type</label>
            <select
              value={resourceType}
              onChange={e => { setResourceType(e.target.value); setOffset(0); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All types</option>
              {RESOURCE_TYPES.filter(Boolean).map(t => (
                <option key={t} value={t}>{RESOURCE_TYPE_LABELS[t] ?? t}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Action</label>
            <select
              value={action}
              onChange={e => { setAction(e.target.value as "" | AuditAction); setOffset(0); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All actions</option>
              {ACTIONS.filter(Boolean).map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <Button size="sm" variant="primary" onClick={applyFilters}>Apply</Button>
          <Button size="sm" variant="secondary" onClick={() => { setActorQ(""); setResourceType(""); setAction(""); setOffset(0); }}>Reset</Button>
          <span className="ml-auto text-sm text-gray-500 self-center">{total} events</span>
        </div>

        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3">{error}</p>}

        {/* Table */}
        {loading ? (
          <TableSkeleton headers={["When", "Actor", "Action", "Resource", "IP", ""]} rows={10} />
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-table-border)] py-16 text-center">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">No events match the current filters.</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Try resetting the filters.</p>
          </div>
        ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No events match the current filters.</td></tr>
              )}
              {!loading && items.map(ev => (
                <>
                  <tr
                    key={ev.id}
                    className={`hover:bg-gray-50 cursor-pointer ${expanded === ev.id ? "bg-blue-50" : ""}`}
                    onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                  >
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDateTime(ev.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 text-xs">{ev.actor.email}</div>
                      <div className="text-gray-400 text-xs capitalize">{ev.actor.role}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ACTION_BADGE[ev.action as AuditAction] ?? "gray"}>{ev.action}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{ev.resource_label}</div>
                      <div className="text-gray-400 text-xs">{RESOURCE_TYPE_LABELS[ev.resource_type] ?? ev.resource_type}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">{ev.ip_address ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{ev.changes ? "▾ details" : ""}</td>
                  </tr>
                  {expanded === ev.id && ev.changes && (
                    <tr key={`${ev.id}-details`} className="bg-blue-50">
                      <td colSpan={6} className="px-6 py-3">
                        <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Changes</p>
                        <div className="space-y-1">
                          {Object.entries(ev.changes).map(([field, { from, to }]) => (
                            <div key={field} className="flex items-center gap-3 text-xs">
                              <span className="font-mono text-gray-700 w-32 shrink-0">{field}</span>
                              <span className="text-red-600 line-through">{JSON.stringify(from)}</span>
                              <span className="text-gray-400">→</span>
                              <span className="text-green-700">{JSON.stringify(to)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))}>← Prev</Button>
              <Button size="sm" variant="secondary" disabled={offset + LIMIT >= total} onClick={() => setOffset(o => o + LIMIT)}>Next →</Button>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
