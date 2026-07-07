"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiGet } from "@/api-client/client";
import { ALL_FEATURES } from "@/lib/features";

// ── Types ─────────────────────────────────────────────────────────────────────

// Real GET /api/identity/me returns { userId, tenantId, role }. The mock adds
// name/email/features. Only role is guaranteed; the rest are optional so the
// same handler works against both.
interface MeResponse {
  userId?: string;
  tenantId?: string;
  id?: string;
  name?: string;
  email?: string;
  role: string;
  features?: string[];
}

interface PermissionsState {
  role: string;
  features: Set<string>;
  loading: boolean;
  /**
   * True when the identity request failed. While set, feature-gated surfaces
   * stay hidden (fail closed) and the shell can show a clear notice instead of
   * silently exposing every privileged surface.
   */
  error: boolean;
  hasFeature: (id: string) => boolean;
}

// Roles the backend grants blanket access to — mirrors backend `allAccess`.
const ALL_ACCESS_ROLES = new Set(["owner", "admin", "manager"]);

// ── Context ───────────────────────────────────────────────────────────────────

// Fail CLOSED by default. Before identity is known there is no role and no
// features, and `hasFeature` denies everything. A missing provider or a read
// during load must never expose privileged, feature-gated surfaces. Backend
// RBAC is the real authority; the frontend simply must not advertise what it
// cannot prove the caller is allowed to use.
const PermissionsContext = createContext<PermissionsState>({
  role: "",
  features: new Set(),
  loading: true,
  error: false,
  hasFeature: () => false,
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<string>("");
  const [features, setFeatures] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Identity is served at the REAL path /api/identity/me (not the legacy
    // /api/v1/auth/me, which 404s → the old catch kept role="owner" for EVERY
    // user, a privilege bug). Owner/admin/manager get all features (mirrors
    // backend allAccess); any other role gets exactly the feature list the
    // response grants. We never fail open: an absent feature list, the loading
    // state, or a request failure all leave privileged surfaces hidden.
    let cancelled = false;
    apiGet<MeResponse>("/api/identity/me")
      .then((r) => {
        if (cancelled) return;
        setRole(r.role);
        if (ALL_ACCESS_ROLES.has(r.role)) {
          setFeatures(new Set(ALL_FEATURES));
        } else {
          // Restricted role → only the features the identity response grants.
          // No list means no feature-gated access (fail closed), not full access.
          setFeatures(new Set(r.features ?? []));
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Fail CLOSED — identity could not be established, so grant nothing and
        // flag the error so the shell can surface a clear "permissions
        // unavailable" state rather than silently exposing every surface.
        setRole("");
        setFeatures(new Set());
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasFeature = useCallback(
    (id: string) => {
      // Conservative while identity is unknown: hide feature-gated surfaces
      // during load and after a failure rather than flashing full access.
      if (loading || error) return false;
      if (role === "owner" || role === "admin") return true;
      return features.has(id);
    },
    [loading, error, role, features],
  );

  return (
    <PermissionsContext.Provider value={{ role, features, loading, error, hasFeature }}>
      {children}
    </PermissionsContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePermissions(): PermissionsState {
  return useContext(PermissionsContext);
}
