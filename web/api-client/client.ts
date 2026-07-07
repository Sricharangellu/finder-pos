/**
 * Typed fetch wrapper — attaches the bearer token, parses the
 * { error: { code, message, requestId } } envelope, and surfaces typed errors.
 *
 * 401 handling: on a 401 from an authenticated request, we attempt one silent
 * token refresh. If the refresh succeeds the original request is retried
 * transparently. If it fails the session is cleared and the user is sent to
 * /login.
 */

import type { ApiError } from "./types";
import { getAccessToken } from "@/lib/auth";

// ─── API Error class ──────────────────────────────────────────────────────────

export class ApiResponseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId: string,
    public readonly status: number,
    public readonly payload?: unknown
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

function resolveBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  if (typeof window !== "undefined") return configured;
  if (configured.startsWith("http")) return configured;
  return `http://localhost${configured}`;
}

const API_BASE = resolveBase();

// Prevent multiple concurrent refresh attempts.
let _refreshPromise: Promise<boolean> | null = null;

// ─── Core fetch helper ────────────────────────────────────────────────────────

export interface FetchOptions<TBody = unknown> {
  body?: TBody;
  /** Additional headers; Authorization is set automatically. */
  headers?: Record<string, string>;
  /** If true, skip attaching the bearer token (used for login/reset flows). */
  anonymous?: boolean;
  signal?: AbortSignal;
  /** Internal — set to true on the one automatic retry after a token refresh. */
  _retry?: boolean;
}

/**
 * Makes an authenticated request to the POS API.
 * Throws `ApiResponseError` for any non-2xx response.
 */
export async function apiFetch<TResponse>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: FetchOptions = {}
): Promise<TResponse> {
  const { body, headers = {}, anonymous = false, signal, _retry = false } = options;

  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...headers,
  };

  if (!anonymous) {
    const token = getAccessToken();
    if (token) {
      reqHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  // 401 on an authenticated request — try a silent token refresh once.
  if (response.status === 401 && !anonymous && !_retry) {
    if (!_refreshPromise) {
      _refreshPromise = import("@/lib/auth")
        .then(({ silentRefresh }) => silentRefresh())
        .finally(() => { _refreshPromise = null; });
    }
    const refreshed = await _refreshPromise;
    if (refreshed) {
      return apiFetch<TResponse>(method, path, { ...options, _retry: true });
    }
    // Refresh failed — clear session and redirect to login.
    await import("@/lib/auth").then(({ clearSession }) => clearSession());
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    // Throw so any in-flight awaits don't silently continue.
    throw new ApiResponseError("unauthenticated", "Session expired. Please sign in again.", "", 401);
  }

  // 204 No Content — no body to parse
  if (response.status === 204) {
    return undefined as unknown as TResponse;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiResponseError(
      "PARSE_ERROR",
      `Failed to parse response from ${method} ${path}`,
      "",
      response.status
    );
  }

  if (!response.ok) {
    const envelope = json as Partial<ApiError>;
    const err = envelope?.error;
    throw new ApiResponseError(
      err?.code ?? "UNKNOWN_ERROR",
      err?.message ?? `HTTP ${response.status}`,
      err?.requestId ?? "",
      response.status,
      json
    );
  }

  return json as TResponse;
}

/**
 * Downloads a non-JSON API response while preserving the same auth and one-time
 * 401 refresh behavior as apiFetch.
 */
export async function apiDownload(
  path: string,
  options: Omit<FetchOptions, "body"> = {}
): Promise<Blob> {
  const { headers = {}, anonymous = false, signal, _retry = false } = options;

  const reqHeaders: Record<string, string> = {
    Accept: "text/csv,application/octet-stream,*/*",
    ...headers,
  };

  if (!anonymous) {
    const token = getAccessToken();
    if (token) {
      reqHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: "GET",
    headers: reqHeaders,
    signal,
  });

  if (response.status === 401 && !anonymous && !_retry) {
    if (!_refreshPromise) {
      _refreshPromise = import("@/lib/auth")
        .then(({ silentRefresh }) => silentRefresh())
        .finally(() => { _refreshPromise = null; });
    }
    const refreshed = await _refreshPromise;
    if (refreshed) {
      return apiDownload(path, { ...options, _retry: true });
    }
    await import("@/lib/auth").then(({ clearSession }) => clearSession());
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new ApiResponseError("unauthenticated", "Session expired. Please sign in again.", "", 401);
  }

  if (!response.ok) {
    let code = "UNKNOWN_ERROR";
    let message = `HTTP ${response.status}`;
    let requestId = "";
    try {
      const envelope = (await response.json()) as Partial<ApiError>;
      code = envelope.error?.code ?? code;
      message = envelope.error?.message ?? message;
      requestId = envelope.error?.requestId ?? requestId;
    } catch {
      // Non-JSON download errors still surface with status and method context.
    }
    throw new ApiResponseError(code, message, requestId, response.status);
  }

  return response.blob();
}

// ─── Convenience shorthands ──────────────────────────────────────────────────

export const apiGet = <T>(path: string, opts?: FetchOptions) =>
  apiFetch<T>("GET", path, opts);

export const apiPost = <T>(
  path: string,
  body?: unknown,
  opts?: FetchOptions
) => apiFetch<T>("POST", path, { ...opts, body });

export const apiPut = <T>(
  path: string,
  body?: unknown,
  opts?: FetchOptions
) => apiFetch<T>("PUT", path, { ...opts, body });

export const apiPatch = <T>(
  path: string,
  body?: unknown,
  opts?: FetchOptions
) => apiFetch<T>("PATCH", path, { ...opts, body });

export const apiDelete = <T>(path: string, opts?: FetchOptions) =>
  apiFetch<T>("DELETE", path, opts);

/**
 * PROD-16: safeLoad — wraps a data-fetch promise so rejected promises are
 * caught and reported rather than becoming unhandled rejections.
 *
 * Usage:
 *   safeLoad(apiGet<Items>("/api/v1/things").then((r) => setItems(r.items)));
 *
 * The global unhandledrejection handler (ErrorMonitor in layout.tsx) is the
 * primary safety net. safeLoad is belt-and-suspenders for pages that want
 * explicit error handling without boilerplate try/catch.
 *
 * @param promise - Any promise, typically an api call chain ending with .then()
 * @param onError - Optional callback; receives the error for local UI state
 */
export function safeLoad<T>(
  promise: Promise<T>,
  onError?: (err: unknown) => void,
): void {
  promise.catch((err) => {
    if (onError) {
      onError(err);
    } else if (process.env.NODE_ENV !== "production") {
      console.error("[safeLoad]", err);
    }
  });
}
