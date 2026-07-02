"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStoreAuth } from "@/contexts/StoreAuthContext";

type Mode = "login" | "register";

export default function StoreLoginPage() {
  const router = useRouter();
  const { login, register } = useStoreAuth();

  const [mode, setMode]         = useState<Mode>("login");
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "register") {
      if (!name.trim())            { setError("Full name is required."); return; }
      if (password !== confirm)    { setError("Passwords do not match."); return; }
      if (password.length < 6)     { setError("Password must be at least 6 characters."); return; }
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
      router.replace("/store");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setSubmitting(false); }
  };

  const FLD = "w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-[#111] outline-none focus:border-[#5D5FEF] focus:ring-1 focus:ring-[#5D5FEF] transition-colors";

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">

        {/* Logo / title */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5D5FEF]">
            <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 01-8 0"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#111]">
            {mode === "login" ? "Sign in to shop" : "Create an account"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {mode === "login"
              ? "This is a private store — account required."
              : "Register to browse and purchase products."}
          </p>
        </div>

        {/* Demo hint */}
        {mode === "login" && (
          <div className="mb-5 rounded-xl border border-[#5D5FEF]/20 bg-[#5D5FEF]/5 px-4 py-3 text-xs text-[#5D5FEF]">
            <span className="font-semibold">Demo accounts:</span><br />
            alice@demo.com / demo1234<br />
            bob@demo.com / demo1234
          </div>
        )}

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
              {error}
            </p>
          )}

          {mode === "register" && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Full name</label>
              <input
                autoFocus
                className={FLD}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                required
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Email address</label>
            <input
              autoFocus={mode === "login"}
              className={FLD}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Password</label>
            <input
              className={FLD}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Confirm password</label>
              <input
                className={FLD}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 w-full rounded-xl bg-[#5D5FEF] py-2.5 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-50 transition-colors"
          >
            {submitting
              ? (mode === "login" ? "Signing in…" : "Creating account…")
              : (mode === "login" ? "Sign in" : "Create account")}
          </button>
        </form>

        {/* Toggle mode */}
        <p className="mt-5 text-center text-sm text-slate-400">
          {mode === "login" ? (
            <>Don&apos;t have an account?{" "}
              <button type="button" onClick={() => { setMode("register"); setError(null); }}
                className="font-semibold text-[#5D5FEF] hover:underline">
                Register
              </button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button type="button" onClick={() => { setMode("login"); setError(null); }}
                className="font-semibold text-[#5D5FEF] hover:underline">
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
