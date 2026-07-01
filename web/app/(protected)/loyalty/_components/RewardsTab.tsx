"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { LoyaltyReward, LoyaltyRewardsResponse, LoyaltyRewardStatus } from "@/api-client/types";

const REWARD_STATUS_BADGE: Record<LoyaltyRewardStatus, "green" | "yellow" | "gray"> = {
  active: "green",
  inactive: "yellow",
  archived: "gray",
};

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelCls = "mb-1 block text-sm font-medium text-slate-700";

// ── RewardModal ────────────────────────────────────────────────────────────────

function RewardModal({
  reward,
  onSave,
  onClose,
}: {
  reward: LoyaltyReward | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(reward?.name ?? "");
  const [description, setDescription] = useState(reward?.description ?? "");
  const [pointsCost, setPointsCost] = useState(String(reward?.points_cost ?? "100"));
  const [discountDollars, setDiscountDollars] = useState(
    reward ? String((reward.discount_cents / 100).toFixed(2)) : "0.00"
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        points_cost: Number(pointsCost),
        discount_cents: Math.round(parseFloat(discountDollars) * 100),
      };
      if (reward) {
        await apiPatch(`/api/v1/loyalty/rewards/${reward.id}`, body);
      } else {
        await apiPost("/api/v1/loyalty/rewards", body);
      }
      onSave();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiResponseError ? e.message : "Failed to save reward.");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex w-full max-w-md flex-col rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">{reward ? "Edit Reward" : "New Reward"}</h2>
          <button type="button" onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-slate-600">&times;</button>
        </div>
        <form id="reward-form" onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <div>
            <label className={labelCls}>Reward name <span className="text-red-500">*</span></label>
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. $10 Off Next Purchase" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Points cost <span className="text-red-500">*</span></label>
              <input className={inputCls} type="number" min="1"
                value={pointsCost} onChange={e => setPointsCost(e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Discount value ($)</label>
              <input className={inputCls} type="number" min="0" step="0.01"
                value={discountDollars} onChange={e => setDiscountDollars(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Description <span className="font-normal text-slate-400">(optional)</span></label>
            <textarea className={`${inputCls} resize-none`} rows={2} value={description}
              onChange={e => setDescription(e.target.value)} placeholder="What the member receives" />
          </div>
        </form>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" form="reward-form" disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : (reward ? "Save changes" : "Create reward")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RewardsTab ─────────────────────────────────────────────────────────────────

export function RewardsTab() {
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<LoyaltyRewardStatus | "all">("all");
  const [editReward, setEditReward] = useState<LoyaltyReward | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = filterStatus !== "all" ? `?status=${filterStatus}` : "";
      const data = await apiGet<LoyaltyRewardsResponse>(`/api/v1/loyalty/rewards${params}`);
      setRewards(data.items);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load rewards.");
    } finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (reward: LoyaltyReward) => {
    try {
      const newStatus: LoyaltyRewardStatus = reward.status === "active" ? "inactive" : "active";
      await apiPatch(`/api/v1/loyalty/rewards/${reward.id}`, { status: newStatus });
      await load();
    } catch (e) {
      alert(e instanceof ApiResponseError ? e.message : "Failed to update reward.");
    }
  };

  const handleArchive = async (reward: LoyaltyReward) => {
    if (!confirm(`Archive "${reward.name}"? It will no longer be available for redemption.`)) return;
    try {
      await apiDelete(`/api/v1/loyalty/rewards/${reward.id}`);
      await load();
    } catch (e) {
      alert(e instanceof ApiResponseError ? e.message : "Failed to archive reward.");
    }
  };

  const activeCount = rewards.filter(r => r.status === "active").length;

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Rewards Catalogue</h2>
              <p className="text-sm text-slate-500">{activeCount} active rewards</p>
            </div>
            <select
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as LoyaltyRewardStatus | "all")}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <button onClick={() => setEditReward(null)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            + New reward
          </button>
        </div>

        {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

        {loading ? (
          <TableSkeleton headers={["Reward", "Points cost", "Value", "Redeemed", "Status", ""]} rows={6} />
        ) : rewards.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">No rewards found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Reward</th>
                <th className="px-4 py-3 text-right">Points cost</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-right">Redeemed</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rewards.map(r => (
                <tr key={r.id} className="transition-colors hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">{r.name}</p>
                    {r.description && <p className="text-xs text-slate-400">{r.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-950">
                    {r.points_cost.toLocaleString()} pts
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {r.discount_cents > 0 ? formatMoney(r.discount_cents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                    {r.redemption_count.toLocaleString()}×
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={REWARD_STATUS_BADGE[r.status as LoyaltyRewardStatus]}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => handleToggle(r)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                        {r.status === "active" ? "Deactivate" : "Activate"}
                      </button>
                      <button onClick={() => setEditReward(r)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                        Edit
                      </button>
                      <button onClick={() => handleArchive(r)}
                        className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                        Archive
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editReward !== undefined && (
        <RewardModal reward={editReward} onSave={load} onClose={() => setEditReward(undefined)} />
      )}
    </>
  );
}
