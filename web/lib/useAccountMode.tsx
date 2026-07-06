"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useCapabilities } from "@/contexts/CapabilitiesContext";

export type AccountMode = "RETAIL" | "WHOLESALE" | "ENTERPRISE";

export type FeatureFlags = {
  bulkOrdering: boolean;
  approvalWorkflow: boolean;
  contractPricing: boolean;
  teamManagement: boolean;
  purchaseOrders: boolean;
};

const MODE_FEATURES: Record<AccountMode, FeatureFlags> = {
  RETAIL: {
    bulkOrdering: false,
    approvalWorkflow: false,
    contractPricing: false,
    teamManagement: false,
    purchaseOrders: false,
  },
  WHOLESALE: {
    bulkOrdering: true,
    approvalWorkflow: false,
    contractPricing: false,
    teamManagement: false,
    purchaseOrders: true,
  },
  ENTERPRISE: {
    bulkOrdering: true,
    approvalWorkflow: true,
    contractPricing: true,
    teamManagement: true,
    purchaseOrders: true,
  },
};

interface AccountModeContextValue {
  mode: AccountMode;
  features: FeatureFlags;
  editionFlags: Record<string, boolean>;
  isRetail: boolean;
  isWholesale: boolean;
  isEnterprise: boolean;
  canAccess: (feature: keyof FeatureFlags) => boolean;
}

const DEFAULT_EDITION_FLAGS = { groupRetailPOS: true, groupWholesale: true, groupEnterprise: true };

const AccountModeContext = createContext<AccountModeContextValue>({
  mode: "ENTERPRISE",
  features: MODE_FEATURES.ENTERPRISE,
  editionFlags: DEFAULT_EDITION_FLAGS,
  isRetail: false,
  isWholesale: false,
  isEnterprise: true,
  canAccess: () => true,
});

export function AccountModeProvider({ children }: { children: ReactNode }) {
  // Derive account mode + edition flags from the capabilities contract — the
  // single tenant-layer authority — instead of a separate /settings/feature-flags
  // fetch. GET /capabilities already computes features.accountMode and the
  // group* edition flags server-side, so this hook no longer issues its own
  // request. Fail-open to ENTERPRISE (all features) while capabilities load or
  // on error, matching the prior default.
  const { capabilities } = useCapabilities();
  const rawMode = capabilities?.features?.["accountMode"];
  const mode: AccountMode =
    rawMode === "RETAIL" || rawMode === "WHOLESALE" || rawMode === "ENTERPRISE"
      ? rawMode
      : "ENTERPRISE";

  const editionFlags: Record<string, boolean> = { ...DEFAULT_EDITION_FLAGS };
  if (capabilities?.features) {
    for (const [k, v] of Object.entries(capabilities.features)) {
      if (typeof v === "boolean") editionFlags[k] = v;
    }
  }

  const features = MODE_FEATURES[mode];
  const value: AccountModeContextValue = {
    mode,
    features,
    editionFlags,
    isRetail: mode === "RETAIL",
    isWholesale: mode === "WHOLESALE",
    isEnterprise: mode === "ENTERPRISE",
    canAccess: (feature) => features[feature],
  };

  return <AccountModeContext.Provider value={value}>{children}</AccountModeContext.Provider>;
}

export function useAccountMode() {
  return useContext(AccountModeContext);
}
