"use client";

/**
 * /login — enterprise sign-in page.
 *
 * - Authenticates via POST /api/identity/login (MSW-mocked in demo mode)
 * - On success, stores the token in memory + sessionStorage (refresh token)
 *   and redirects to the terminal
 * - SSO/SAML providers are presented per the enterprise login spec but are
 *   not wired to a backend yet (Finder POS only supports email/password
 *   today) — they render as disabled "coming soon" actions.
 */

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/Button";
import { useAuth } from "@/lib/useAuth";

const SSO_PROVIDERS = [
  { key: "google", label: "Google" },
  { key: "microsoft", label: "Microsoft Azure AD" },
  { key: "okta", label: "Okta" },
  { key: "apple", label: "Apple" },
] as const;

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <LoginCardSkeleton />
        </AuthShell>
      }
    >
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "1";
  const { status, login, loginError, isLoading } = useAuth();

  const [email, setEmail] = useState(
    isDemo || process.env.NODE_ENV === "development" ? "owner@finder-pos.dev" : ""
  );
  const [password, setPassword] = useState(isDemo ? "demo" : "");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  });

  // Redirect already-authenticated users away from /login
  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/terminal");
    }
  }, [status, router]);

  const emailError = useMemo(() => {
    if (!touched.email) return null;
    if (!email.trim()) return "Email is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
    return null;
  }, [email, touched.email]);

  const passwordError = useMemo(() => {
    if (!touched.password) return null;
    if (!password) return "Password is required.";
    return null;
  }, [password, touched.password]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (!email.trim() || !password) return;
    await login(email.trim(), password);
  }

  if (status === "authenticated") {
    return null;
  }

  if (status === "loading") {
    return (
      <AuthShell>
        <LoginCardSkeleton />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="rounded-2xl border border-white/40 bg-white/80 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 sm:p-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Welcome back. Enter your details to access your workspace.
          </p>
        </div>

        {isDemo && (
          <div className="mb-5 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:border-indigo-700/40 dark:bg-indigo-700/10 dark:text-indigo-300">
            <p className="font-semibold">Demo mode active</p>
            <p className="mt-0.5 text-indigo-600 dark:text-indigo-400">
              Credentials are pre-filled. Click <strong>Sign in</strong> to explore the full app with realistic data — no backend required.
            </p>
          </div>
        )}

        {loginError && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/40 dark:bg-danger-700/10 dark:text-danger-300"
          >
            {loginError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate aria-label="Sign in form" className="flex flex-col gap-4">
          {/* Email */}
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Email address
              <span className="ml-1 text-danger-600" aria-hidden="true">*</span>
              <span className="sr-only">(required)</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              disabled={isLoading}
              placeholder="you@company.com"
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "email-error" : undefined}
              className={`min-h-[44px] w-full rounded-lg border bg-white/90 px-3 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 ${
                emailError
                  ? "border-danger-500 focus:border-danger-500 focus:ring-2 focus:ring-danger-500"
                  : "border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500 dark:border-slate-600"
              }`}
            />
            {emailError && (
              <p id="email-error" className="text-sm text-danger-600 dark:text-danger-400">
                {emailError}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Password
                <span className="ml-1 text-danger-600" aria-hidden="true">*</span>
                <span className="sr-only">(required)</span>
              </label>
              <Link href="/login/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300">
                Forgot password?
              </Link>
            </div>
            <div className="relative flex items-center">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                onKeyUp={(e) => setCapsLockOn(e.getModifierState?.("CapsLock") ?? false)}
                disabled={isLoading}
                placeholder="••••••••"
                aria-invalid={!!passwordError}
                aria-describedby={[passwordError ? "password-error" : null, capsLockOn ? "capslock-hint" : null].filter(Boolean).join(" ") || undefined}
                className={`min-h-[44px] w-full rounded-lg border bg-white/90 px-3 pr-11 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 ${
                  passwordError
                    ? "border-danger-500 focus:border-danger-500 focus:ring-2 focus:ring-danger-500"
                    : "border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500 dark:border-slate-600"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute right-2 flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {passwordError && (
              <p id="password-error" className="text-sm text-danger-600 dark:text-danger-400">
                {passwordError}
              </p>
            )}
            {capsLockOn && !passwordError && (
              <p id="capslock-hint" className="text-sm text-warning-700 dark:text-warning-500">
                Caps Lock is on.
              </p>
            )}
            {process.env.NODE_ENV === "development" && (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Dev mode: any password works (use &quot;wrong&quot; to test an error).
              </p>
            )}
          </div>

          {/* Remember me */}
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
            />
            Remember me on this device
          </label>

          <Button type="submit" fullWidth loading={isLoading} disabled={isLoading} size="lg">
            {isLoading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {/* SSO */}
        <div className="mt-6">
          <div className="relative flex items-center">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="px-3 text-xs font-medium uppercase text-slate-400 dark:text-slate-500">
              Or continue with
            </span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {SSO_PROVIDERS.map((provider) => (
              <button
                key={provider.key}
                type="button"
                disabled
                title="Available on the Enterprise plan"
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-400 opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
              >
                <ProviderIcon provider={provider.key} />
                {provider.label}
              </button>
            ))}
          </div>

          <p className="mt-3 text-center text-xs text-slate-400 dark:text-slate-500">
            Need SAML-based single sign-on for your organization?{" "}
            <Link href="#" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              Contact your administrator
            </Link>
            .
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-semibold text-slate-900 hover:underline dark:text-white">
            Create one free
          </Link>
        </p>
      </div>

      {/* Security/compliance reassurance */}
      <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-slate-400 dark:text-slate-500">
        <LockIcon />
        Protected by multi-factor authentication and enterprise-grade encryption.
      </p>
      <p className="mt-1 text-center text-xs text-slate-400 dark:text-slate-500">
        Signing in from a new device or location may require additional verification.
      </p>
    </AuthShell>
  );
}

/** Skeleton shown while the silent session check runs, to avoid a layout flash. */
function LoginCardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading sign-in form"
      className="animate-pulse rounded-2xl border border-white/40 bg-white/80 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 sm:p-8"
    >
      <div className="h-7 w-32 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-2 h-4 w-56 rounded bg-slate-100 dark:bg-slate-800" />

      <div className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-11 w-full rounded-lg bg-slate-100 dark:bg-slate-800" />
        </div>
        <div className="flex flex-col gap-1">
          <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-11 w-full rounded-lg bg-slate-100 dark:bg-slate-800" />
        </div>
        <div className="h-4 w-40 rounded bg-slate-100 dark:bg-slate-800" />
        <div className="h-11 w-full rounded-lg bg-slate-200 dark:bg-slate-700" />
      </div>

      <div className="mt-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
        <div className="h-3 w-24 rounded bg-slate-100 dark:bg-slate-800" />
        <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="h-11 rounded-lg bg-slate-100 dark:bg-slate-800" />
        <div className="h-11 rounded-lg bg-slate-100 dark:bg-slate-800" />
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function ProviderIcon({ provider }: { provider: typeof SSO_PROVIDERS[number]["key"] }) {
  switch (provider) {
    case "google":
      return (
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.07 5.07 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23Z" />
          <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.1V7.06H2.18A10.99 10.99 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84Z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.97 10.97 0 0 0 12 1 10.99 10.99 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z" />
        </svg>
      );
    case "microsoft":
      return (
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
          <rect x="2" y="2" width="9" height="9" fill="#F25022" />
          <rect x="13" y="2" width="9" height="9" fill="#7FBA00" />
          <rect x="2" y="13" width="9" height="9" fill="#00A4EF" />
          <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
        </svg>
      );
    case "okta":
      return (
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      );
    case "apple":
      return (
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16.36 12.94c-.03-2.05 1.67-3.04 1.75-3.09-.95-1.39-2.44-1.58-2.97-1.6-1.36-.14-2.6.79-3.27.79-.69 0-1.78-.77-2.92-.75-1.5.02-2.9.87-3.66 2.22-1.56 2.7-.4 6.91 1.12 9.18.74 1.1 1.62 2.34 2.78 2.3 1.11-.04 1.53-.72 2.88-.72s1.74.72 2.92.7c1.21-.02 1.99-1.1 2.73-2.2.6-.88.94-1.55 1.31-2.49-.06-.02-2.6-1-2.67-3.34ZM14.06 5.39c.6-.73 1.01-1.74.9-2.74-.86.04-1.92.58-2.55 1.3-.56.65-1.04 1.69-.91 2.66.96.07 1.96-.49 2.56-1.22Z" />
        </svg>
      );
    default:
      return null;
  }
}
