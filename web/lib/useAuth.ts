"use client";

/**
 * useAuth — React hook that exposes the current auth state and actions.
 *
 * On mount it attempts a silent token refresh so the user stays logged in
 * across page reloads without an extra /login redirect.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  isAuthenticated,
  getUser,
  setSession,
  clearSession,
  silentRefresh,
} from "@/lib/auth";
import { apiPost } from "@/api-client/client";
import type { LoginRequest, LoginResponse, UserProfile } from "@/api-client/types";
import { ApiResponseError } from "@/api-client/client";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";
export interface MfaChallenge {
  pendingToken: string;
  expiresIn: number;
}

interface MfaRequiredPayload {
  pendingToken?: string;
  expiresIn?: number;
}

export interface UseAuthReturn {
  status: AuthStatus;
  user: UserProfile | null;
  login: (email: string, password: string) => Promise<MfaChallenge | null>;
  completeMfaLogin: (pendingToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Human-readable error from the last login attempt */
  loginError: string | null;
  isLoading: boolean;
}

export function useAuth(): UseAuthReturn {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // On mount: check in-memory token or attempt silent refresh
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (isAuthenticated()) {
        if (!cancelled) {
          setUser(getUser());
          setStatus("authenticated");
        }
        return;
      }

      // Try to refresh using the stored refresh token
      const refreshed = await silentRefresh();
      if (!cancelled) {
        if (refreshed) {
          setUser(getUser());
          setStatus("authenticated");
        } else {
          setStatus("unauthenticated");
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setLoginError(null);
      setIsLoading(true);
      try {
        const data = await apiPost<LoginResponse>(
          "/api/identity/login",
          { email, password } satisfies LoginRequest,
          { anonymous: true }
        );
        setSession(data.accessToken, data.expiresIn, data.refreshToken, data.user);
        setUser(data.user);
        setStatus("authenticated");
        router.replace("/terminal");
        return null;
      } catch (err) {
        if (err instanceof ApiResponseError) {
          if (err.status === 401 && err.code === "mfa_required") {
            const payload = err.payload as MfaRequiredPayload | undefined;
            if (payload?.pendingToken) {
              return {
                pendingToken: payload.pendingToken,
                expiresIn: typeof payload.expiresIn === "number" ? payload.expiresIn : 300,
              };
            }
          }
          if (err.status === 401) {
            setLoginError("Invalid email or password.");
          } else {
            setLoginError(err.message);
          }
        } else {
          setLoginError("An unexpected error occurred. Please try again.");
        }
      } finally {
        setIsLoading(false);
      }
      return null;
    },
    [router]
  );

  const completeMfaLogin = useCallback(
    async (pendingToken: string, code: string) => {
      setLoginError(null);
      setIsLoading(true);
      try {
        const data = await apiPost<LoginResponse>(
          "/api/identity/login/mfa",
          { pendingToken, code },
          { anonymous: true }
        );
        setSession(data.accessToken, data.expiresIn, data.refreshToken, data.user);
        setUser(data.user);
        setStatus("authenticated");
        router.replace("/terminal");
      } catch (err) {
        if (err instanceof ApiResponseError) {
          setLoginError(err.status === 401 ? "Invalid or expired MFA code." : err.message);
        } else {
          setLoginError("An unexpected error occurred. Please try again.");
        }
      } finally {
        setIsLoading(false);
      }
    },
    [router]
  );

  const logout = useCallback(async () => {
    // Clear local session immediately so concurrent requests stop retrying.
    clearSession();
    setUser(null);
    setStatus("unauthenticated");

    // Revoke the refresh token on the backend. The httpOnly cookie is sent
    // automatically; the backend also clears both auth cookies in the response.
    void apiPost("/api/identity/logout", {}, { anonymous: true }).catch(() => {});

    router.replace("/login");
  }, [router]);

  return { status, user, login, completeMfaLogin, logout, loginError, isLoading };
}
