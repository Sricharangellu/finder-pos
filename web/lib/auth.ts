/**
 * Auth / session helpers.
 *
 * Design:
 * - The access token lives ONLY in memory (a module-level variable).
 *   This protects against XSS leaking tokens from localStorage.
 * - The refresh token is stored in sessionStorage so it survives page
 *   refreshes within the same browser tab, but is wiped when the tab closes.
 * - On mount, if a refresh token exists, the app silently refreshes to
 *   re-hydrate the in-memory access token.
 */

import type { UserProfile, Role } from "@/api-client/types";

// ─── In-memory token store ────────────────────────────────────────────────────

let _accessToken: string | null = null;
let _expiresAt: number | null = null; // unix ms
let _user: UserProfile | null = null;

const REFRESH_TOKEN_KEY = "finder_pos_refresh";
const USER_KEY = "finder_pos_user";

// ─── Public getters ───────────────────────────────────────────────────────────

export function getAccessToken(): string | null {
  return _accessToken;
}

export function getUser(): UserProfile | null {
  return _user;
}

export function isAuthenticated(): boolean {
  if (!_accessToken) return false;
  if (_expiresAt !== null && Date.now() >= _expiresAt) {
    // Token has expired in-memory — clear it
    clearAccessToken();
    return false;
  }
  return true;
}

export function hasRole(required: Role): boolean {
  if (!_user) return false;
  const hierarchy: Record<Role, number> = { owner: 3, manager: 2, cashier: 1 };
  return hierarchy[_user.role] >= hierarchy[required];
}

// ─── Session mutations ────────────────────────────────────────────────────────

export function setSession(
  accessToken: string,
  expiresIn: number,
  refreshToken: string,
  user: UserProfile
): void {
  _accessToken = accessToken;
  _expiresAt = Date.now() + expiresIn * 1000;
  _user = user;

  // Persist refresh token + user profile across refreshes (same tab)
  if (typeof window !== "undefined") {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

export function setRefreshedToken(
  accessToken: string,
  expiresIn: number
): void {
  _accessToken = accessToken;
  _expiresAt = Date.now() + expiresIn * 1000;
}

export function clearAccessToken(): void {
  _accessToken = null;
  _expiresAt = null;
}

export function clearSession(): void {
  _accessToken = null;
  _expiresAt = null;
  _user = null;
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }
}

// ─── Refresh token helpers ────────────────────────────────────────────────────

export function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredUser(): UserProfile | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

// ─── Silent refresh ───────────────────────────────────────────────────────────

/**
 * Attempt a silent token refresh using the stored refresh token.
 * Returns true if the session is now valid.
 *
 * This is called on app init (in useAuth / route guards) before deciding
 * whether to redirect to /login.
 */
export async function silentRefresh(): Promise<boolean> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;

  try {
    // Import lazily to avoid circular deps (client imports auth)
    const { apiPost } = await import("@/api-client/client");

    const data = await apiPost<import("@/api-client/types").RefreshResponse>(
      "/api/identity/refresh",
      { refreshToken },
      { anonymous: true }
    );

    setRefreshedToken(data.accessToken, data.expiresIn);

    // Re-hydrate user from sessionStorage (refresh endpoint only returns token)
    const storedUser = getStoredUser();
    if (storedUser) {
      _user = storedUser;
    }

    return true;
  } catch {
    clearSession();
    return false;
  }
}
