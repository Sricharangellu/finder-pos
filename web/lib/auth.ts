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
 *
 * Dual-write/dual-read (rebrand Phase 1, steps 1-2): the backend now sets
 * both `ascend_refresh`/`ascend_session_hint` (new) and `finder_refresh`/
 * `finder_session_hint` (old) alongside each other — see
 * WORK/FUNCTIONAL_REBRAND_PLAN.md. This file mirrors that: it sets/clears
 * both session-hint cookie names when it writes one directly, and reads the
 * new name first, falling back to the old, so existing sessions carrying
 * only the old cookie keep working.
 */

import type { UserProfile, Role } from "@/api-client/types";

// ─── In-memory token store ────────────────────────────────────────────────────

let _accessToken: string | null = null;
let _expiresAt: number | null = null; // unix ms
let _user: UserProfile | null = null;

const USER_KEY = "ascend_user";
const MOCK_REFRESH_KEY = "ascend_mock_refresh";

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
    // Store mock refresh token in dev mode AND demo mode so silentRefresh can
    // send it back to the MSW handler after a page reload.
    const isMockSession =
      process.env.NODE_ENV === "development" ||
      (() => { try { return localStorage.getItem("ascend_demo") === "1"; } catch { return false; } })();
    if (isMockSession) {
      sessionStorage.setItem(MOCK_REFRESH_KEY, _refreshToken);
    }
    document.cookie = "finder_session_hint=1; Path=/; SameSite=Lax";
    document.cookie = "ascend_session_hint=1; Path=/; SameSite=Lax";
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
    sessionStorage.removeItem(MOCK_REFRESH_KEY);
    document.cookie = "finder_session_hint=; Path=/; Max-Age=0; SameSite=Lax";
    document.cookie = "ascend_session_hint=; Path=/; Max-Age=0; SameSite=Lax";
  }
}

// ─── Session hint (non-httpOnly cookie — readable by JS and middleware) ───────

/** Returns true if the browser likely has a valid refresh cookie (session hint present). */
export function hasSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  // Dual-read: prefer the new cookie name, fall back to the old one.
  return (
    document.cookie.includes("ascend_session_hint=") ||
    document.cookie.includes("finder_session_hint=")
  );
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
 * The httpOnly refresh cookie (`ascend_refresh`, or `finder_refresh` for
 * sessions established before the rebrand) is sent automatically by the browser.
 * Returns true if the session is now valid.
 *
 * Guarded by the session hint cookie — if that cookie is absent the user is
 * definitely logged out and there is no point hitting the network.
 *
 * Single-flight: refresh tokens are single-use (rotated by the backend), so
 * two concurrent refreshes replay the same cookie — the loser 401s and its
 * catch clears the session the winner just established, randomly logging
 * users out. Every caller (useAuth boot, the API client's 401 retry, any
 * component fetching at mount) must share one in-flight refresh.
 */
let _refreshInFlight: Promise<boolean> | null = null;

export function silentRefresh(): Promise<boolean> {
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = doSilentRefresh().finally(() => {
    _refreshInFlight = null;
  });
  return _refreshInFlight;
}

async function doSilentRefresh(): Promise<boolean> {
  if (!hasSessionHint()) return false;

  try {
    // Import lazily to avoid circular deps (client imports auth)
    const { apiPost } = await import("@/api-client/client");

    // Production uses the httpOnly cookie. MSW cannot create that cookie, so
    // dev mode and demo mode read the mock token stored by setSession instead.
    let mockRefreshToken: string | null = null;
    try {
      const isMockSession =
        process.env.NODE_ENV === "development" ||
        localStorage.getItem("ascend_demo") === "1";
      if (isMockSession) mockRefreshToken = sessionStorage.getItem(MOCK_REFRESH_KEY);
    } catch { /* localStorage blocked */ }
    const data = await apiPost<import("@/api-client/types").RefreshResponse>(
      "/api/identity/refresh",
      mockRefreshToken ? { refreshToken: mockRefreshToken } : {},
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
