"use client";

/**
 * /signup — create a new FinderPOS account.
 * Calls POST /api/identity/register → issues JWT → redirects to /terminal.
 */

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/Button";
import { setSession } from "@/lib/auth";

interface RegisterResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string; role: string; tenantId: string };
}

function Field({
  id, label, type = "text", value, onChange, onBlur, error, placeholder, autoComplete, required,
}: {
  id: string; label: string; type?: string; value: string;
  onChange: (v: string) => void; onBlur?: () => void; error?: string | null;
  placeholder?: string; autoComplete?: string; required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className={`w-full rounded-md border px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600 transition-colors ${
          error ? "border-red-400 bg-red-50" : "border-slate-300 bg-white hover:border-slate-400"
        }`}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState({ storeName: false, email: false, password: false, confirmPassword: false });

  const storeNameError = useMemo(() => {
    if (!touched.storeName) return null;
    if (!storeName.trim()) return "Store name is required.";
    if (storeName.trim().length < 2) return "Store name must be at least 2 characters.";
    return null;
  }, [storeName, touched.storeName]);

  const emailError = useMemo(() => {
    if (!touched.email) return null;
    if (!email.trim()) return "Email is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
    return null;
  }, [email, touched.email]);

  const passwordError = useMemo(() => {
    if (!touched.password) return null;
    if (!password) return "Password is required.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    return null;
  }, [password, touched.password]);

  const confirmPasswordError = useMemo(() => {
    if (!touched.confirmPassword) return null;
    if (password !== confirmPassword) return "Passwords do not match.";
    return null;
  }, [password, confirmPassword, touched.confirmPassword]);

  const hasErrors = !!(storeNameError || emailError || passwordError || confirmPasswordError);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched({ storeName: true, email: true, password: true, confirmPassword: true });
    if (!storeName.trim() || !email.trim() || !password || password !== confirmPassword) return;
    if (password.length < 8) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/identity/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: storeName.trim(), email: email.trim(), password }),
      });
      const data = (await res.json()) as RegisterResponse & { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? `Registration failed (${res.status})`);
      setSession(data.accessToken, data.expiresIn, data.refreshToken, data.user);
      router.replace("/terminal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="w-full max-w-md mx-auto">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-slate-950 text-white text-2xl font-bold mb-4">F</div>
          <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500">Set up your store in under a minute.</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
            <Field
              id="storeName" label="Store name" value={storeName}
              onChange={setStoreName} error={storeNameError}
              placeholder="e.g. Blue Sky Retail" autoComplete="organization" required
              onBlur={() => setTouched(t => ({ ...t, storeName: true }))}
            />
            <Field
              id="email" label="Email" type="email" value={email}
              onChange={setEmail} error={emailError}
              placeholder="you@example.com" autoComplete="email" required
              onBlur={() => setTouched(t => ({ ...t, email: true }))}
            />
            <Field
              id="password" label="Password" type="password" value={password}
              onChange={setPassword} error={passwordError}
              placeholder="8+ characters" autoComplete="new-password" required
              onBlur={() => setTouched(t => ({ ...t, password: true }))}
            />
            <Field
              id="confirmPassword" label="Confirm password" type="password" value={confirmPassword}
              onChange={setConfirmPassword} error={confirmPasswordError}
              placeholder="Re-enter your password" autoComplete="new-password" required
              onBlur={() => setTouched(t => ({ ...t, confirmPassword: true }))}
            />

            {error && (
              <div role="alert" className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={loading || (Object.values(touched).some(Boolean) && hasErrors)}>
              {loading ? "Creating account…" : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-500">
            By creating an account you agree to our{" "}
            <span className="font-medium text-slate-700">Terms of Service</span> and{" "}
            <span className="font-medium text-slate-700">Privacy Policy</span>.
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-slate-900 hover:underline">Sign in</Link>
        </p>
      </div>
    </AuthShell>
  );
}
