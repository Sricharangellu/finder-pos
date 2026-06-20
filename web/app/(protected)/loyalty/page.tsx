"use client";

/**
 * /loyalty — Loyalty Programme management.
 *
 * Three tabs:
 *  1. Tiers    — Define tier levels, points thresholds, and discounts
 *  2. Members  — Browse enrolled customers, filter by tier, adjust points
 *  3. Rewards  — Manage redeemable rewards and their points costs
 */

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type {
  LoyaltyTier,
  LoyaltyTiersResponse,
  LoyaltyTierLevel,
  LoyaltyMember,
  LoyaltyMembersResponse,
  LoyaltyReward,
  LoyaltyRewardsResponse,
  LoyaltyRewardStatus,
} from "@/api-client/types";

// ─── Constants ────────────────────────────────────────────────────────────────

type Tab = "tiers" | "members" | "rewards";

const TIER_BADGE: Record<LoyaltyTierLevel, "yellow" | "gray" | "green" | "purple"> = {
  bronze: "yellow",
  silver: "gray",
  gold: "green",
  platinum: "purple",
};

const REWARD_STATUS_BADGE: Record<LoyaltyRewardStatus, "green" | "yellow" | "gray"> = {
  active: "green",
  inactive: "yellow",
  archived: "gray",
};

const TIER_LEVELS: LoyaltyTierLevel[] = ["bronze", "silver", "gold", "platinum"];

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelCls = "mb-1 block text-sm font-medium text-slate-700";

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Tier Form Modal ──────────────────────────────────────────────────────────

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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">{tier ? "Edit Tier" : "New Tier"}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form id="tier-form" onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
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
            <label className={labelCls}>Description <span className="text-slate-400 font-normal">(optional)</span></label>
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

// ─── Tiers Tab ────────────────────────────────────────────────────────────────

function TiersTab() {
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editTier, setEditTier] = useState<LoyaltyTier | null | undefined>(undefined); // undefined = closed

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<LoyaltyTiersResponse>("/api/v1/loyalty/tiers");
      setTiers(data.items);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load tiers.");
    } finally {
      setLoading(false);
    }
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
          <p className="px-4 py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : tiers.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No tiers configured yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {tiers.map(tier => (
              <div key={tier.id} className="flex items-center gap-4 px-4 py-4 hover:bg-slate-50">
                {/* tier badge */}
                <div className="flex-shrink-0">
                  <Badge variant={TIER_BADGE[tier.level]}>{tier.name}</Badge>
                </div>
                {/* details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-950">{tier.points_required.toLocaleString()} pts required</span>
                    {tier.discount_pct > 0 && (
                      <span className="text-xs text-green-700 font-medium bg-green-50 rounded px-1.5 py-0.5">
                        {tier.discount_pct}% discount
                      </span>
                    )}
                  </div>
                  {tier.description && <p className="text-sm text-slate-500 truncate">{tier.description}</p>}
                </div>
                {/* member count */}
                <div className="text-right flex-shrink-0">
                  <span className="text-sm font-medium text-slate-950">{tier.member_count}</span>
                  <span className="text-sm text-slate-400"> members</span>
                </div>
                {/* actions */}
                <div className="flex gap-2 flex-shrink-0">
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
        <TierModal
          tier={editTier}
          onSave={load}
          onClose={() => setEditTier(undefined)}
        />
      )}
    </>
  );
}

// ─── Adjust Points Modal ──────────────────────────────────────────────────────

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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Adjust Points</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form id="adjust-form" onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
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
            <label className={labelCls}>Reason <span className="text-slate-400 font-normal">(optional)</span></label>
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

// ─── Members Tab ──────────────────────────────────────────────────────────────

function MembersTab({ tiers }: { tiers: LoyaltyTier[] }) {
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
    } finally {
      setLoading(false);
    }
  }, [search, filterTier]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex-1 min-w-48">
            <input className={inputCls} placeholder="Search members…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterTier} onChange={e => setFilterTier(e.target.value)}>
            <option value="all">All tiers</option>
            {tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <span className="text-sm text-slate-500">{total} members</span>
        </div>

        {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

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
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : members.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No members found.</td></tr>
            ) : members.map(m => (
              <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-950">{m.customer_name}</p>
                  {m.customer_email && <p className="text-xs text-slate-400">{m.customer_email}</p>}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={TIER_BADGE[m.tier_level as LoyaltyTierLevel]}>{m.tier_name}</Badge>
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-950 tabular-nums">
                  {m.points_balance.toLocaleString()} pts
                </td>
                <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
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
      </Card>

      {adjustMember && (
        <AdjustModal
          member={adjustMember}
          onSave={load}
          onClose={() => setAdjustMember(null)}
        />
      )}
    </>
  );
}

// ─── Reward Form Modal ────────────────────────────────────────────────────────

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
  const [discountDollars, setDiscountDollars] = useState(reward ? String((reward.discount_cents / 100).toFixed(2)) : "0.00");
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">{reward ? "Edit Reward" : "New Reward"}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form id="reward-form" onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
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
            <label className={labelCls}>Description <span className="text-slate-400 font-normal">(optional)</span></label>
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

// ─── Rewards Tab ──────────────────────────────────────────────────────────────

function RewardsTab() {
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
    } finally {
      setLoading(false);
    }
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
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : rewards.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No rewards found.</td></tr>
            ) : rewards.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 transition-colors">
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
      </Card>

      {editReward !== undefined && (
        <RewardModal
          reward={editReward}
          onSave={load}
          onClose={() => setEditReward(undefined)}
        />
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LoyaltyPage() {
  const [tab, setTab] = useState<Tab>("tiers");
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);

  // Pre-load tiers so the Members tab can use them for the filter dropdown
  useEffect(() => {
    apiGet<LoyaltyTiersResponse>("/api/v1/loyalty/tiers")
      .then(d => setTiers(d.items))
      .catch(() => {/* non-fatal — members tab still works */});
  }, []);

  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? "border-blue-600 text-blue-600"
        : "border-transparent text-slate-500 hover:text-slate-700"
    }`;

  const totalMembers = tiers.reduce((s, t) => s + t.member_count, 0);

  return (
    <EnterpriseShell
      active="loyalty"
      title="Loyalty Programme"
      subtitle="Tiers, members, and rewards"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">

        {/* Summary chips */}
        <div className="flex flex-wrap gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 ring-1 ring-blue-200">
            <span className="text-base font-semibold">{tiers.length}</span> Tiers
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700 ring-1 ring-green-200">
            <span className="text-base font-semibold">{totalMembers.toLocaleString()}</span> Members
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200">
          <button type="button" onClick={() => setTab("tiers")} className={tabCls("tiers")}>Tiers</button>
          <button type="button" onClick={() => setTab("members")} className={tabCls("members")}>Members</button>
          <button type="button" onClick={() => setTab("rewards")} className={tabCls("rewards")}>Rewards</button>
        </div>

        {/* Tab content */}
        {tab === "tiers"   && <TiersTab />}
        {tab === "members" && <MembersTab tiers={tiers} />}
        {tab === "rewards" && <RewardsTab />}
      </div>
    </EnterpriseShell>
  );
}
