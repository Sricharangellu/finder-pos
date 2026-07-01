"use client";

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { getUser } from "@/lib/auth";
import { useToast } from "@/components/Toast";
import { usePathname, useRouter } from "next/navigation";
import { SecuritySection } from "./_components/SecuritySection";
import { ApiKeysSection } from "./_components/ApiKeysSection";
import { ReceiptsSection } from "./_components/ReceiptsSection";
import { CoaSection } from "./_components/CoaSection";
import { DepositsSection } from "./_components/DepositsSection";
import { LoyaltyTiersSection } from "./_components/LoyaltyTiersSection";
import {
  StoreSection,
  ShippingSection,
  TermsSection,
  ModesSection,
  TaxSection,
  FlagsSection,
  CurrenciesSection,
} from "./_components/SettingsSections";

type Section = "store" | "shipping" | "terms" | "modes" | "tax" | "flags" | "security" | "coa" | "deposits" | "loyalty" | "api-keys" | "currencies" | "receipts";

const ALL_SECTIONS: Section[] = ["store", "shipping", "terms", "modes", "tax", "flags", "security", "coa", "deposits", "loyalty", "receipts", "api-keys", "currencies"];

function sectionFromPath(pathname: string): Section {
  if (pathname.endsWith("/shipping")) return "shipping";
  if (pathname.endsWith("/payment-terms")) return "terms";
  if (pathname.endsWith("/payment-types") || pathname.endsWith("/payment-modes")) return "modes";
  if (pathname.endsWith("/taxes")) return "tax";
  if (pathname.endsWith("/security")) return "security";
  if (pathname.endsWith("/loyalty")) return "loyalty";
  if (pathname.endsWith("/devices")) return "receipts";
  return "store";
}

function sectionPath(section: Section): string | null {
  return ({
    store: "/setup",
    shipping: "/setup/shipping",
    terms: "/setup/payment-terms",
    modes: "/setup/payment-modes",
    tax: "/setup/taxes",
    security: "/setup/security",
    loyalty: "/setup/loyalty",
    receipts: "/setup/devices",
    flags: null,
    coa: null,
    deposits: null,
    "api-keys": null,
    currencies: null,
  } as Record<Section, string | null>)[section];
}

function sectionLabel(s: Section): string {
  return ({
    store: "Store profile", shipping: "Shipping methods", terms: "Payment terms",
    modes: "Payment modes", tax: "Tax rates", flags: "Feature flags", security: "Security",
    coa: "Chart of Accounts", deposits: "Deposits", loyalty: "Loyalty Tiers",
    receipts: "Receipt templates", "api-keys": "API Keys", currencies: "Currencies",
  } as Record<Section, string>)[s];
}

function SectionButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`min-h-[44px] rounded-md px-3 text-left text-sm font-medium transition-colors ${active ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"}`}
    >
      {label}
    </button>
  );
}

export default function SettingsPage() {
  const pathname = usePathname();
  const router = useRouter();
  const role = getUser()?.role ?? "cashier";
  const canManage = role === "owner" || role === "manager";
  const [section, setSection] = useState<Section>(() => sectionFromPath(pathname));
  const { addToast } = useToast();

  useEffect(() => setSection(sectionFromPath(pathname)), [pathname]);

  return (
    <EnterpriseShell active="settings" title="Setup" subtitle="Store, payments, shipping, and feature flags" contentClassName="overflow-y-auto">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-5 px-4 py-6 xl:grid-cols-[16rem_1fr]">
        <Card className="h-fit p-2">
          <nav aria-label="Settings sections" className="flex flex-col gap-1">
            {ALL_SECTIONS.map((s) => (
              <SectionButton key={s} active={section === s} onClick={() => {
                setSection(s);
                const route = sectionPath(s);
                if (route) router.replace(route, { scroll: false });
              }} label={sectionLabel(s)} />
            ))}
          </nav>
        </Card>

        <div className="flex min-w-0 flex-col gap-5">
          {section === "store"    && <StoreSection canManage={canManage} addToast={addToast} />}
          {section === "shipping" && <ShippingSection canManage={canManage} addToast={addToast} />}
          {section === "terms"    && <TermsSection canManage={canManage} addToast={addToast} />}
          {section === "modes"    && <ModesSection canManage={canManage} addToast={addToast} />}
          {section === "tax"      && <TaxSection canManage={canManage} addToast={addToast} />}
          {section === "flags"    && <FlagsSection canManage={canManage} addToast={addToast} />}
          {section === "security" && <SecuritySection />}
          {section === "coa"      && <CoaSection canManage={canManage} />}
          {section === "deposits" && <DepositsSection canManage={canManage} />}
          {section === "loyalty"  && <LoyaltyTiersSection canManage={canManage} />}
          {section === "api-keys" && <ApiKeysSection canManage={canManage} addToast={addToast} />}
          {section === "currencies" && <CurrenciesSection />}
          {section === "receipts" && <ReceiptsSection canManage={canManage} addToast={addToast} />}
        </div>
      </div>
    </EnterpriseShell>
  );
}
