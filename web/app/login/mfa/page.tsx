"use client";

/**
 * /login/mfa — multi-factor authentication verification screen.
 *
 * Ascend's auth backend does not issue an MFA challenge yet (login
 * succeeds directly from email/password). This screen is built ahead of
 * that backend work so the UI is ready: it renders the verification UI
 * against a mocked 6-digit code ("123456" always succeeds) and is not yet
 * linked to from the live login flow.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/Button";

const CODE_LENGTH = 6;
const MOCK_VALID_CODE = "123456";
const MOCK_VALID_BACKUP_CODE = "ABCD-1234";
const RESEND_SECONDS = 30;
const SUCCESS_REDIRECT_DELAY_MS = 900;

const MOCK_DEVICE = {
  recognized: true,
  browser: "Chrome on macOS",
  location: "Dallas, TX, US",
};

type MfaMethod = "authenticator" | "email" | "backup";

const METHODS: { key: MfaMethod; label: string }[] = [
  { key: "authenticator", label: "Authenticator app" },
  { key: "email", label: "Email code" },
  { key: "backup", label: "Backup code" },
];

export default function MfaPage() {
  const router = useRouter();
  const [method, setMethod] = useState<MfaMethod>("authenticator");
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [backupCode, setBackupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const [expired, setExpired] = useState(false);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendIn <= 0) {
      if (method === "email") setExpired(true);
      return;
    }
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn, method]);

  const code = digits.join("");

  function setDigit(index: number, value: string) {
    const char = value.replace(/\D/g, "").slice(-1);
    setDigits((current) => {
      const next = [...current];
      next[index] = char;
      return next;
    });
    if (char && index < CODE_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!pasted) return;
    e.preventDefault();
    setDigits((current) => {
      const next = [...current];
      for (let i = 0; i < CODE_LENGTH; i++) next[i] = pasted[i] ?? "";
      return next;
    });
    inputsRef.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  }

  function switchMethod(next: MfaMethod) {
    setMethod(next);
    setError(null);
    setDigits(Array(CODE_LENGTH).fill(""));
    setBackupCode("");
    setExpired(false);
    setResendIn(RESEND_SECONDS);
  }

  async function handleVerify() {
    if (method === "backup") {
      if (!backupCode.trim()) {
        setError("Enter one of your backup codes.");
        return;
      }
      setVerifying(true);
      setError(null);
      // Mocked: no backend MFA-verify endpoint exists yet.
      await new Promise((resolve) => setTimeout(resolve, 500));
      setVerifying(false);
      if (backupCode.trim().toUpperCase() === MOCK_VALID_BACKUP_CODE) {
        setSuccess(true);
        await new Promise((resolve) => setTimeout(resolve, SUCCESS_REDIRECT_DELAY_MS));
        router.replace("/terminal");
      } else {
        setError("That backup code didn't work. Each code can only be used once.");
        setBackupCode("");
      }
      return;
    }

    if (code.length !== CODE_LENGTH) {
      setError(
        method === "email"
          ? "Enter the 6-digit code we emailed you."
          : "Enter the 6-digit code from your authenticator app."
      );
      return;
    }
    setVerifying(true);
    setError(null);
    // Mocked: no backend MFA-verify endpoint exists yet.
    await new Promise((resolve) => setTimeout(resolve, 500));
    setVerifying(false);
    if (code === MOCK_VALID_CODE) {
      setSuccess(true);
      await new Promise((resolve) => setTimeout(resolve, SUCCESS_REDIRECT_DELAY_MS));
      router.replace("/terminal");
    } else {
      setError("That code didn't work. Check the app and try again.");
      setDigits(Array(CODE_LENGTH).fill(""));
      inputsRef.current[0]?.focus();
    }
  }

  if (success) {
    return (
      <AuthShell>
        <div className="rounded-2xl border border-white/40 bg-white/80 p-6 text-center shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-100 text-success-700 dark:bg-success-700/20 dark:text-success-400">
            <CheckIcon />
          </div>
          <h2 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">Verification successful</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Redirecting to your dashboard…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="rounded-2xl border border-white/40 bg-white/80 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/70 sm:p-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Two-factor verification</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {method === "authenticator" && "Enter the 6-digit code from your authenticator app to continue."}
            {method === "email" && "Enter the 6-digit code we emailed to your account."}
            {method === "backup" && "Enter one of the backup codes you saved when you set up MFA."}
          </p>
        </div>

        {MOCK_DEVICE.recognized && (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-800 dark:border-success-700/40 dark:bg-success-700/10 dark:text-success-300">
            <span aria-hidden="true">✓</span>
            <span>
              Device recognized — {MOCK_DEVICE.browser} · {MOCK_DEVICE.location}
            </span>
          </div>
        )}

        <div role="tablist" aria-label="Verification method" className="mb-5 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={method === m.key}
              disabled={verifying}
              onClick={() => switchMethod(m.key)}
              className={`min-h-[36px] rounded-md px-2 text-xs font-medium transition-colors sm:text-sm ${
                method === m.key
                  ? "bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-brand-400"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {error && (
          <div role="alert" aria-live="assertive" className="mb-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700/40 dark:bg-danger-700/10 dark:text-danger-300">
            {error}
          </div>
        )}

        {method === "backup" ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="backupCode" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Backup code
            </label>
            <input
              id="backupCode"
              type="text"
              autoFocus
              autoComplete="one-time-code"
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value)}
              disabled={verifying}
              placeholder="XXXX-XXXX"
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white/90 px-3 text-center font-mono text-lg tracking-widest text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Each backup code can only be used once. Generate new codes from Settings after signing in.
            </p>
          </div>
        ) : method === "email" && expired ? (
          <div role="alert" aria-live="assertive" className="rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800 dark:border-warning-700/40 dark:bg-warning-700/10 dark:text-warning-300">
            Code expired. Request a new code to continue.
          </div>
        ) : (
          <fieldset>
            <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">Verification code</legend>
            <div className="mt-2 flex justify-between gap-2">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputsRef.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => setDigit(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={handlePaste}
                  disabled={verifying}
                  aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
                  className="h-12 w-12 rounded-lg border border-slate-300 bg-white/90 text-center text-lg font-semibold text-slate-900 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800/80 dark:text-white sm:h-14 sm:w-14"
                />
              ))}
            </div>
          </fieldset>
        )}

        {!(method === "email" && expired) && (
          <Button type="button" fullWidth loading={verifying} disabled={verifying} size="lg" className="mt-6" onClick={() => void handleVerify()}>
            {verifying ? "Verifying…" : "Verify and continue"}
          </Button>
        )}

        {method === "email" && (
          <div className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
            {resendIn > 0 ? (
              <span>Resend code in {resendIn}s</span>
            ) : (
              <button
                type="button"
                onClick={() => { setResendIn(RESEND_SECONDS); setExpired(false); }}
                className="font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Resend code
              </button>
            )}
          </div>
        )}

        {process.env.NODE_ENV === "development" && (
          <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-500">
            {method === "backup"
              ? <>Dev mode: use code <span className="font-mono">ABCD-1234</span>.</>
              : <>Dev mode: use code <span className="font-mono">123456</span>.</>}
          </p>
        )}

        <Link href="/login" className="mt-6 block text-center text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
          &larr; Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
