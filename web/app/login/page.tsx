"use client";

/**
 * /login — POS terminal login page.
 *
 * - Calls POST /api/v1/auth/login (mocked by MSW in dev)
 * - On success, stores the token in memory + sessionStorage (refresh token)
 *   and redirects to the terminal
 * - Accessible: labels, error announcements, loading state
 */

import { useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { useAuth } from "@/lib/useAuth";

export default function LoginPage() {
  const router = useRouter();
  const { status, login, loginError, isLoading } = useAuth();

  // Redirect already-authenticated users away from /login
  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/terminal");
    }
  }, [status, router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = (data.get("email") as string).trim();
    const password = data.get("password") as string;
    await login(email, password);
  }

  // While we're checking session / redirecting, show nothing to avoid flash
  if (status === "loading" || status === "authenticated") {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12">
      {/* Brand header */}
      <div className="mb-8 text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white shadow"
        >
          F
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Finder POS</h1>
        <p className="mt-1 text-sm text-gray-500">
          Sign in to open the terminal
        </p>
      </div>

      {/* Login card */}
      <Card className="w-full max-w-sm">
        <form
          onSubmit={handleSubmit}
          noValidate
          aria-label="Sign in form"
          className="flex flex-col gap-5"
        >
          {/* Server-side / API error */}
          {loginError && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-md bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700"
            >
              {loginError}
            </div>
          )}

          <Input
            name="email"
            type="email"
            label="Email address"
            autoComplete="email"
            required
            placeholder="cashier@example.com"
            disabled={isLoading}
            // In dev, pre-fill with the MSW mock user
            defaultValue={
              process.env.NODE_ENV === "development"
                ? "cashier@finder-pos.dev"
                : undefined
            }
          />

          <Input
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            disabled={isLoading}
            hint={
              process.env.NODE_ENV === "development"
                ? 'Dev mode: any password works (use "wrong" to test error)'
                : undefined
            }
          />

          <Button
            type="submit"
            fullWidth
            loading={isLoading}
            disabled={isLoading}
            size="lg"
          >
            {isLoading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>

      {/* Footer */}
      <p className="mt-8 text-xs text-gray-400">
        &copy; {new Date().getFullYear()} Finder &mdash; POS Terminal
      </p>
    </div>
  );
}
