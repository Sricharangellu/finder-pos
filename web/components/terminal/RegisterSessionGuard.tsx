"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/Button";

interface Session {
  id: string;
  register_id: string;
  status: "open" | "closed";
  opening_float_cents: number;
  opened_at: number;
  opened_by: string;
}

interface RegisterSessionGuardProps {
  registerId: string;
  children: React.ReactNode;
}

export function RegisterSessionGuard({ registerId, children }: RegisterSessionGuardProps) {
  const [session, setSession] = useState<Session | null | "loading">("loading");
  const [openFloat, setOpenFloat] = useState("");
  const [closeFloat, setCloseFloat] = useState("");
  const [closeCounted, setCloseCounted] = useState("");
  const [showClose, setShowClose] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expectedData, setExpectedData] = useState<{ openingFloatCents: number; cashSalesCents: number; expectedCashCents: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ items: Session[] }>(`/api/v1/outlets/registers/${registerId}/sessions?limit=1`);
      const latest = res.items[0];
      setSession(latest?.status === "open" ? latest : null);
    } catch {
      setSession(null);
    }
  }, [registerId]);

  const loadExpected = useCallback(async () => {
    try {
      const data = await apiGet<{ openingFloatCents: number; cashSalesCents: number; expectedCashCents: number }>(
        `/api/v1/outlets/registers/${registerId}/expected-cash`
      );
      setExpectedData(data);
    } catch {
      setExpectedData(null);
    }
  }, [registerId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (showClose) {
      void loadExpected();
    }
  }, [showClose, loadExpected]);

  const handleOpen = async () => {
    setWorking(true); setError(null);
    try {
      const floatCents = Math.round(parseFloat(openFloat || "0") * 100);
      const s = await apiPost<Session>(`/api/v1/outlets/registers/${registerId}/open`, { openingFloatCents: floatCents });
      setSession(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to open register");
    } finally { setWorking(false); }
  };

  const handleClose = async () => {
    if (!session || session === "loading") return;
    setWorking(true); setError(null);
    try {
      const countedCents = Math.round(parseFloat(closeCounted || "0") * 100);
      const closingCents = Math.round(parseFloat(closeFloat || "0") * 100);
      await apiPost(`/api/v1/outlets/registers/${registerId}/close`, { countedCashCents: countedCents, closingFloatCents: closingCents });
      setSession(null); setShowClose(false);
      setExpectedData(null);
      setCloseCounted("");
      setCloseFloat("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to close register");
    } finally { setWorking(false); }
  };

  if (session === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-slate-50 p-8">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-600" aria-hidden="true">
                <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Open Register</h2>
              <p className="text-xs text-gray-500">Count your opening cash float</p>
            </div>
          </div>
          {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Opening Float ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openFloat}
                onChange={e => setOpenFloat(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <Button variant="primary" fullWidth loading={working} onClick={() => void handleOpen()}>
              Open Register
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Calculate real-time variance
  const expectedCents = expectedData?.expectedCashCents ?? 0;
  const countedCents = closeCounted ? Math.round(parseFloat(closeCounted) * 100) : 0;
  const varianceCents = countedCents - expectedCents;

  return (
    <div className="flex h-full flex-col">
      {/* Close register banner */}
      {showClose && (
        <div className="flex-none border-b border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-900">Close Register & Count Cash</p>
              {expectedData && (
                <div className="text-xs text-amber-800 space-y-0.5">
                  <p>Opening float: <span className="font-medium">{formatMoney(expectedData.openingFloatCents)}</span></p>
                  <p>Cash sales: <span className="font-medium">{formatMoney(expectedData.cashSalesCents)}</span></p>
                  <p className="font-semibold">Expected cash in drawer: {formatMoney(expectedData.expectedCashCents)}</p>
                </div>
              )}
            </div>

            {/* Variance summary badge */}
            {expectedData && (
              <div className="rounded-lg border border-amber-200 bg-white px-4 py-2 text-center shadow-sm">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Variance</span>
                <span className={`text-base font-bold ${varianceCents === 0 ? "text-green-600" : varianceCents > 0 ? "text-green-700" : "text-red-600"}`}>
                  {varianceCents === 0 ? "$0.00" : varianceCents > 0 ? `+${formatMoney(varianceCents)}` : `-${formatMoney(Math.abs(varianceCents))}`}
                </span>
              </div>
            )}
          </div>

          {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

          <div className="mt-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-amber-800 mb-1">Counted Cash ($) <span className="text-red-500">*</span></label>
              <input type="number" min="0" step="0.01" value={closeCounted} onChange={e => setCloseCounted(e.target.value)}
                placeholder="0.00" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm w-36 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-800 mb-1">Next Opening Float ($)</label>
              <input type="number" min="0" step="0.01" value={closeFloat} onChange={e => setCloseFloat(e.target.value)}
                placeholder="0.00" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm w-36 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" loading={working} disabled={!closeCounted} onClick={() => void handleClose()}>Confirm Close</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowClose(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
      {!showClose && (
        <div className="flex-none border-b border-gray-200 bg-white px-4 py-2 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            Register open · Float: {formatMoney(session.opening_float_cents)}
          </span>
          <button onClick={() => setShowClose(true)} className="text-xs text-gray-400 hover:text-gray-600 underline">
            Close register
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

