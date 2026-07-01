"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import type { LoyaltyTier, LoyaltyTiersResponse, LoyaltyTierLevel } from "@/api-client/types";

const TIER_BADGE: Record<LoyaltyTierLevel, "yellow" | "gray" | "green" | "purple"> = {
  bronze: "yellow",
  silver: "gray",
  gold: "green",
  platinum: "purple",
};

const TIER_LEVELS: LoyaltyTierLevel[] = ["bronze", "silver", "gold", "platinum"];

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelCls = "mb-1 block text-sm font-medium text-slate-700";

// ── TierModal ──────────────────────────────────────────────────────────────────

function TierModal({
  tier,
  onSave,
  onClose,
}: {
  tier: LoyaltyTier | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(tier?.name ?? "");
  const [level, setLevel] = useState<LoyaltyTierLevel>(tier?.level ?? "bronze");
  const [pointsRequired, setPointsRequired] = useState(String(tier?.points_required ?? "0"));
  const [discountPct, setDiscountPct] = useState(String(tier?.discount_pct ?? "0"));
  const [description, setDescription] = useState(tier?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const body = {
        name: name.trim(),
        level,
        points_required: Number(pointsRequired),
        discount_pct: Number(discountPct),
        description: description.trim() || null,
      };
      if (tier) {
        await apiPatch(`/api/v1/loyalty/tiers/${tier.id}`, body);
      } else {
        await apiPost("/api/v1/loyalty/tiers", body);
      }
      onSave();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiResponseError ? e.message : "Failed to save tier.");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex w-full max-w-md flex-col rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">{tier ? "Edit Tier" : "New Tier"}</h2>
          <button type="button" onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-slate-600">&times;</button>
        </div>
        <form id="tier-form" onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <div>
            <label className={labelCls}>Tier name <span className="text-red-500">*</span></label>
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Gold" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Level <span className="text-red-500">*</span></label>
              <select className={inputCls} value={level} onChange={e => setLevel(e.target.value as LoyaltyTierLevel)}>
                {TIER_LEVELS.map(l => (
                  <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Discount %</label>
              <input className={inputCls} type="number" min="0" max="100" step="0.5"
                value={discountPct} onChange={e => setDiscountPct(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Points required to reach this tier</label>
            <input className={inputCls} type="number" min="0"
              value={pointsRequired} onChange={e => setPointsRequired(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className={labelCls}>Description <span className="font-normal text-slate-400">(optional)</span></label>
            <textarea className={`${inputCls} resize-none`} rows={2} value={description}
              onChange={e => setDescription(e.target.value)} placeholder="Shown to customers in loyalty emails" />
          </div>
        </form>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" form="tier-form" disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : (tier ? "Save changes" : "Create tier")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TiersTab ───────────────────────────────────────────────────────────────────

export function TiersTab() {
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editTier, setEditTier] = useState<LoyaltyTier | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<LoyaltyTiersResponse>("/api/v1/loyalty/tiers");
      setTiers(data.items);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load tiers.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (tier: LoyaltyTier) => {
    if (!confirm(`Delete the "${tier.name}" tier? This cannot be undone.`)) return;
    try {
      await apiDelete(`/api/v1/loyalty/tiers/${tier.id}`);
      await load();
    } catch (e) {
      alert(e instanceof ApiResponseError ? e.message : "Failed to delete tier.");
    }
  };

  const totalMembers = tiers.reduce((s, t) => s + t.member_count, 0);

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Loyalty Tiers</h2>
            <p className="text-sm text-slate-500">{tiers.length} tiers · {totalMembers} total members</p>
          </div>
          <button onClick={() => setEditTier(null)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            + New tier
          </button>
        </div>

        {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

        {loading ? (
          <TableSkeleton headers={["Tier", "Threshold", "Discount", "Members"]} rows={4} />
        ) : tiers.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">No tiers configured yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {tiers.map(tier => (
              <div key={tier.id} className="flex items-center gap-4 px-4 py-4 hover:bg-slate-50">
                <div className="shrink-0">
                  <Badge variant={TIER_BADGE[tier.level]}>{tier.name}</Badge>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-950">{tier.points_required.toLocaleString()} pts required</span>
                    {tier.discount_pct > 0 && (
                      <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">
                        {tier.discount_pct}% discount
                      </span>
                    )}
                  </div>
                  {tier.description && <p className="truncate text-sm text-slate-500">{tier.description}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-sm font-medium text-slate-950">{tier.member_count}</span>
                  <span className="text-sm text-slate-400"> members</span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => setEditTier(tier)}
                    className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(tier)}
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <span className="font-medium">How tiers work: </span>
        Members are promoted automatically when their lifetime points reach a tier threshold.
        Discounts apply to the subtotal of every order. Bronze is the entry tier (0 pts required).
      </div>

      {editTier !== undefined && (
        <TierModal tier={editTier} onSave={load} onClose={() => setEditTier(undefined)} />
      )}
    </>
  );
}
