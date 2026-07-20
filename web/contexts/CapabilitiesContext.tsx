"use client";

/**
 * CapabilitiesContext — the tenant layer of the four-layer access model
 * (plan / business type / entitlements / permissions).
 *
 * Fetches GET /api/v1/capabilities once after auth and exposes the resolved
 * business-pack state: business type, per-module enablement (core + pack
 * defaults + manual overrides, computed server-side), features, plan, and the
 * business-type registry. The shell/nav and Business Profile settings render
 * from this — never from hardcoded business-type assumptions.
 *
 * This complements PermissionsContext (the user layer): a nav entry is shown
 * only when the tenant has the module enabled AND the user has the feature.
 *
 * Fail-open: while loading or on network error, everything is treated as
 * enabled so the app stays usable (same policy as PermissionsContext).
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiGet } from "@/api-client/client";
import type { CapabilitiesResponse, CapabilityModule } from "@/api-client/types";

const CACHE_KEY = "ascend_capabilities_v1";
const CACHE_TTL = 5 * 60 * 1000; // 5 min — same policy as the module-flags cache

interface CapabilitiesState {
  capabilities: CapabilitiesResponse | null;
  loading: boolean;
  /** Tenant-layer check: is this module enabled for the tenant? Fail-open. */
  moduleEnabled: (key: string) => boolean;
  /** Tenant-layer check by route: is the module owning this href enabled? Fail-open. */
  routeEnabled: (href: string) => boolean;
  /** Re-fetch after a business-profile or module-flag change. */
  refresh: () => Promise<void>;
}

const CapabilitiesContext = createContext<CapabilitiesState>({
  capabilities: null,
  loading: false,
  moduleEnabled: () => true,
  routeEnabled: () => true,
  refresh: async () => {},
});

function readCache(): CapabilitiesResponse | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { at: number; data: CapabilitiesResponse };
    if (Date.now() - cached.at > CACHE_TTL) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function writeCache(data: CapabilitiesResponse): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota — ignore */
  }
}

/** Invalidate the capabilities cache (call after saving the business profile). */
export function invalidateCapabilitiesCache(): void {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function CapabilitiesProvider({ children }: { children: React.ReactNode }) {
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(() => readCache());
  const [loading, setLoading] = useState(capabilities === null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<CapabilitiesResponse>("/api/v1/capabilities");
      setCapabilities(data);
      writeCache(data);
    } catch {
      // Fail open — capabilities stay null and every check returns true, so
      // a capabilities outage never blanks the navigation.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (capabilities === null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    invalidateCapabilitiesCache();
    setLoading(true);
    await load();
  }, [load]);

  // Routes owned by explicitly DISABLED modules. Only these hide nav entries —
  // unknown routes (dashboard, docs, vertical pages without a module) stay
  // visible, keeping the check conservative and fail-open.
  const disabledRoutes = useMemo(() => {
    if (!capabilities) return [] as string[];
    return capabilities.modules
      .filter((m: CapabilityModule) => !m.enabled && m.route)
      .map((m) => m.route as string);
  }, [capabilities]);

  const moduleEnabled = useCallback(
    (key: string) => {
      if (!capabilities) return true; // loading or error — fail open
      const mod = capabilities.modules.find((m) => m.key === key);
      return mod ? mod.enabled : true;
    },
    [capabilities],
  );

  const routeEnabled = useCallback(
    (href: string) => {
      if (disabledRoutes.length === 0) return true;
      return !disabledRoutes.some(
        (route) => href === route || href.startsWith(route.endsWith("/") ? route : `${route}/`),
      );
    },
    [disabledRoutes],
  );

  const value = useMemo(
    () => ({ capabilities, loading, moduleEnabled, routeEnabled, refresh }),
    [capabilities, loading, moduleEnabled, routeEnabled, refresh],
  );

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities(): CapabilitiesState {
  return useContext(CapabilitiesContext);
}
