/**
 * Auth / session helpers.
 *
 * Design:
 * - The access token lives ONLY in memory (a module-level variable).
 *   This protects against XSS leaking tokens from localStorage.
 * - The refresh token lives in an httpOnly cookie set by the backend on
 *   login/refresh. JavaScript cannot read it (XSS-safe). It is sent
 *   automatically by the browser to /api/identity/refresh.
 * - A non-httpOnly `finder_session_hint=1` cookie is also set — readable by
 *   JavaScript and Next.js middleware — to signal that a session exists
 *   without exposing the actual token.
 * - On mount, if the session hint cookie is present, the app silently calls
 *   /refresh (cookie sent automatically) to re-hydrate the in-memory token.
 */

import type { UserProfile, Role } from "@/api-client/types";

// ─── In-memory token store ────────────────────────────────────────────────────

let _accessToken: string | null = null;
let _expiresAt: number | null = null; // unix ms
let _user: UserProfile | null = null;

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
  _refreshToken: string, // kept for API compatibility — token now lives in httpOnly cookie
  user: UserProfile
): void {
  _accessToken = accessToken;
  _expiresAt = Date.now() + expiresIn * 1000;
  _user = user;

  // Persist user profile so silentRefresh can restore it across page loads.
  if (typeof window !== "undefined") {
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
    sessionStorage.removeItem(USER_KEY);
  }
}

// ─── Session hint (non-httpOnly cookie — readable by JS and middleware) ───────

/** Returns true if the browser likely has a valid refresh cookie (session hint present). */
export function hasSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes("finder_session_hint=");
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
 * Attempt a silent token refresh.
 * The httpOnly `finder_refresh` cookie is sent automatically by the browser.
 * Returns true if the session is now valid.
 *
 * Guarded by the session hint cookie — if that cookie is absent the user is
 * definitely logged out and there is no point hitting the network.
 */
export async function silentRefresh(): Promise<boolean> {
  if (!hasSessionHint()) return false;

  try {
    // Import lazily to avoid circular deps (client imports auth)
    const { apiPost } = await import("@/api-client/client");

    // No body needed — the refresh token is in the httpOnly cookie.
    const data = await apiPost<import("@/api-client/types").RefreshResponse>(
      "/api/identity/refresh",
      {},
      { anonymous: true }
    );

    setRefreshedToken(data.accessToken, data.expiresIn);

    // Re-hydrate user from sessionStorage (refresh endpoint only returns tokens)
    const storedUser = getStoredUser();
    if (storedUser) _user = storedUser;

    return true;
  } catch {
    clearSession();
    return false;
  }
}
