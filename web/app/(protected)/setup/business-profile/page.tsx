"use client";

/**
 * Business Profile page — lets a business owner select their business type
 * and unlock the matching module bundle. Individual modules can be toggled
 * beyond the base bundle (contact support required on Starter plan).
 *
 * Route: /setup/business-profile
 * Powered by: GET/POST /api/v1/settings/business-profile
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, safeLoad } from "@/api-client/client";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  description: string;
  modules: string[];
}

interface BusinessProfileResponse {
  businessType: string;
  bundles: Record<string, BundleDef>;
  modules: ModuleDef[];
  coreModules: string[];
}

// ─── Business type icons ──────────────────────────────────────────────────────

const BUSINESS_ICONS: Record<string, string> = {
  retail: "🏪",
  restaurant: "🍽️",
  wholesale: "📦",
  golf: "⛳",
  hybrid: "🔀",
  custom: "⚙️",
};

const GROUP_LABELS: Record<string, string> = {
  common: "Core (always included)",
  retail: "Retail",
  restaurant: "Restaurant & F&B",
  b2b: "B2B / Wholesale",
  golf: "Golf",
  enterprise: "Enterprise Add-ons",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BusinessProfilePage() {
  const [profile, setProfile] = useState<BusinessProfileResponse | null>(null);
  const [selectedType, setSelectedType] = useState<string>("");
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    safeLoad(
      apiGet<BusinessProfileResponse>("/api/v1/settings/business-profile")
        .then((data) => {
          setProfile(data);
          setSelectedType(data.businessType);
          setEnabledModules(new Set(data.modules.filter((m) => m.enabled).map((m) => m.key)));
        })
        .finally(() => setLoading(false)),
    );
  }, []);

  const handleTypeSelect = (type: string) => {
    setSelectedType(type);
    const bundle = profile?.bundles[type];
    if (bundle) {
      const next = new Set([...(profile?.coreModules ?? []), ...bundle.modules]);
      setEnabledModules(next);
    }
    setSaved(false);
  };

  const handleModuleToggle = (key: string, isCore: boolean) => {
    if (isCore) return; // cannot toggle core modules
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
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  // Group modules by their group
  const modulesByGroup = (profile?.modules ?? []).reduce<Record<string, ModuleDef[]>>((acc, m) => {
    const grp = m.group;
    if (!acc[grp]) acc[grp] = [];
    acc[grp]!.push(m);
    return acc;
  }, {});

  return (
    <EnterpriseShell active="settings" title="Business Profile" subtitle="Choose your business type to unlock the right features">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">

        {loading ? (
          <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}</div>
        ) : (
          <>
            {/* Step 1 — Choose business type */}
            <Card>
              <h2 className="mb-1 text-base font-semibold text-[var(--color-text-primary)]">
                1. Choose your business type
              </h2>
              <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
                This unlocks a curated set of modules for your industry. You can customise below.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Object.entries(profile?.bundles ?? {}).map(([key, bundle]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleTypeSelect(key)}
                    className={`rounded-xl border-2 p-4 text-left transition-all ${
                      selectedType === key
                        ? "border-brand-600 bg-brand-50"
                        : "border-[#D9D9D9] hover:border-brand-400 hover:bg-gray-50"
                    }`}
                  >
                    <div className="mb-1 text-2xl">{BUSINESS_ICONS[key] ?? "📋"}</div>
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">{bundle.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] line-clamp-2">{bundle.description}</p>
                    {selectedType === key && (
                      <span className="mt-2 inline-block text-xs font-semibold text-brand-600">Selected ✓</span>
                    )}
                  </button>
                ))}
              </div>
            </Card>

            {/* Step 2 — Customise modules */}
            <Card>
              <h2 className="mb-1 text-base font-semibold text-[var(--color-text-primary)]">
                2. Customise modules
              </h2>
              <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
                Core modules are always included. Toggle optional modules to match your exact needs.
                Additional modules may require a plan upgrade.
              </p>

              {Object.entries(GROUP_LABELS).map(([group, groupLabel]) => {
                const mods = modulesByGroup[group];
                if (!mods?.length) return null;
                return (
                  <div key={group} className="mb-6">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                      {groupLabel}
                    </h3>
                    <div className="space-y-1.5">
                      {mods.map((mod) => {
                        const isEnabled = enabledModules.has(mod.key);
                        const isCore = !!mod.core;
                        return (
                          <div
                            key={mod.key}
                            className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                              isEnabled ? "border-[var(--color-table-border)] bg-white" : "border-[var(--color-table-border)] bg-gray-50 opacity-60"
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-[var(--color-text-primary)]">{mod.name}</span>
                                {isCore && <Badge variant="gray" size="sm">Core</Badge>}
                                {isEnabled && !isCore && <Badge variant="green" size="sm">Active</Badge>}
                              </div>
                              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{mod.description}</p>
                            </div>
                            <button
                              type="button"
                              disabled={isCore}
                              onClick={() => handleModuleToggle(mod.key, isCore)}
                              aria-label={isEnabled ? `Disable ${mod.name}` : `Enable ${mod.name}`}
                              className={`ml-4 flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                                isCore ? "cursor-not-allowed bg-gray-200" :
                                isEnabled ? "bg-brand-600" : "bg-gray-200"
                              }`}
                            >
                              <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                isEnabled ? "translate-x-5" : "translate-x-0.5"
                              }`} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </Card>

            {/* Save */}
            <div className="flex items-center justify-between rounded-xl border border-[var(--color-table-border)] bg-white px-5 py-4">
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">
                  {enabledModules.size} modules enabled
                </p>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Changes take effect immediately. Disabling a module hides it from the nav.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {saved && (
                  <span className="text-sm font-medium text-success-600">Saved ✓</span>
                )}
                <Button variant="primary" size="md" loading={saving} onClick={handleSave}>
                  Save Profile
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </EnterpriseShell>
  );
}
