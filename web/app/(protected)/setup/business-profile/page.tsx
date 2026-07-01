"use client";

/**
 * Business Profile — select your business type to unlock the right modules.
 *
 * Step 1: Choose from 14 business verticals (or Custom)
 * Step 2: Customise individual modules beyond the base bundle
 * Step 3: Save — feature flags update instantly, nav adapts
 *
 * POST /api/v1/settings/business-profile
 */

import { useEffect, useState, useMemo } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, safeLoad } from "@/api-client/client";
import { invalidateModuleFlagsCache } from "@/hooks/useModuleFlags";

interface ModuleDef {
  key: string;
  name: string;
  description: string;
  group: string;
  core?: boolean;
  enabled: boolean;
  flagKey: string;
  route?: string;
}

interface BundleDef {
  name: string;
  icon: string;
  description: string;
  modules: string[];
}

interface BusinessProfileResponse {
  businessType: string;
  locked?: boolean;
  bundles: Record<string, BundleDef>;
  modules: ModuleDef[];
  coreModules: string[];
}

const GROUP_ORDER = [
  "common", "retail", "restaurant", "b2b", "hospitality", "services",
  "healthcare", "manufacturing", "ecommerce", "automotive", "rental",
  "entertainment", "education", "golf", "enterprise",
];

const GROUP_LABELS: Record<string, string> = {
  common:        "Core (always included)",
  retail:        "Retail & Point of Sale",
  restaurant:    "Restaurant & Food Service",
  b2b:           "B2B / Wholesale",
  hospitality:   "Hospitality",
  services:      "Services & Repairs",
  healthcare:    "Healthcare & Pharmacy",
  manufacturing: "Manufacturing",
  ecommerce:     "E-Commerce & Omnichannel",
  automotive:    "Automotive",
  rental:        "Rental",
  entertainment: "Entertainment",
  education:     "Education",
  golf:          "Golf",
  enterprise:    "Enterprise Add-ons",
};

export default function BusinessProfilePage() {
  const [profile, setProfile]     = useState<BusinessProfileResponse | null>(null);
  const [selectedType, setSelectedType] = useState<string>("retail");
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set());
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [activeGroup, setActiveGroup] = useState<string>("all");

  useEffect(() => {
    safeLoad(
      apiGet<BusinessProfileResponse>("/api/v1/settings/business-profile")
        .then((data) => {
          setProfile(data);
          setSelectedType(data.businessType ?? "retail");
          setEnabledModules(new Set(data.modules.filter((m) => m.enabled).map((m) => m.key)));
        })
        .finally(() => setLoading(false)),
    );
  }, []);

  const handleTypeSelect = (type: string) => {
    setSelectedType(type);
    const bundle = profile?.bundles[type];
    if (bundle && type !== "custom") {
      const next = new Set([...(profile?.coreModules ?? []), ...bundle.modules]);
      setEnabledModules(next);
    }
    setSaved(false);
  };

  const handleModuleToggle = (key: string, isCore: boolean) => {
    if (isCore) return;
    setEnabledModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPost("/api/v1/settings/business-profile", {
        businessType: selectedType,
        enabledModules: Array.from(enabledModules),
      });
      invalidateModuleFlagsCache();
      setSaved(true);
      // Reload the page after a short delay so nav updates
      setTimeout(() => window.location.reload(), 1200);
    } finally {
      setSaving(false);
    }
  };

  // Group modules and filter by active group
  const modulesByGroup = useMemo(() => {
    const byGroup: Record<string, ModuleDef[]> = {};
    for (const m of profile?.modules ?? []) {
      if (!byGroup[m.group]) byGroup[m.group] = [];
      byGroup[m.group]!.push(m);
    }
    return byGroup;
  }, [profile]);

  const groupsWithModules = GROUP_ORDER.filter((g) => modulesByGroup[g]?.length);

  // Modules visible in current filter
  const visibleGroups = activeGroup === "all"
    ? groupsWithModules
    : groupsWithModules.filter((g) => g === activeGroup);

  const totalEnabled  = enabledModules.size;
  const totalOptional = (profile?.modules ?? []).filter((m) => !m.core).length;

  return (
    <EnterpriseShell
      active="settings"
      title="Business Profile"
      subtitle="Choose your vertical to unlock the right feature set"
    >
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">

        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-100" />
            ))}
          </div>
        ) : (
          <>
            {/* ── Step 1: Business Type ─────────────────────────────────── */}
            <div>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">1</div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Choose your business type</h2>
                  <p className="text-xs text-[var(--color-text-secondary)]">Activates a curated module bundle for your industry</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {Object.entries(profile?.bundles ?? {}).map(([key, bundle]) => {
                  const isSelected = selectedType === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleTypeSelect(key)}
                      className={`group rounded-xl border-2 p-3 text-left transition-all hover:shadow-sm ${
                        isSelected
                          ? "border-brand-600 bg-brand-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-brand-300"
                      }`}
                    >
                      <div className="mb-1.5 text-2xl">{bundle.icon}</div>
                      <p className={`text-sm font-semibold leading-tight ${isSelected ? "text-brand-700" : "text-[var(--color-text-primary)]"}`}>
                        {bundle.name}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--color-text-secondary)]">
                        {bundle.description}
                      </p>
                      {isSelected && (
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-brand-600">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                          Selected
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Bundle summary */}
              {selectedType && profile?.bundles[selectedType] && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-brand-50 px-4 py-2 text-sm">
                  <span className="font-medium text-brand-700">
                    {profile.bundles[selectedType]!.icon} {profile.bundles[selectedType]!.name} bundle
                  </span>
                  <span className="text-brand-500">includes {profile.bundles[selectedType]!.modules.length} modules</span>
                </div>
              )}
            </div>

            {/* ── Step 2: Customise modules ─────────────────────────────── */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">2</div>
                  <div>
                    <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Customise modules</h2>
                    <p className="text-xs text-[var(--color-text-secondary)]">{totalEnabled} of {totalOptional + (profile?.coreModules.length ?? 0)} modules enabled</p>
                  </div>
                </div>

                {/* Group filter pills */}
                <div className="hidden sm:flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveGroup("all")}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                      activeGroup === "all" ? "bg-brand-600 text-white" : "bg-gray-100 text-[var(--color-text-secondary)] hover:bg-gray-200"
                    }`}
                  >All</button>
                  {groupsWithModules.filter(g => g !== "common").map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setActiveGroup(g)}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium capitalize transition-colors ${
                        activeGroup === g ? "bg-brand-600 text-white" : "bg-gray-100 text-[var(--color-text-secondary)] hover:bg-gray-200"
                      }`}
                    >
                      {GROUP_LABELS[g]?.split(" ")[0]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-5">
                {visibleGroups.map((group) => {
                  const mods = modulesByGroup[group];
                  if (!mods?.length) return null;
                  return (
                    <Card key={group}>
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                        {GROUP_LABELS[group] ?? group}
                      </h3>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {mods.map((mod) => {
                          const isEnabled = enabledModules.has(mod.key);
                          const isCore    = !!mod.core;
                          return (
                            <div
                              key={mod.key}
                              className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-all ${
                                isCore
                                  ? "border-[var(--color-table-border)] bg-gray-50"
                                  : isEnabled
                                  ? "border-brand-200 bg-white shadow-sm"
                                  : "border-[var(--color-table-border)] bg-gray-50 opacity-60"
                              }`}
                            >
                              <div className="min-w-0 flex-1 pr-3">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-sm font-medium text-[var(--color-text-primary)]">{mod.name}</span>
                                  {isCore && (
                                    <Badge variant="gray" size="sm">Core</Badge>
                                  )}
                                </div>
                                <p className="mt-0.5 text-[11px] leading-tight text-[var(--color-text-secondary)]">
                                  {mod.description}
                                </p>
                              </div>

                              {/* Toggle */}
                              <button
                                type="button"
                                disabled={isCore}
                                onClick={() => handleModuleToggle(mod.key, isCore)}
                                role="switch"
                                aria-checked={isEnabled}
                                aria-label={`${isEnabled ? "Disable" : "Enable"} ${mod.name}`}
                                className={`relative flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
                                  isCore
                                    ? "cursor-not-allowed bg-gray-200"
                                    : isEnabled
                                    ? "bg-brand-600"
                                    : "bg-gray-200"
                                }`}
                              >
                                <span
                                  className={`absolute h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                    isEnabled ? "translate-x-5" : "translate-x-0.5"
                                  }`}
                                />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* ── Sticky save bar ───────────────────────────────────────── */}
            <div className="sticky bottom-4 z-20">
              <div className="flex items-center justify-between rounded-2xl border border-[var(--color-table-border)] bg-white/95 px-5 py-4 shadow-lg backdrop-blur-sm">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {totalEnabled} modules active
                    {selectedType && profile?.bundles[selectedType] && (
                      <span className="ml-2 text-[var(--color-text-secondary)] font-normal">
                        · {profile.bundles[selectedType]!.icon} {profile.bundles[selectedType]!.name}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    Changes take effect immediately — the navigation will update
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {saved && (
                    <span className="text-sm font-medium text-success-600">✓ Saved — reloading…</span>
                  )}
                  <Button
                    variant="primary"
                    size="md"
                    loading={saving}
                    disabled={saving || saved}
                    onClick={handleSave}
                  >
                    Save Profile
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </EnterpriseShell>
  );
}
