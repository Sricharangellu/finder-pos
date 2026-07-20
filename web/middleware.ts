import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Security middleware — enforces auth and adds HTTP security headers.
 *
 * Auth: reads the non-httpOnly session-hint cookie set by the backend
 * on login/refresh. If absent on a protected route, redirect to /login.
 * The actual refresh token lives in an httpOnly cookie — unreadable by
 * JavaScript, sent automatically by the browser to /refresh.
 *
 * Dual-read (rebrand Phase 1, step 2): the backend is dual-writing both
 * `ascend_session_hint` (new) and `finder_session_hint` (old) — see
 * WORK/FUNCTIONAL_REBRAND_PLAN.md. Prefer the new name, fall back to the old
 * one so existing sessions that only have the old cookie keep working.
 */

const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/_next",
  "/favicon",
  "/icons",
  "/api",
  "/mockServiceWorker.js",
  // next.config.mjs rewrites these to the backend too (health probes used by
  // uptime monitors and deploy smoke tests) — without this, the auth gate
  // intercepts them before the rewrite ever runs, redirecting probes to
  // /login instead of proxying to the backend.
  "/healthz",
  "/readyz",
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Allow public paths and API routes through without auth check.
  const isPublic = pathname === "/" || PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isPublic) {
    const sessionHint =
      request.cookies.get("ascend_session_hint")?.value ??
      request.cookies.get("finder_session_hint")?.value;
    if (!sessionHint) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  const response = NextResponse.next();

  // Force HTTPS for 1 year; apply to all subdomains
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Prevent embedding in iframes (clickjacking protection)
  response.headers.set("X-Frame-Options", "DENY");
  // Prevent MIME-type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");
  // Restrict referrer info sent cross-origin
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Disable browser features not needed by a POS UI
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self)",
  );
  // Strict CSP: scripts/styles from self only; images allow data URIs for barcodes;
  // connect-src allows the backend API origin via NEXT_PUBLIC_API_BASE_URL.
  const apiOrigin = process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "";
  const connectSrc = apiOrigin ? `'self' ${apiOrigin}` : "'self'";
  const scriptSrc = process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      `connect-src ${connectSrc}`,
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );

  return response;
}

export const config = {
  // Apply to all page routes; skip static assets and Next.js internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"],
};
