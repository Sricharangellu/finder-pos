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

export interface UseAuthReturn {
  status: AuthStatus;
  user: UserProfile | null;
  login: (email: string, password: string) => Promise<void>;
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
      } catch (err) {
        if (err instanceof ApiResponseError) {
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
    },
    [router]
  );

  const logout = useCallback(async () => {
    // Logout is client-side only — the backend issues stateless JWTs with no
    // server-side logout endpoint, so we simply drop the local session.
    {
      clearSession();
      setUser(null);
      setStatus("unauthenticated");
      router.replace("/login");
    }
  }, [router]);

  return { status, user, login, logout, loginError, isLoading };
}
