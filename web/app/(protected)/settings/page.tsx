"use client";

import { useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { getUser } from "@/lib/auth";
import { useFlags } from "@/flags/FlagProvider";

const deviceRows = [
  { name: "Receipt printer", value: "Epson TM-m30", status: "Ready", lastSeen: "12 sec ago" },
  { name: "Cash drawer", value: "Drawer 01", status: "Ready", lastSeen: "12 sec ago" },
  { name: "Barcode scanner", value: "USB HID", status: "Ready", lastSeen: "1 min ago" },
  { name: "Payment terminal", value: "EMV simulator", status: "Sandbox", lastSeen: "Connected" },
  { name: "Customer display", value: "Display 01", status: "Ready", lastSeen: "25 sec ago" },
];

const roleRows = [
  { role: "Owner", register: true, refunds: true, inventory: true, reports: true, settings: true },
  { role: "Manager", register: true, refunds: true, inventory: true, reports: true, settings: false },
  { role: "Cashier", register: true, refunds: false, inventory: false, reports: false, settings: false },
];

const checkoutControls = [
  { label: "Require manager approval for voids", enabled: true },
  { label: "Print receipt by default", enabled: false },
  { label: "Prompt customer display for email receipt", enabled: true },
  { label: "Queue sales when offline", enabled: true },
];

export default function SettingsPage() {
  const { flags } = useFlags();
  const role = getUser()?.role ?? "cashier";
  const canManage = role === "owner" || role === "manager";
  const [selectedSection, setSelectedSection] = useState<"store" | "devices" | "roles" | "flags">("store");

  const flagRows = useMemo(() => {
    const merged = {
      product_grid: true,
      checkout_split_tender: flags.checkout_split_tender ?? false,
      reporting_dashboard: flags.reporting_dashboard ?? false,
      customer_display: flags.customer_display ?? true,
      inventory_receiving: flags.inventory_receiving ?? false,
      ...flags,
    };
    return Object.entries(merged)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, enabled]) => ({ key, enabled }));
  }, [flags]);

  return (
    <EnterpriseShell
      active="settings"
      title="Settings"
      subtitle="Store, devices, roles, and checkout controls"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-5 px-4 py-6 xl:grid-cols-[16rem_1fr_24rem]">
        <Card className="h-fit p-2">
          <nav aria-label="Settings sections" className="flex flex-col gap-1">
            <SectionButton active={selectedSection === "store"} onClick={() => setSelectedSection("store")} label="Store profile" />
            <SectionButton active={selectedSection === "devices"} onClick={() => setSelectedSection("devices")} label="Devices" />
            <SectionButton active={selectedSection === "roles"} onClick={() => setSelectedSection("roles")} label="Roles & access" />
            <SectionButton active={selectedSection === "flags"} onClick={() => setSelectedSection("flags")} label="Feature flags" />
          </nav>
        </Card>

        <div className="flex flex-col gap-5">
          {selectedSection === "store" && (
          <>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Store profile</h2>
                <p className="text-sm text-gray-500">Identity used on receipts, reports, and device pairing.</p>
              </div>
              <Button variant="secondary" size="sm" disabled={!canManage}>Edit</Button>
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
              <Field label="Store" value="Demo Store" />
              <Field label="Register" value="Register 01" />
              <Field label="Tax region" value="CA sandbox" />
              <Field label="Business day" value="4:00 AM close" />
              <Field label="Receipt footer" value="Thank you for shopping" />
              <Field label="Currency" value="USD" />
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Checkout controls</h2>
              <p className="text-sm text-gray-500">Register behavior visible to cashiers during live checkout.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {checkoutControls.map((control) => (
                <ToggleRow key={control.label} label={control.label} enabled={control.enabled} disabled={!canManage} />
              ))}
            </div>
          </Card>
          </>
          )}

          {selectedSection === "devices" && (
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Connected devices</h2>
                <p className="text-sm text-gray-500">Hardware readiness for register operations.</p>
              </div>
              <Button variant="secondary" size="sm" disabled={!canManage}>Pair device</Button>
            </div>
            <ul className="divide-y divide-gray-100">
              {deviceRows.map((row) => (
                <li key={row.name} className="grid gap-2 px-4 py-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center">
                  <span className="font-medium text-gray-900">{row.name}</span>
                  <span className="text-sm text-gray-500">{row.value}</span>
                  <span className="text-sm text-gray-500">{row.lastSeen}</span>
                  <span className="w-fit rounded bg-success-100 px-2 py-1 text-xs font-semibold text-success-700">
                    {row.status}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          )}

          {selectedSection === "roles" && (
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Roles & access</h2>
                <p className="text-sm text-gray-500">Permission model for register, operations, and admin workflows.</p>
              </div>
              <Button variant="primary" size="sm" disabled={!canManage}>Invite user</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Register</th>
                    <th className="px-4 py-3">Refunds</th>
                    <th className="px-4 py-3">Inventory</th>
                    <th className="px-4 py-3">Reports</th>
                    <th className="px-4 py-3">Settings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {roleRows.map((row) => (
                    <tr key={row.role}>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-gray-900">{row.role}</td>
                      <PermissionCell enabled={row.register} />
                      <PermissionCell enabled={row.refunds} />
                      <PermissionCell enabled={row.inventory} />
                      <PermissionCell enabled={row.reports} />
                      <PermissionCell enabled={row.settings} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          )}

          {selectedSection === "flags" && (
          <Card className="overflow-hidden p-0">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-base font-semibold text-gray-900">Feature flags</h2>
              <p className="text-sm text-gray-500">Current frontend-visible flags. Backend remains the source of truth.</p>
            </div>
            <ul className="divide-y divide-gray-100">
              {flagRows.map((flag) => (
                <li key={flag.key} className="grid gap-2 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <span className="font-mono text-sm font-semibold text-gray-900">{flag.key}</span>
                  <span className={`w-fit rounded px-2 py-1 text-xs font-semibold ${
                    flag.enabled ? "bg-success-100 text-success-700" : "bg-gray-100 text-gray-600"
                  }`}>
                    {flag.enabled ? "Enabled" : "Disabled"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          )}
        </div>

        <Card className="flex h-fit flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Security posture</h2>
            <p className="mt-1 text-sm text-gray-500">Enterprise controls benchmarked against modern retail POS expectations.</p>
          </div>
          <SecurityRow label="Role-based access" value="Enabled" />
          <SecurityRow label="User switching" value="Planned" />
          <SecurityRow label="MFA" value="Planned" />
          <SecurityRow label="Audit log" value="Backend-owned" />
          <SecurityRow label="Session policy" value="15 min access token" />
          <SecurityRow label="Offline checkout" value="Queued locally" />
          <Button variant="primary" size="sm" disabled={!canManage}>Manage roles</Button>
        </Card>
      </div>
    </EnterpriseShell>
  );
}

function SectionButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[44px] rounded-lg px-3 text-left text-sm font-medium transition-colors ${
        active ? "bg-brand-600 text-white" : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-1 font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function ToggleRow({ label, enabled, disabled }: { label: string; enabled: boolean; disabled: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={enabled}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          enabled ? "bg-brand-600" : "bg-gray-300"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
            enabled ? "left-6" : "left-1"
          }`}
        />
        <span className="sr-only">{label}</span>
      </button>
    </div>
  );
}

function PermissionCell({ enabled }: { enabled: boolean }) {
  return (
    <td className="whitespace-nowrap px-4 py-3">
      <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${
        enabled ? "bg-success-100 text-success-700" : "bg-gray-100 text-gray-500"
      }`}>
        {enabled ? "Allowed" : "Blocked"}
      </span>
    </td>
  );
}

function SecurityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold text-gray-900">{value}</span>
    </div>
  );
}
