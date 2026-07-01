"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { fmtDate } from "@/lib/date";
import type { LoyaltyTier, LoyaltyMember, LoyaltyMembersResponse, LoyaltyTierLevel } from "@/api-client/types";

const TIER_BADGE: Record<LoyaltyTierLevel, "yellow" | "gray" | "green" | "purple"> = {
  bronze: "yellow",
  silver: "gray",
  gold: "green",
  platinum: "purple",
};

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelCls = "mb-1 block text-sm font-medium text-slate-700";

// ── AdjustModal ────────────────────────────────────────────────────────────────

function AdjustModal({
  member,
  onSave,
  onClose,
}: {
  member: LoyaltyMember;
  onSave: () => void;
  onClose: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = Number(delta);
    if (!d || isNaN(d)) { setErr("Enter a non-zero number of points."); return; }
    setSaving(true); setErr(null);
    try {
      await apiPost(`/api/v1/loyalty/members/${member.id}/adjust`, { delta: d, reason: reason.trim() || undefined });
      onSave();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiResponseError ? e.message : "Failed to adjust points.");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex w-full max-w-sm flex-col rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Adjust Points</h2>
          <button type="button" onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-slate-600">&times;</button>
        </div>
        <form id="adjust-form" onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <p className="font-medium text-slate-950">{member.customer_name}</p>
            <p className="text-slate-500">Current balance: <span className="font-medium text-slate-700">{member.points_balance.toLocaleString()} pts</span></p>
          </div>
          <div>
            <label className={labelCls}>Points adjustment <span className="text-red-500">*</span></label>
            <input className={inputCls} type="number" value={delta} onChange={e => setDelta(e.target.value)}
              placeholder="e.g. +50 to add, -20 to deduct" required />
            <p className="mt-1 text-xs text-slate-400">Positive adds points · Negative deducts points</p>
          </div>
          <div>
            <label className={labelCls}>Reason <span className="font-normal text-slate-400">(optional)</span></label>
            <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Goodwill adjustment, correction" />
          </div>
        </form>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" form="adjust-form" disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Apply adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MembersTab ─────────────────────────────────────────────────────────────────

export function MembersTab({ tiers }: { tiers: LoyaltyTier[] }) {
  const [members, setMembers] = useState<LoyaltyMember[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [adjustMember, setAdjustMember] = useState<LoyaltyMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (filterTier !== "all") params.set("tier_id", filterTier);
      const data = await apiGet<LoyaltyMembersResponse>(`/api/v1/loyalty/members?${params}`);
      setMembers(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load members.");
    } finally { setLoading(false); }
  }, [search, filterTier]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-48 flex-1">
            <input className={inputCls} placeholder="Search members…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterTier} onChange={e => setFilterTier(e.target.value)}>
            <option value="all">All tiers</option>
            {tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <span className="text-sm text-slate-500">{total} members</span>
        </div>

        {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

        {loading ? (
          <TableSkeleton headers={["Customer", "Tier", "Balance", "Lifetime", "Joined", ""]} rows={8} />
        ) : members.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">No members found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">Lifetime</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map(m => (
                <tr key={m.id} className="transition-colors hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">{m.customer_name}</p>
                    {m.customer_email && <p className="text-xs text-slate-400">{m.customer_email}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={TIER_BADGE[m.tier_level as LoyaltyTierLevel]}>{m.tier_name}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-950">
                    {m.points_balance.toLocaleString()} pts
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                    {m.points_lifetime.toLocaleString()} pts
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(m.joined_at)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setAdjustMember(m)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                      Adjust pts
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {adjustMember && (
        <AdjustModal member={adjustMember} onSave={load} onClose={() => setAdjustMember(null)} />
      )}
    </>
  );
}
