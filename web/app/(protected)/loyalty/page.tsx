"use client";

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet } from "@/api-client/client";
import type { LoyaltyTier, LoyaltyTiersResponse } from "@/api-client/types";
import { TiersTab } from "./_components/TiersTab";
import { MembersTab } from "./_components/MembersTab";
import { RewardsTab } from "./_components/RewardsTab";

type Tab = "tiers" | "members" | "rewards";

export default function LoyaltyPage() {
  const [tab, setTab] = useState<Tab>("tiers");
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);

  // Pre-load tiers so the Members tab can use them for the filter dropdown
  useEffect(() => {
    apiGet<LoyaltyTiersResponse>("/api/v1/loyalty/tiers")
      .then(d => setTiers(d.items))
      .catch(() => {/* non-fatal */});
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

        {tab === "tiers"   && <TiersTab />}
        {tab === "members" && <MembersTab tiers={tiers} />}
        {tab === "rewards" && <RewardsTab />}
      </div>
    </EnterpriseShell>
  );
}
