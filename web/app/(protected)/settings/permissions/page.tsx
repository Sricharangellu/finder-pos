"use client";

import { useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiPatch } from "@/api-client/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type RoleId = "admin" | "manager" | "cashier" | "warehouse" | "readonly";
type FeatureId = string;

// ── Feature definitions ───────────────────────────────────────────────────────

const FEATURE_GROUPS = [
  {
    label: "POS & Sales",
    features: [
      { id: "register",       label: "Register / Terminal",    description: "Access the checkout terminal" },
      { id: "sales",          label: "Sales History",          description: "View and export past transactions" },
      { id: "orders",         label: "Orders",                 description: "View and manage orders" },
      { id: "quotes",         label: "Quotes",                 description: "Create and convert quotations" },
      { id: "returns",        label: "Returns",                description: "Process refunds and returns" },
      { id: "payments",       label: "Payments",               description: "Accept and reconcile payments" },
      { id: "service-orders", label: "Service Orders",         description: "Manage repair and service tickets" },
    ],
  },
  {
    label: "Catalog",
    features: [
      { id: "catalog",     label: "Products",              description: "View and edit the product catalog" },
      { id: "discounts",   label: "Discounts & Promotions", description: "Manage coupons and discount rules" },
      { id: "gift-cards",  label: "Gift Cards",             description: "Issue and redeem gift cards" },
      { id: "loyalty",     label: "Loyalty Programme",      description: "Manage points and reward tiers" },
    ],
  },
  {
    label: "Inventory",
    features: [
      { id: "inventory",  label: "Inventory Overview", description: "View stock levels and low-stock alerts" },
      { id: "purchasing", label: "Purchasing",         description: "Create and manage purchase orders" },
      { id: "vendors",    label: "Vendors",            description: "Manage supplier and vendor records" },
      { id: "shipping",   label: "Shipping",           description: "Configure shipping methods and rates" },
      { id: "operations", label: "Operations",         description: "Stock counts, transfers, adjustments" },
    ],
  },
  {
    label: "Customers",
    features: [
      { id: "customers",     label: "Customers",     description: "View and manage customer profiles" },
      { id: "appointments",  label: "Appointments",  description: "Book and manage customer appointments" },
    ],
  },
  {
    label: "Finance & Reporting",
    features: [
      { id: "reports",        label: "Reports",           description: "Sales, inventory, and operational reports" },
      { id: "insights",       label: "Insights",          description: "Business analytics and AI insights" },
      { id: "tax-compliance", label: "Tax Compliance",    description: "Tax reports and filing assistance" },
      { id: "finance",        label: "Finance Overview",  description: "P&L, cash flow, and financial summary" },
      { id: "accounting",     label: "Accounting",        description: "Chart of accounts and journal entries" },
      { id: "invoicing",      label: "Invoicing",         description: "Customer invoices and billing" },
    ],
  },
  {
    label: "Administration",
    features: [
      { id: "team",              label: "Team & Users",   description: "Manage staff accounts and roles" },
      { id: "settings",          label: "Settings",       description: "Business profile and preferences" },
      { id: "workflows",         label: "Workflows",      description: "Checkout automation and triggers" },
      { id: "integrations",      label: "Integrations",   description: "Third-party service connections" },
      { id: "imports-exports",   label: "Import / Export", description: "Bulk data import and export" },
      { id: "audit-log",         label: "Audit Log",      description: "Track all system changes and access" },
    ],
  },
];

const ALL_FEATURES: FeatureId[] = FEATURE_GROUPS.flatMap((g) => g.features.map((f) => f.id));

const DEFAULTS: Record<RoleId, FeatureId[]> = {
  admin:     ALL_FEATURES,
  manager:   ["register", "sales", "orders", "quotes", "returns", "payments", "service-orders", "catalog", "discounts", "gift-cards", "loyalty", "inventory", "purchasing", "vendors", "shipping", "operations", "customers", "appointments", "reports", "insights", "tax-compliance", "finance", "accounting", "invoicing", "workflows"],
  cashier:   ["register", "sales", "orders", "returns", "payments", "customers", "gift-cards"],
  warehouse: ["inventory", "purchasing", "vendors", "shipping", "operations", "catalog"],
  readonly:  ["reports", "insights", "sales", "customers", "inventory"],
};

const ROLE_LABELS: Record<RoleId, { name: string; description: string }> = {
  admin:     { name: "Admin",     description: "Full access" },
  manager:   { name: "Manager",   description: "Most features, no admin" },
  cashier:   { name: "Cashier",   description: "POS and customers only" },
  warehouse: { name: "Warehouse", description: "Inventory and purchasing" },
  readonly:  { name: "Read-only", description: "View reports only" },
};

const ROLES: RoleId[] = ["admin", "manager", "cashier", "warehouse", "readonly"];

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => !disabled && onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5D5FEF] focus-visible:ring-offset-2 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${enabled ? "bg-[#5D5FEF]" : "bg-slate-200"}`}
    >
      <span
        className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PermissionsPage() {
  const [activeRole, setActiveRole] = useState<RoleId>("cashier");
  const [permissions, setPermissions] = useState<Record<RoleId, Set<FeatureId>>>(
    () =>
      Object.fromEntries(ROLES.map((r) => [r, new Set(DEFAULTS[r])])) as Record<
        RoleId,
        Set<FeatureId>
      >,
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const toggleFeature = (featureId: FeatureId, enabled: boolean) => {
    setPermissions((prev) => {
      const next = new Set(prev[activeRole]);
      if (enabled) next.add(featureId);
      else next.delete(featureId);
      return { ...prev, [activeRole]: next };
    });
    setSavedAt(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPatch<{ ok: boolean }>("/api/v1/settings/permissions", {
        roles: ROLES.map((r) => ({ role: r, features: [...permissions[r]] })),
      });
      setSavedAt(Date.now());
    } catch {
      /* show retry on next attempt */
    } finally {
      setSaving(false);
    }
  };

  const currentFeatures = permissions[activeRole];
  const isAdmin = activeRole === "admin";

  return (
    <EnterpriseShell
      active="permissions"
      title="Role Permissions"
      subtitle="Feature access by role"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-[#111]">Role Permissions</h1>
          <p className="mt-1 text-sm text-slate-500">
            Control which features each role can access. Changes take effect on the next login.
          </p>
        </div>

        {/* ── Role selector ─────────────────────────────────────────────── */}
        <div className="mb-6 flex gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {ROLES.map((role) => {
            const { name, description } = ROLE_LABELS[role];
            return (
              <button
                key={role}
                type="button"
                onClick={() => setActiveRole(role)}
                className={`flex flex-1 flex-col items-center rounded-lg px-2 py-2 text-center transition-colors ${
                  activeRole === role
                    ? "bg-[#5D5FEF] text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="text-sm font-semibold">{name}</span>
                <span className={`text-[11px] ${activeRole === role ? "text-white/70" : "text-slate-400"}`}>
                  {description}
                </span>
              </button>
            );
          })}
        </div>

        {isAdmin && (
          <div className="mb-4 rounded-lg border border-[#5D5FEF]/20 bg-[#5D5FEF]/5 px-4 py-3 text-sm text-[#5D5FEF]">
            Admins always have access to all features and cannot be restricted.
          </div>
        )}

        {/* ── Feature groups ────────────────────────────────────────────── */}
        <div className="space-y-3">
          {FEATURE_GROUPS.map((group) => (
            <div
              key={group.label}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {group.label}
                </h2>
              </div>
              <div className="divide-y divide-slate-50">
                {group.features.map((feature) => {
                  const enabled = isAdmin || currentFeatures.has(feature.id);
                  return (
                    <div
                      key={feature.id}
                      className="flex items-center justify-between px-4 py-3 hover:bg-[#FAFAFA]"
                    >
                      <div className="mr-4">
                        <p className="text-sm font-medium text-[#111]">{feature.label}</p>
                        <p className="text-xs text-slate-400">{feature.description}</p>
                      </div>
                      <Toggle
                        enabled={enabled}
                        onChange={(v) => toggleFeature(feature.id, v)}
                        disabled={isAdmin}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Save bar ──────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-400">
            {savedAt
              ? `Saved at ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(savedAt))}`
              : "Changes not yet saved"}
          </p>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || isAdmin}
            className="rounded-lg bg-[#5D5FEF] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>

      </div>
    </EnterpriseShell>
  );
}
