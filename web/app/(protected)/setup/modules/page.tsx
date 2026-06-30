"use client";

/**
 * UX-2: Module Marketplace — browse all 60 modules grouped by vertical.
 * Toggle individual modules on/off beyond the base bundle.
 * Saves via POST /api/v1/settings/business-profile.
 */

import { useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, safeLoad } from "@/api-client/client";
import { invalidateModuleFlagsCache } from "@/hooks/useModuleFlags";

// ── Types (mirrors backend ModuleDefinition) ──────────────────────────────────

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

interface BusinessProfileResponse {
  businessType: string;
  modules: ModuleDef[];
  coreModules: string[];
}

// ── Group metadata ────────────────────────────────────────────────────────────

const GROUP_ORDER = [
  "retail", "restaurant", "b2b", "hospitality", "services",
  "healthcare", "manufacturing", "ecommerce", "automotive",
  "rental", "entertainment", "education", "golf", "enterprise",
];

const GROUP_META: Record<string, { label: string; icon: string; description: string }> = {
  retail:        { icon: "🏪", label: "Retail & POS",              description: "Point of sale, discounts, loyalty, gift cards" },
  restaurant:    { icon: "🍽️", label: "Restaurant & Food Service", description: "Tables, KDS, bar tabs, reservations, menu modifiers" },
  b2b:           { icon: "📦", label: "B2B / Wholesale",           description: "Sales orders, purchasing, billing, accounting, quotes" },
  hospitality:   { icon: "🏨", label: "Hospitality",               description: "Room billing, guest accounts, spa, events" },
  services:      { icon: "✂️", label: "Services & Repairs",        description: "Appointments, service orders, memberships, commission" },
  healthcare:    { icon: "🏥", label: "Healthcare & Pharmacy",     description: "Prescriptions, patient records, insurance, expiry" },
  manufacturing: { icon: "🏭", label: "Manufacturing",             description: "Production orders, BOM, raw materials, quality control" },
  ecommerce:     { icon: "🛒", label: "E-Commerce & Omnichannel",  description: "Online store, fulfilment, marketplace sync, shipping" },
  automotive:    { icon: "🚗", label: "Automotive",                description: "Vehicle history, parts, work orders, inspection" },
  rental:        { icon: "🔑", label: "Rental",                    description: "Rental contracts, deposits, asset tracking, damage" },
  entertainment: { icon: "🎭", label: "Entertainment",             description: "Tickets, access control, concessions, season passes" },
  education:     { icon: "🎓", label: "Education",                 description: "Fee collection, student accounts, enrollment, attendance" },
  golf:          { icon: "⛳", label: "Golf",                       description: "Tee sheet, bookings, memberships, pro shop" },
  enterprise:    { icon: "🏢", label: "Enterprise Add-ons",        description: "Workforce, WMS, webhooks, SSO, multi-currency, analytics" },
};

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      } ${on ? "bg-brand-600" : "bg-gray-200"}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ModulesMarketplacePage() {
  const [profile, setProfile]       = useState<BusinessProfileResponse | null>(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [dirty, setDirty]           = useState(false);
  const [saved, setSaved]           = useState(false);
  const [enabled, setEnabled]       = useState<Record<string, boolean>>({});
  const [search, setSearch]         = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    safeLoad(
      apiGet<BusinessProfileResponse>("/api/v1/settings/business-profile")
        .then(data => {
          setProfile(data);
          const map: Record<string, boolean> = {};
          (data.modules ?? []).forEach(m => { map[m.key] = m.enabled; });
          setEnabled(map);
        })
        .finally(() => setLoading(false)),
    );
  };

  useEffect(() => { load(); }, []);

  // Group non-core modules by vertical
  const grouped = useMemo(() => {
    if (!profile) return {};
    const result: Record<string, ModuleDef[]> = {};
    for (const m of profile.modules) {
      if (m.core) continue;
      if (!(m.group in result)) result[m.group] = [];
      result[m.group].push(m);
    }
    return result;
  }, [profile]);

  const coreModules = useMemo(
    () => profile?.modules.filter(m => m.core) ?? [],
    [profile],
  );

  // Filtered modules for search
  const filteredGrouped = useMemo(() => {
    if (!search) return grouped;
    const q = search.toLowerCase();
    const result: Record<string, ModuleDef[]> = {};
    for (const [group, mods] of Object.entries(grouped)) {
      const filtered = mods.filter(m =>
        m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q),
      );
      if (filtered.length > 0) result[group] = filtered;
    }
    return result;
  }, [grouped, search]);

  const visibleGroups = GROUP_ORDER.filter(g =>
    !activeGroup ? g in filteredGrouped : g === activeGroup && g in filteredGrouped,
  );

  const toggleModule = (key: string, value: boolean) => {
    setEnabled(prev => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  const enabledCount = Object.values(enabled).filter(Boolean).length;

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      // Build module flags array for the API
      const moduleFlags: Record<string, boolean> = {};
      for (const [key, on] of Object.entries(enabled)) {
        moduleFlags[`module:${key}`] = on;
      }
      await apiPost("/api/v1/settings/business-profile", {
        businessType: profile.businessType,
        moduleFlags,
      });
      invalidateModuleFlagsCache();
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  const activeGroupMeta = activeGroup ? GROUP_META[activeGroup] : null;

  return (
    <EnterpriseShell active="module-marketplace" title="Module Marketplace" subtitle="Enable the features your business needs">

      {/* Sticky save bar */}
      {dirty && (
        <div className="sticky top-0 z-30 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <p className="text-sm font-medium text-amber-800">You have unsaved module changes</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={load}>Discard</Button>
              <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>Save Changes</Button>
            </div>
          </div>
        </div>
      )}

      {saved && !dirty && (
        <div className="sticky top-0 z-30 border-b border-green-200 bg-green-50 px-4 py-2.5">
          <p className="mx-auto max-w-6xl text-sm font-medium text-green-800">
            ✓ Modules saved — navigation will update automatically
          </p>
        </div>
      )}

      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">

        {/* Header row */}
        <div className="mb-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {enabledCount} module{enabledCount !== 1 ? "s" : ""} active
              {profile?.businessType && (
                <span className="ml-2 capitalize">· Base plan: <strong>{profile.businessType}</strong></span>
              )}
            </p>
          </div>
          <div className="relative">
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search modules…"
              className="w-56 rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm outline-none focus:border-brand-600"
            />
            <span className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--color-text-secondary)] text-sm">⌕</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">

          {/* Left sidebar — group nav */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-[var(--color-table-border)] bg-white overflow-hidden sticky top-20">
              <div className="p-3 border-b border-[var(--color-table-border)]">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Verticals</p>
              </div>
              <nav className="divide-y divide-[var(--color-table-border)]">
                <button type="button" onClick={() => setActiveGroup(null)}
                  className={`w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 ${
                    !activeGroup ? "bg-brand-50 text-brand-700 font-semibold" : "text-[var(--color-text-primary)]"
                  }`}>
                  All verticals
                </button>
                {GROUP_ORDER.filter(g => g in grouped).map(g => {
                  const meta  = GROUP_META[g];
                  const count = (grouped[g] ?? []).filter(m => enabled[m.key]).length;
                  const total = (grouped[g] ?? []).length;
                  return (
                    <button key={g} type="button" onClick={() => setActiveGroup(activeGroup === g ? null : g)}
                      className={`w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 ${
                        activeGroup === g ? "bg-brand-50 text-brand-700 font-semibold" : "text-[var(--color-text-primary)]"
                      }`}>
                      <span className="flex items-center justify-between">
                        <span>{meta?.icon} {meta?.label ?? g}</span>
                        <span className="text-xs text-[var(--color-text-secondary)]">{count}/{total}</span>
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Right — module grid */}
          <div className="lg:col-span-3 space-y-6">

            {loading ? (
              <div className="space-y-4">
                {[1,2,3].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />)}
              </div>
            ) : (

              <>
                {/* Core modules (read-only) */}
                {!activeGroup && !search && (
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Core — always included</h2>
                      <Badge variant="green" size="sm">Always on</Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {coreModules.map(m => (
                        <div key={m.key}
                          className="flex items-center justify-between rounded-xl border border-[var(--color-table-border)] bg-white px-4 py-3">
                          <div className="min-w-0 mr-3">
                            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{m.name}</p>
                            <p className="text-xs text-[var(--color-text-secondary)] line-clamp-1">{m.description}</p>
                          </div>
                          <Toggle on disabled onChange={() => {}} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Optional modules by group */}
                {visibleGroups.length === 0 && search && (
                  <Card>
                    <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">
                      No modules match "<strong>{search}</strong>"
                    </p>
                  </Card>
                )}

                {visibleGroups.map(group => {
                  const meta  = GROUP_META[group];
                  const mods  = filteredGrouped[group] ?? [];
                  const onCount = mods.filter(m => enabled[m.key]).length;
                  return (
                    <div key={group}>
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{meta?.icon}</span>
                          <div>
                            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{meta?.label ?? group}</h2>
                            {meta?.description && (
                              <p className="text-xs text-[var(--color-text-secondary)]">{meta.description}</p>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-[var(--color-text-secondary)]">
                          {onCount}/{mods.length} enabled
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {mods.map(m => {
                          const on = enabled[m.key] ?? false;
                          return (
                            <div key={m.key}
                              className={`flex items-start justify-between rounded-xl border px-4 py-3 transition-colors ${
                                on
                                  ? "border-brand-200 bg-brand-50"
                                  : "border-[var(--color-table-border)] bg-white hover:border-gray-300"
                              }`}>
                              <div className="min-w-0 mr-3">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{m.name}</p>
                                  {m.route && on && (
                                    <a href={m.route}
                                      className="text-[10px] text-brand-600 hover:underline">↗</a>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] line-clamp-2">{m.description}</p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                                <Toggle on={on} onChange={v => toggleModule(m.key, v)} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </EnterpriseShell>
  );
}
