import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Security middleware — adds HTTP security headers to all page responses.
 *
 * Auth enforcement note: the access token lives in-memory only (XSS-safe) and
 * the refresh token in sessionStorage. Because neither is in a cookie, the edge
 * middleware cannot verify auth. The client-side useAuth() hook in EnterpriseShell
 * handles the redirect-to-login flow.
 *
 * When the auth architecture moves to httpOnly cookies, add the enforcement block:
 *   const token = request.cookies.get("access_token")?.value;
 *   if (!token && request.nextUrl.pathname.startsWith("/(protected)")) {
 *     return NextResponse.redirect(new URL("/login", request.url));
 *   }
 */
export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();

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
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // Next.js requires unsafe-inline for hydration
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
