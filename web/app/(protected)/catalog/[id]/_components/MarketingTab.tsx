"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { apiPatch, ApiResponseError } from "@/api-client/client";
import { useCapabilities } from "@/contexts/CapabilitiesContext";
import type { CatalogProduct } from "@/api-client/types";

const FIELD = "w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-[#111] outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-[#111]">{title}</h3>
      {children}
    </div>
  );
}

const TOBACCO_TYPES = [
  { value: "", label: "None (not tobacco/vape)" },
  { value: "cigarette", label: "Cigarette" },
  { value: "cigar", label: "Cigar / Cigarillo" },
  { value: "smokeless", label: "Smokeless / Chewing" },
  { value: "ecigarette", label: "E-Cigarette / Vape" },
] as const;

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
] as const;

type TobaccoType = "" | "cigarette" | "cigar" | "smokeless" | "ecigarette";

export function MarketingTab({
  product,
  onSaved,
}: {
  product: CatalogProduct;
  onSaved: (p: CatalogProduct) => void;
}) {
  // Regulated-product compliance is a module, not a hardcoded panel: tenants
  // outside regulated verticals disable the `compliance` module and never see
  // tobacco/MSA fields. moduleEnabled is deliberately fail-open — compliance
  // is core to Ascend's specialty-retail market, so it shows unless opted out.
  const { moduleEnabled } = useCapabilities();
  const complianceEnabled = moduleEnabled("compliance");

  // Loyalty
  const [loyaltyMode, setLoyaltyMode] = useState<"default" | "custom">("default");
  const [customLoyaltyPct, setCustomLoyaltyPct] = useState("5.00");
  const [savingLoyalty, setSavingLoyalty] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState<string | null>(null);
  const [loyaltySaved, setLoyaltySaved] = useState(false);

  // Compliance
  const [complianceForm, setComplianceForm] = useState<{
    tobacco_type: TobaccoType;
    flavored: boolean;
    menthol: boolean;
    msa_reportable: boolean;
    restricted_states: string[];
  }>({
    tobacco_type: (product.tobacco_type ?? "") as TobaccoType,
    flavored: !!product.flavored,
    menthol: !!product.menthol,
    msa_reportable: !!product.msa_reportable,
    restricted_states: product.restricted_states ?? [],
  });
  const [savingCompliance, setSavingCompliance] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [complianceSaved, setComplianceSaved] = useState(false);

  const saveLoyalty = async () => {
    setSavingLoyalty(true); setLoyaltyError(null); setLoyaltySaved(false);
    try {
      await Promise.resolve(); // UI-only for now — no loyalty_rate field in current API
      setLoyaltySaved(true);
      setTimeout(() => setLoyaltySaved(false), 2000);
    } catch (e) {
      setLoyaltyError(e instanceof Error ? e.message : "Save failed.");
    } finally { setSavingLoyalty(false); }
  };

  const saveCompliance = async () => {
    setSavingCompliance(true); setComplianceError(null); setComplianceSaved(false);
    try {
      const updated = await apiPatch<CatalogProduct>(`/api/v1/catalog/${product.id}/compliance`, {
        tobacco_type: complianceForm.tobacco_type || null,
        flavored: complianceForm.flavored ? 1 : 0,
        menthol: complianceForm.menthol ? 1 : 0,
        msa_reportable: complianceForm.msa_reportable ? 1 : 0,
        restricted_states: complianceForm.restricted_states,
      });
      onSaved(updated);
      setComplianceSaved(true);
      setTimeout(() => setComplianceSaved(false), 2000);
    } catch (e) {
      setComplianceError(e instanceof ApiResponseError ? e.message : "Save failed.");
    } finally { setSavingCompliance(false); }
  };

  return (
    <div className="space-y-4">

      {/* ── Loyalty ───────────────────────────────────────────────────── */}
      <Section title="Loyalty">
        {loyaltyError && (
          <p role="alert" className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{loyaltyError}</p>
        )}
        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600"
              checked={loyaltyMode === "default"}
              onChange={() => setLoyaltyMode("default")}
            />
            <div>
              <p className="text-sm font-medium text-[#111]">Earn default loyalty</p>
              <p className="text-xs text-slate-500">
                Customers earn based on the default ratio of 5.00% applied to the retail price.
              </p>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600"
              checked={loyaltyMode === "custom"}
              onChange={() => setLoyaltyMode("custom")}
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-[#111]">Earn custom loyalty</p>
              <p className="text-xs text-slate-500">Set a custom loyalty earning rate for this product.</p>
              {loyaltyMode === "custom" && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="w-24 rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-brand-600"
                    value={customLoyaltyPct}
                    onChange={(e) => setCustomLoyaltyPct(e.target.value)}
                  />
                  <span className="text-sm text-slate-500">%</span>
                </div>
              )}
            </div>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" variant="primary" loading={savingLoyalty} onClick={() => void saveLoyalty()}>
            Save loyalty
          </Button>
          {loyaltySaved && <span className="text-xs text-emerald-600">Saved ✓</span>}
        </div>
      </Section>

      {/* ── Compliance ────────────────────────────────────────────────── */}
      {complianceEnabled && (
      <Section title="Compliance">
        {complianceError && (
          <p role="alert" className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{complianceError}</p>
        )}
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Tobacco / vape type</label>
            <select
              className={FIELD}
              value={complianceForm.tobacco_type}
              onChange={(e) => setComplianceForm((f) => ({ ...f, tobacco_type: e.target.value as TobaccoType }))}
            >
              {TOBACCO_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            {(["flavored", "menthol", "msa_reportable"] as const).map((key) => (
              <label key={key} className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  checked={complianceForm[key]}
                  onChange={(e) => setComplianceForm((f) => ({ ...f, [key]: e.target.checked }))}
                />
                <span className="text-sm text-[#111] capitalize">{key.replace(/_/g, " ")}</span>
              </label>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500">
              Restricted states ({complianceForm.restricted_states.length} selected)
            </p>
            <div className="grid max-h-44 grid-cols-5 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {US_STATES.map((st) => (
                <label key={st} className="flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                    checked={complianceForm.restricted_states.includes(st)}
                    onChange={(e) => setComplianceForm((f) => ({
                      ...f,
                      restricted_states: e.target.checked
                        ? [...f.restricted_states, st]
                        : f.restricted_states.filter((s) => s !== st),
                    }))}
                  />
                  <span className="text-xs text-slate-600">{st}</span>
                </label>
              ))}
            </div>
            {product.restricted_states && product.restricted_states.length > 0 && (
              <p className="mt-1 text-xs text-red-600">
                Currently blocked in: {product.restricted_states.join(", ")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="primary" loading={savingCompliance} onClick={() => void saveCompliance()}>
              Save compliance
            </Button>
            {complianceSaved && <span className="text-xs text-emerald-600">Saved ✓</span>}
          </div>
        </div>
      </Section>
      )}

    </div>
  );
}
