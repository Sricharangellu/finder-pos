"use client";

/**
 * Settings → Business Profile (Plan & Modules).
 *
 * Rendered entirely from GET /api/v1/capabilities — the business-pack control
 * plane. Shows the current business type, plan summary, and every module with
 * its enablement state, source (core / business pack / manual override), and
 * disabled reason. Switching business type previews the impact via
 * GET /api/v1/capabilities/impact before applying, and module toggles write
 * through POST /api/v1/settings/business-profile.
 *
 * This page must never hardcode business-type assumptions — the registry,
 * bundles, and module states all come from the capabilities contract.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost } from "@/api-client/client";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import type {
  CapabilitiesImpactResponse,
  CapabilityModule,
} from "@/api-client/types";

// ── Recent business-profile changes (audit trail) ─────────────────────────────

interface BusinessProfileAuditEvent {
  id: string;
  actor: { id: string; email: string | null; role: string | null };
  action: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  created_at: number;
}

function describeChange(event: BusinessProfileAuditEvent): string {
  if (event.action === "business_profile.type_changed") {
    const c = event.changes?.["businessType"];
    return c ? `Business type: ${String(c.from ?? "—")} → ${String(c.to)}` : "Business type changed";
  }
  const parts = Object.entries(event.changes ?? {}).map(
    ([key, c]) => `${key} ${c.to === true || c.to === "true" ? "enabled" : "disabled"}`,
  );
  return parts.length > 0 ? `Modules: ${parts.join(", ")}` : "Modules changed";
}

function RecentProfileChanges({ refreshToken }: { refreshToken: number }) {
  const [events, setEvents] = useState<BusinessProfileAuditEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ items: BusinessProfileAuditEvent[] }>(
      "/api/v1/audit-log?resource_type=business_profile&limit=8",
    )
      .then((r) => { if (!cancelled) setEvents(r.items); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [refreshToken]);

  if (events === null || events.length === 0) return null;

  return (
    <section aria-label="Recent business profile changes" className="mt-6">
      <h2 className="mb-1 text-sm font-semibold text-[#111]">Recent changes</h2>
      <p className="mb-3 text-xs text-slate-500">
        Business-type and module changes, with who made them and when.
      </p>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
        {events.map((event) => (
          <li key={event.id} className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-[#111]">{describeChange(event)}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                by {event.actor.email ?? event.actor.id}
              </p>
            </div>
            <time
              dateTime={new Date(event.created_at).toISOString()}
              className="shrink-0 text-xs text-slate-400"
            >
              {new Date(event.created_at).toLocaleString()}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({
  enabled,
  onChange,
  disabled,
  loading,
  label,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
}) {
  if (loading) {
    return <div className="h-6 w-11 animate-pulse rounded-full bg-slate-200" aria-hidden="true" />;
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      } ${enabled ? "bg-brand-600" : "bg-slate-200"}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "translate-x-[22px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

// ── Source badge ──────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, { text: string; cls: string }> = {
  core:                { text: "Core — always active", cls: "text-emerald-600" },
  business_pack:       { text: "From business pack",   cls: "text-brand-600" },
  manual_override:     { text: "Manual override",      cls: "text-amber-600" },
  not_in_business_pack:{ text: "Not in current pack",  cls: "text-slate-400" },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BusinessProfilePage() {
  const { capabilities, loading, refresh } = useCapabilities();
  const [toggling, setToggling] = useState<string | null>(null);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [impact, setImpact] = useState<CapabilitiesImpactResponse | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditRefresh, setAuditRefresh] = useState(0);

  const groups = useMemo(() => {
    if (!capabilities) return [] as Array<{ key: string; label: string; modules: CapabilityModule[] }>;
    const byGroup = new Map<string, CapabilityModule[]>();
    for (const mod of capabilities.modules) {
      const list = byGroup.get(mod.group) ?? [];
      list.push(mod);
      byGroup.set(mod.group, list);
    }
    return Array.from(byGroup, ([key, modules]) => ({
      key,
      label: capabilities.moduleGroups[key] ?? key,
      modules,
    }));
  }, [capabilities]);

  const previewSwitch = async (targetType: string) => {
    if (!capabilities || targetType === capabilities.business.type) return;
    setSwitchTarget(targetType);
    setImpact(null);
    setImpactLoading(true);
    setError(null);
    try {
      const data = await apiGet<CapabilitiesImpactResponse>(
        `/api/v1/capabilities/impact?businessType=${encodeURIComponent(targetType)}`,
      );
      setImpact(data);
    } catch {
      setError("Could not load the impact preview. Please try again.");
      setSwitchTarget(null);
    } finally {
      setImpactLoading(false);
    }
  };

  const applySwitch = async () => {
    if (!switchTarget) return;
    setApplying(true);
    setError(null);
    try {
      await apiPost("/api/v1/settings/business-profile", { businessType: switchTarget });
      setSwitchTarget(null);
      setImpact(null);
      setAuditRefresh((n) => n + 1);
      await refresh();
    } catch {
      setError("Could not switch business type. Please try again.");
    } finally {
      setApplying(false);
    }
  };

  const toggleModule = async (mod: CapabilityModule, on: boolean) => {
    if (mod.core) return;
    setToggling(mod.key);
    setError(null);
    try {
      await apiPost("/api/v1/settings/business-profile", { moduleFlags: { [mod.key]: on } });
      setAuditRefresh((n) => n + 1);
      await refresh();
    } catch {
      setError(`Could not ${on ? "enable" : "disable"} ${mod.name}. Please try again.`);
    } finally {
      setToggling(null);
    }
  };

  const business = capabilities?.business;
  const plan = capabilities?.plan as { name?: string; key?: string } | null | undefined;

  return (
    <EnterpriseShell
      active="modes"
      title="Business Profile"
      subtitle="Business type, plan, and enabled modules"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        {/* ── Current profile summary ─────────────────────────────────── */}
        <section aria-label="Current business profile" className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {loading && !capabilities ? (
            <div className="h-16 animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />
          ) : capabilities && business ? (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Business type</p>
                <p className="mt-1 text-lg font-semibold text-[#111]">
                  <span className="mr-2" role="img" aria-hidden="true">{business.icon}</span>
                  {business.label}
                </p>
                <p className="mt-1 text-xs text-slate-500">{business.description}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Plan</p>
                <p className="mt-1 text-sm font-medium text-[#111]">{plan?.name ?? "—"}</p>
                <p className="mt-1 max-w-xs text-xs text-slate-400">{capabilities.entitlements.note}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Enabled modules</p>
                <p className="mt-1 text-sm font-medium text-[#111]">
                  {capabilities.modules.filter((m) => m.enabled).length} of {capabilities.modules.length}
                </p>
                <Link href="/settings/permissions" className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">
                  Role permissions →
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Capabilities are unavailable — module gating is inactive and all navigation is shown.</p>
          )}
        </section>

        {/* ── Business type switcher ──────────────────────────────────── */}
        {capabilities && (
          <section aria-label="Business type" className="mb-6">
            <h2 className="mb-1 text-sm font-semibold text-[#111]">Business type</h2>
            <p className="mb-3 text-xs text-slate-500">
              Switching applies that pack&apos;s module defaults. Changes are previewed before anything is applied.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {capabilities.availableBusinessTypes.map((bt) => {
                const current = bt.key === capabilities.business.type;
                return (
                  <button
                    key={bt.key}
                    type="button"
                    onClick={() => void previewSwitch(bt.key)}
                    aria-pressed={current}
                    className={`rounded-lg border p-3 text-left text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
                      current
                        ? "border-brand-600 bg-brand-600/5"
                        : switchTarget === bt.key
                          ? "border-amber-400 bg-amber-50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span className="font-medium text-[#111]">{bt.name}</span>
                    {current && (
                      <span className="ml-2 rounded-full bg-brand-600/10 px-2 py-0.5 text-[10px] font-semibold text-brand-600">
                        Current
                      </span>
                    )}
                    <p className="mt-1 text-[11px] text-slate-400">{bt.modules.length} bundled modules</p>
                  </button>
                );
              })}
            </div>

            {/* Impact preview */}
            {switchTarget && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4" aria-live="polite">
                {impactLoading ? (
                  <p className="text-sm text-amber-700">Loading impact preview…</p>
                ) : impact ? (
                  <>
                    <p className="text-sm font-semibold text-amber-800">
                      Switch {impact.from.label} → {impact.to.label}
                    </p>
                    <div className="mt-2 grid gap-2 text-xs text-amber-800 sm:grid-cols-2">
                      <div>
                        <p className="font-medium">Modules added ({impact.modules.added.length})</p>
                        <p className="mt-0.5">
                          {impact.modules.added.map((m) => m.name).join(", ") || "None"}
                        </p>
                      </div>
                      <div>
                        <p className="font-medium">Modules removed ({impact.modules.removed.length})</p>
                        <p className="mt-0.5">
                          {impact.modules.removed.map((m) => m.name).join(", ") || "None"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void applySwitch()}
                        disabled={applying}
                        className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-[#4849d0] disabled:opacity-60"
                      >
                        {applying ? "Applying…" : `Switch to ${impact.to.label}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSwitchTarget(null); setImpact(null); }}
                        className="rounded-lg border border-amber-300 px-4 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </section>
        )}

        {/* ── Modules by group ────────────────────────────────────────── */}
        {capabilities && (
          <section aria-label="Modules">
            <h2 className="mb-1 text-sm font-semibold text-[#111]">Modules</h2>
            <p className="mb-3 text-xs text-slate-500">
              Core modules are always active. Others follow the business pack and can be overridden per tenant.
            </p>
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.key} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                    {group.label}
                  </p>
                  <ul className="divide-y divide-slate-100">
                    {group.modules.map((mod) => {
                      const badge = SOURCE_LABEL[mod.source] ?? SOURCE_LABEL["not_in_business_pack"]!;
                      return (
                        <li key={mod.key} className="flex items-center justify-between gap-4 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#111]">{mod.name}</p>
                            <p className="truncate text-xs text-slate-500">{mod.description}</p>
                            <p className={`mt-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.text}</p>
                          </div>
                          <Toggle
                            enabled={mod.enabled}
                            onChange={(v) => void toggleModule(mod, v)}
                            disabled={Boolean(mod.core)}
                            loading={toggling === mod.key}
                            label={`${mod.enabled ? "Disable" : "Enable"} ${mod.name}`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Recent changes (audit trail) ────────────────────────────── */}
        {capabilities && <RecentProfileChanges refreshToken={auditRefresh} />}

      </div>
    </EnterpriseShell>
  );
}
