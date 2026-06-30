"use client";

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import type { CustomerLoyalty } from "./shared";

const TIER_BADGE_COLOR: Record<number, string> = {
  1: "bg-amber-100 text-amber-800",
  2: "bg-slate-100 text-slate-700",
  3: "bg-yellow-100 text-yellow-800",
  4: "bg-violet-100 text-violet-700",
};

export function LoyaltyCard({
  loyalty,
  loading,
}: {
  loyalty: CustomerLoyalty | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card title="Loyalty">
        <div className="space-y-2">
          <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
        </div>
      </Card>
    );
  }

  if (!loyalty || loyalty.currentTierName === null) {
    return (
      <Card title="Loyalty">
        <p className="text-sm text-slate-500">
          No tier configured — set up loyalty tiers in Settings
        </p>
      </Card>
    );
  }

  const tierBadgeClass =
    TIER_BADGE_COLOR[loyalty.currentTierLevel] ?? "bg-slate-100 text-slate-700";

  const progressPct =
    loyalty.pointsToNextTier !== null && loyalty.currentPoints !== undefined
      ? Math.min(
          100,
          Math.round(
            (loyalty.currentPoints /
              (loyalty.currentPoints + loyalty.pointsToNextTier)) *
              100,
          ),
        )
      : 100;

  return (
    <Card title="Loyalty">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
        <div className="flex flex-col gap-2">
          <span
            className={`inline-flex w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${tierBadgeClass}`}
          >
            {loyalty.currentTierName}
          </span>
          <p className="text-2xl font-bold tabular-nums text-slate-950">
            {loyalty.currentPoints.toLocaleString()}{" "}
            <span className="text-sm font-normal text-slate-500">pts</span>
          </p>
          <p className="text-sm text-slate-500">{loyalty.pointMultiplier}× earn</p>
          {loyalty.discountPct > 0 && (
            <Badge variant="green">{loyalty.discountPct}% discount on purchases</Badge>
          )}
        </div>

        <div className="flex-1">
          {loyalty.nextTierName !== null && loyalty.pointsToNextTier !== null ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-slate-600">
                <span className="font-semibold text-slate-950">
                  {loyalty.pointsToNextTier.toLocaleString()} pts
                </span>{" "}
                to {loyalty.nextTierName}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-blue-600 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm font-semibold text-violet-700">Top tier 🎉</p>
          )}
        </div>
      </div>
    </Card>
  );
}
