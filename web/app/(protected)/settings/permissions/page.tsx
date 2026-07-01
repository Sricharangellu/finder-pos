"use client";

import { useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiPatch } from "@/api-client/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type RoleId =
  | "owner"
  | "admin"
  | "manager"
  | "sales"
  | "cashier"
  | "accountant"
  | "receiver"
  | "shipper"
  | "driver"
  | "warehouse";

type FeatureId = string;

// ── Feature definitions ───────────────────────────────────────────────────────

const FEATURE_GROUPS = [
  {
    label: "POS & Sales",
    features: [
      { id: "register",        label: "Register / Terminal",   description: "Open and operate the checkout terminal" },
      { id: "sales",           label: "Sales History",         description: "View and export past transactions" },
      { id: "orders",          label: "Orders",                description: "View and manage all orders" },
      { id: "quotes",          label: "Quotes",                description: "Create, send, and convert quotations" },
      { id: "returns",         label: "Returns & Refunds",     description: "Process returns and issue refunds" },
      { id: "payments",        label: "Payments",              description: "Accept payments and reconcile cash" },
      { id: "price-override",  label: "Price Override",        description: "Manually override product price at POS" },
      { id: "void-transaction",label: "Void Transaction",      description: "Void or cancel completed transactions" },
      { id: "service-orders",  label: "Service Orders",        description: "Create and manage repair/service tickets" },
    ],
  },
  {
    label: "Catalog",
    features: [
      { id: "catalog",    label: "Products",               description: "View and edit the product catalog" },
      { id: "discounts",  label: "Discounts & Promotions", description: "Create and manage discount rules" },
      { id: "gift-cards", label: "Gift Cards",             description: "Issue and redeem gift card balances" },
      { id: "loyalty",    label: "Loyalty Programme",      description: "Manage loyalty tiers, points, and rewards" },
    ],
  },
  {
    label: "Inventory",
    features: [
      { id: "inventory",  label: "Inventory Overview",    description: "View stock levels, alerts, and valuation" },
      { id: "purchasing", label: "Purchasing / POs",      description: "Create and receive purchase orders" },
      { id: "vendors",    label: "Vendors & Suppliers",   description: "Manage vendor accounts and terms" },
      { id: "operations", label: "Stock Operations",      description: "Counts, transfers, and adjustments" },
      { id: "delivery",   label: "Delivery & Routes",     description: "View delivery manifests and route assignments" },
      { id: "shipping",   label: "Shipping & Fulfilment", description: "Ship orders, print labels, manage carriers" },
    ],
  },
  {
    label: "Customers & CRM",
    features: [
      { id: "customers",    label: "Customers",    description: "View and manage customer profiles and history" },
      { id: "appointments", label: "Appointments", description: "Book and manage customer appointments" },
    ],
  },
  {
    label: "Finance & Reporting",
    features: [
      { id: "reports",        label: "Reports",         description: "Sales, inventory, and operational reports" },
      { id: "insights",       label: "Insights",        description: "AI-powered analytics and trends" },
      { id: "tax-compliance", label: "Tax Compliance",  description: "Tax reporting and regulatory compliance" },
      { id: "finance",        label: "Finance Overview", description: "P&L, cash flow, and financial summary" },
      { id: "accounting",     label: "Accounting",      description: "Chart of accounts, journals, and reconciliation" },
      { id: "invoicing",      label: "Invoicing",       description: "Customer invoices and payment tracking" },
    ],
  },
  {
    label: "Administration",
    features: [
      { id: "team",            label: "Team & Users",    description: "Manage staff accounts, roles, and schedules" },
      { id: "settings",        label: "Settings",        description: "Business profile, taxes, and system preferences" },
      { id: "workflows",       label: "Workflows",       description: "Checkout automation and trigger rules" },
      { id: "integrations",    label: "Integrations",    description: "Third-party app connections and API keys" },
      { id: "imports-exports", label: "Import / Export", description: "Bulk data import, export, and migration" },
      { id: "audit-log",       label: "Audit Log",       description: "Full system event log with actor tracking" },
    ],
  },
];

const ALL_FEATURES: FeatureId[] = FEATURE_GROUPS.flatMap((g) => g.features.map((f) => f.id));

// ── Role metadata + default permissions ───────────────────────────────────────

interface RoleDef {
  name: string;
  description: string;
  color: string;
  immutable?: boolean;
  defaults: FeatureId[];
}

const ROLE_DEFS: Record<RoleId, RoleDef> = {
  owner: {
    name: "Owner",
    description: "Business owner — full unrestricted access",
    color: "bg-violet-600",
    immutable: true,
    defaults: ALL_FEATURES,
  },
  admin: {
    name: "Admin",
    description: "System administrator — full access",
    color: "bg-[#5D5FEF]",
    immutable: true,
    defaults: ALL_FEATURES,
  },
  manager: {
    name: "Manager",
    description: "Operations and team management",
    color: "bg-blue-500",
    defaults: [
      "register", "sales", "orders", "quotes", "returns", "payments",
      "price-override", "void-transaction", "service-orders",
      "catalog", "discounts", "gift-cards", "loyalty",
      "inventory", "purchasing", "vendors", "operations", "shipping",
      "customers", "appointments",
      "reports", "insights", "tax-compliance", "finance", "accounting", "invoicing",
      "team", "workflows",
    ],
  },
  sales: {
    name: "Sales",
    description: "Customer sales and quote management",
    color: "bg-emerald-500",
    defaults: [
      "register", "sales", "orders", "quotes", "returns", "payments",
      "price-override",
      "catalog", "discounts", "gift-cards", "loyalty",
      "customers", "appointments",
      "reports",
    ],
  },
  cashier: {
    name: "Cashier",
    description: "POS checkout and payment processing",
    color: "bg-cyan-500",
    defaults: [
      "register", "sales", "orders", "returns", "payments",
      "gift-cards",
      "customers",
    ],
  },
  accountant: {
    name: "Accountant",
    description: "Finance, billing, and compliance",
    color: "bg-amber-500",
    defaults: [
      "payments", "invoicing",
      "purchasing", "vendors",
      "reports", "insights", "tax-compliance", "finance", "accounting",
    ],
  },
  receiver: {
    name: "Receiver",
    description: "Inbound goods and purchase order receiving",
    color: "bg-orange-500",
    defaults: [
      "inventory", "purchasing", "vendors", "operations",
      "catalog",
    ],
  },
  shipper: {
    name: "Shipper",
    description: "Outbound order fulfilment and shipping",
    color: "bg-sky-500",
    defaults: [
      "orders", "returns",
      "inventory", "shipping",
    ],
  },
  driver: {
    name: "Driver",
    description: "Delivery route and manifest access",
    color: "bg-teal-500",
    defaults: [
      "orders",
      "delivery",
    ],
  },
  warehouse: {
    name: "Warehouse",
    description: "General warehouse and stock management",
    color: "bg-slate-500",
    defaults: [
      "inventory", "purchasing", "vendors", "operations", "shipping",
      "catalog",
    ],
  },
};

const ROLES: RoleId[] = [
  "owner", "admin", "manager", "sales", "cashier",
  "accountant", "receiver", "shipper", "driver", "warehouse",
];

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
      className={[
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5D5FEF] focus-visible:ring-offset-2",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        enabled ? "bg-[#5D5FEF]" : "bg-slate-200",
      ].join(" ")}
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
  const [activeRole, setActiveRole] = useState<RoleId>("manager");
  const [permissions, setPermissions] = useState<Record<RoleId, Set<FeatureId>>>(
    () =>
      Object.fromEntries(
        ROLES.map((r) => [r, new Set(ROLE_DEFS[r].defaults)]),
      ) as Record<RoleId, Set<FeatureId>>,
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [unsaved, setUnsaved] = useState(false);

  const toggleFeature = (featureId: FeatureId, on: boolean) => {
    setPermissions((prev) => {
      const next = new Set(prev[activeRole]);
      if (on) next.add(featureId);
      else next.delete(featureId);
      return { ...prev, [activeRole]: next };
    });
    setUnsaved(true);
    setSavedAt(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPatch<{ ok: boolean }>("/api/v1/settings/permissions", {
        roles: ROLES.map((r) => ({ role: r, features: [...permissions[r]] })),
      });
      setSavedAt(Date.now());
      setUnsaved(false);
    } catch {
      /* user can retry */
    } finally {
      setSaving(false);
    }
  };

  const currentFeatures = permissions[activeRole];
  const roleDef = ROLE_DEFS[activeRole];
  const isImmutable = !!roleDef.immutable;

  return (
    <EnterpriseShell
      active="permissions"
      title="Role Permissions"
      subtitle="Configure access by role"
      contentClassName="overflow-hidden"
    >
      <div className="flex h-full min-h-0">

        {/* ── Left: role list ───────────────────────────────────────────── */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Roles</p>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5">
            {ROLES.map((role) => {
              const def = ROLE_DEFS[role];
              const featureCount = permissions[role].size;
              const isActive = activeRole === role;
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => setActiveRole(role)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    isActive
                      ? "bg-[#5D5FEF]/8 text-[#111]"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {/* Color dot */}
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${def.color}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${isActive ? "text-[#5D5FEF]" : ""}`}>
                      {def.name}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {featureCount} permission{featureCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {def.immutable && (
                    <svg
                      className="h-3.5 w-3.5 shrink-0 text-slate-300"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-label="Locked"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Right: feature toggles ────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

          {/* Role header */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${roleDef.color}`} aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-[#111]">{roleDef.name}</p>
                <p className="text-xs text-slate-400">{roleDef.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {unsaved && (
                <span className="text-xs text-amber-600">Unsaved changes</span>
              )}
              {savedAt && !unsaved && (
                <span className="text-xs text-emerald-600">
                  Saved {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(savedAt))}
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || isImmutable || !unsaved}
                className="rounded-lg bg-[#5D5FEF] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#4849d0] disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {isImmutable && (
            <div className="shrink-0 border-b border-[#5D5FEF]/10 bg-[#5D5FEF]/5 px-6 py-2.5">
              <p className="text-xs text-[#5D5FEF]">
                <strong>{roleDef.name}</strong> always has full access and cannot be restricted.
              </p>
            </div>
          )}

          {/* Feature groups */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              {FEATURE_GROUPS.map((group) => {
                const enabledInGroup = group.features.filter(
                  (f) => isImmutable || currentFeatures.has(f.id),
                ).length;
                return (
                  <div
                    key={group.label}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                  >
                    {/* Group header */}
                    <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        {group.label}
                      </h2>
                      <span className="text-[11px] text-slate-400">
                        {enabledInGroup} / {group.features.length}
                      </span>
                    </div>

                    {/* Feature rows */}
                    <div className="divide-y divide-slate-50">
                      {group.features.map((feature) => {
                        const enabled = isImmutable || currentFeatures.has(feature.id);
                        return (
                          <div
                            key={feature.id}
                            className={`flex items-center justify-between px-4 py-3 transition-colors ${
                              enabled && !isImmutable ? "hover:bg-[#FAFAFA]" : ""
                            }`}
                          >
                            <div className="mr-4">
                              <p className={`text-sm font-medium ${enabled ? "text-[#111]" : "text-slate-400"}`}>
                                {feature.label}
                              </p>
                              <p className="text-xs text-slate-400">{feature.description}</p>
                            </div>
                            <Toggle
                              enabled={enabled}
                              onChange={(v) => toggleFeature(feature.id, v)}
                              disabled={isImmutable}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom padding */}
            <div className="h-6" />
          </div>
        </div>

      </div>
    </EnterpriseShell>
  );
}
