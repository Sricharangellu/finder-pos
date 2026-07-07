"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPost } from "@/api-client/client";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";

interface MfaStatus {
  enabled: boolean;
  setupRequired: boolean;
}

interface MfaSetupData {
  secret: string;
  otpauthUrl: string;
}

type BackupCodesState = "idle" | "revealed" | "hidden";

interface MfaVerifyResponse {
  ok: boolean;
  message: string;
  backupCodes: string[];
}

function BackupCodesCard({ codes }: { codes: string[] }) {
  const [codesState, setCodesState] = useState<BackupCodesState>("idle");
  const { addToast } = useToast();

  useEffect(() => {
    setCodesState(codes.length > 0 ? "revealed" : "idle");
  }, [codes]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      addToast({ title: "Backup codes copied", variant: "success" });
    } catch {
      addToast({ title: "Could not copy", description: "Copy the codes manually.", variant: "error" });
    }
  };

  const download = () => {
    const blob = new Blob([codes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "finderpos-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Backup codes</h2>
          <p className="text-sm text-slate-500">Generate one-time recovery codes in case you lose access to your authenticator app.</p>
        </div>
        {codesState !== "idle" && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            {codes.length} codes remaining
          </span>
        )}
      </div>

      {codesState === "idle" && (
        <p className="text-sm text-slate-500">
          New backup codes are generated when MFA is enabled. Save them before leaving this page.
        </p>
      )}

      {codesState === "revealed" && (
        <>
          <p className="text-sm text-slate-500">Save these somewhere safe. Each code can only be used once.</p>
          <div className="grid grid-cols-4 gap-2 rounded-md border border-slate-200 bg-slate-50 p-4">
            {codes.map((c) => (
              <span key={c} className="font-mono text-sm font-semibold tracking-wider text-slate-950 select-all">
                {c}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void copyAll()}>Copy all</Button>
            <Button variant="secondary" size="sm" onClick={download}>Download .txt</Button>
            <Button variant="ghost" size="sm" onClick={() => setCodesState("hidden")}>Hide codes</Button>
          </div>
        </>
      )}

      {codesState === "hidden" && (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm text-slate-600">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            {codes.length} codes remaining
          </span>
          <Button variant="secondary" size="sm" onClick={() => setCodesState("revealed")}>Show codes</Button>
        </div>
      )}
    </Card>
  );
}

function SecurityRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <span className="text-slate-600">{label}</span>
      <span className={`font-semibold ${ok ? "text-emerald-700" : "text-slate-500"}`}>{value}</span>
    </div>
  );
}

export function SecuritySection() {
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const { addToast } = useToast();

  useEffect(() => {
    apiGet<MfaStatus>("/api/identity/mfa/status")
      .then(setMfaStatus)
      .catch(() => setStatusError("Failed to load MFA status."));
  }, []);

  const startSetup = async () => {
    setBusy(true);
    try {
      const data = await apiPost<MfaSetupData>("/api/identity/mfa/setup", {});
      setSetupData(data);
    } catch (e) {
      addToast({ title: "Setup failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const verifyAndEnable = async () => {
    if (!verifyCode.trim()) return;
    setBusy(true);
    try {
      const result = await apiPost<MfaVerifyResponse>("/api/identity/mfa/verify", { code: verifyCode.trim() });
      setMfaStatus({ enabled: true, setupRequired: false });
      setSetupData(null);
      setVerifyCode("");
      setBackupCodes(result.backupCodes);
      addToast({ title: "MFA enabled", description: "Your account is now protected with MFA.", variant: "success" });
    } catch (e) {
      addToast({ title: "Verification failed", description: e instanceof Error ? e.message : "Invalid code", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const disableMfa = async () => {
    setBusy(true);
    setConfirmDisable(false);
    try {
      await apiPost("/api/identity/mfa/disable", {});
      setMfaStatus({ enabled: false, setupRequired: false });
      setBackupCodes([]);
      addToast({ title: "MFA disabled", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed to disable MFA", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <ConfirmDialog
        open={confirmDisable}
        title="Disable MFA"
        message="Are you sure you want to disable multi-factor authentication? Your account will be less secure."
        confirmLabel="Disable MFA"
        destructive
        onConfirm={() => void disableMfa()}
        onCancel={() => setConfirmDisable(false)}
      />

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Multi-factor authentication</h2>
            <p className="text-sm text-slate-500">Add an extra layer of sign-in security to your account.</p>
          </div>
          {mfaStatus?.enabled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              MFA is active
            </span>
          ) : (
            <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Not enabled</span>
          )}
        </div>

        {statusError && (
          <p className="text-sm text-red-600">{statusError}</p>
        )}

        {mfaStatus === null && !statusError && (
          <div className="flex items-center gap-2" role="status" aria-label="Loading MFA status">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            <p className="text-sm text-[var(--color-text-secondary)]">Loading MFA status…</p>
          </div>
        )}

        {mfaStatus !== null && !mfaStatus.enabled && !setupData && (
          <Button variant="primary" size="sm" loading={busy} onClick={() => void startSetup()}>
            Enable MFA
          </Button>
        )}

        {setupData && (
          <div className="flex flex-col gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-700">
              Enter this code in your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code below to confirm.
            </p>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Manual entry secret</p>
              <code className="block rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm tracking-widest text-slate-950 select-all">
                {setupData.secret}
              </code>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase text-slate-500">
                6-digit verification code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono tracking-widest outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                />
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  disabled={verifyCode.length !== 6}
                  onClick={() => void verifyAndEnable()}
                >
                  Verify &amp; Enable
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setSetupData(null); setVerifyCode(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {mfaStatus?.enabled && (
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={() => setConfirmDisable(true)}
            >
              Disable MFA
            </Button>
          </div>
        )}
      </Card>

      <BackupCodesCard codes={backupCodes} />

      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-950">Security posture</h2>
        <div className="flex flex-col gap-2 text-sm">
          <SecurityRow label="Role-based access" value="Enabled" ok />
          <SecurityRow label="Access token TTL" value="15 minutes" ok />
          <SecurityRow label="MFA" value={mfaStatus?.enabled ? "Enabled" : "Not enabled"} ok={mfaStatus?.enabled} />
          <SecurityRow label="Refresh token rotation" value="Planned (BE-2)" />
          <SecurityRow label="Rate limiting" value="In-memory (DB-2 pending)" />
          <SecurityRow label="Row-level security" value="Planned (DB-1)" />
          <SecurityRow label="Audit log" value="Backend-owned" ok />
        </div>
      </Card>
    </div>
  );
}
