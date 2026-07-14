"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { useFinderContext } from "@/lib/useFinderContext";

interface Session {
  id: string;
  register_id: string;
  status: "open" | "closed";
  opening_float_cents: number;
  opened_at: number;
  opened_by: string;
}

interface ExpectedData {
  openingFloatCents: number;
  cashSalesCents: number;
  expectedCashCents: number;
  cardSalesCents?: number;
}

// ── Register closed state (spec: illustration + heading + float + note + CTA) ──

function RegisterClosedCard({ onOpen }: { onOpen: (floatCents: number, note: string) => Promise<void> }) {
  const [openFloat, setOpenFloat] = useState("");
  const [note, setNote]           = useState("");
  const [working, setWorking]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const handleOpen = async () => {
    setWorking(true); setError(null);
    try {
      const floatCents = Math.round(parseFloat(openFloat || "0") * 100);
      await onOpen(floatCents, note.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open register");
    } finally { setWorking(false); }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-[#F5F5F5] p-8">
      <div className="w-full max-w-sm rounded-2xl border border-[#E8E8E8] bg-white p-8 shadow-sm">
        {/* Spec: illustration */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-600/10">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#5D5FEF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
              <path d="M7 15h.01M12 15h.01M17 15h.01" strokeWidth="2.5" />
            </svg>
          </div>
          {/* Spec: "Register closed" heading */}
          <h2 className="text-xl font-bold text-[#111]">Register closed</h2>
          <p className="mt-1 text-sm text-[#666]">Set your opening float to begin selling</p>
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="space-y-4">
          {/* Spec: Opening float ($) */}
          <div>
            <label htmlFor="register-opening-float" className="block text-sm font-medium text-[#555] mb-1">
              Opening float ($)
            </label>
            <input
              id="register-opening-float"
              type="number" min="0" step="0.01"
              value={openFloat} onChange={e => setOpenFloat(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-[#D9D9D9] px-3 py-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
          </div>

          {/* Spec: Note textarea */}
          <div>
            <label htmlFor="register-open-note" className="block text-sm font-medium text-[#555] mb-1">
              Note <span className="text-[#aaa] font-normal">(optional)</span>
            </label>
            <textarea
              id="register-open-note"
              rows={2} value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Morning shift, float counted by manager…"
              className="w-full rounded-lg border border-[#D9D9D9] px-3 py-2 text-sm resize-none focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
          </div>

          {/* Spec: "Open Register" full-width blue CTA */}
          <button type="button" disabled={working} onClick={() => void handleOpen()}
            className="w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-60 transition-colors">
            {working ? "Opening…" : "Open Register"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Close register modal (spec: closure summary table) ────────────────────────

function CloseRegisterModal({
  session,
  expectedData,
  onClose,
  onCancel,
}: {
  session: Session;
  expectedData: ExpectedData | null;
  onClose: (countedCents: number, closingCents: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [counted, setCounted]   = useState("");
  const [closing, setClosing]   = useState("");
  const [working, setWorking]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const countedCents  = Math.round(parseFloat(counted || "0") * 100);
  const closingCents  = Math.round(parseFloat(closing || "0") * 100);
  const openingCents  = expectedData?.openingFloatCents ?? session.opening_float_cents;
  const cashSales     = expectedData?.cashSalesCents ?? 0;
  const cardSales     = expectedData?.cardSalesCents ?? 0;
  const expectedCash  = expectedData?.expectedCashCents ?? (openingCents + cashSales);
  const cashToBank    = Math.max(0, countedCents - closingCents);
  const diffCents     = counted ? countedCents - expectedCash : 0;

  const handleConfirm = async () => {
    setWorking(true); setError(null);
    try {
      await onClose(countedCents, closingCents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to close register");
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#F0F0F0] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#111]">Close Register</h2>
            <p className="text-xs text-[#888]">Count cash and confirm closure</p>
          </div>
          <button type="button" onClick={onCancel} className="text-[#888] hover:text-[#555]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Spec: Closure summary — payment type rows × (Expected | Counted | Difference) */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#888] mb-3">Closure summary</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[#aaa] uppercase tracking-wider">
                  <th className="pb-2 text-left font-medium">Payment type</th>
                  <th className="pb-2 text-right font-medium">Expected</th>
                  <th className="pb-2 text-right font-medium">Counted</th>
                  <th className="pb-2 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F5F5F5]">
                {/* Cash row — counted is editable */}
                <tr>
                  <td className="py-2.5 font-medium text-[#111]">Cash</td>
                  <td className="py-2.5 text-right tabular-nums text-[#555]">{formatMoney(expectedCash)}</td>
                  <td className="py-2.5 text-right">
                    <input type="number" min="0" step="0.01" value={counted} onChange={e => setCounted(e.target.value)}
                      placeholder="0.00"
                      className="w-24 rounded border border-[#D9D9D9] px-2 py-1 text-sm text-right focus:border-brand-600 focus:outline-none" />
                  </td>
                  <td className={`py-2.5 text-right font-semibold tabular-nums ${diffCents < 0 ? "text-red-600" : diffCents > 0 ? "text-emerald-600" : "text-[#888]"}`}>
                    {counted ? (diffCents >= 0 ? "+" : "") + formatMoney(diffCents) : "—"}
                  </td>
                </tr>
                {cardSales > 0 && (
                  <tr>
                    <td className="py-2.5 text-[#555]">Card</td>
                    <td className="py-2.5 text-right tabular-nums text-[#555]">{formatMoney(cardSales)}</td>
                    <td className="py-2.5 text-right text-[#aaa] text-xs">auto</td>
                    <td className="py-2.5 text-right text-[#888]">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Spec: Cash rows (Opening float, Cash received, Closing float, Cash to bank bold, Totals) */}
          <div className="rounded-lg border border-[#F0F0F0] bg-[#FAFAFA] px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[#888] mb-3">Cash reconciliation</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-[#555]">
                <span>Opening float</span><span className="tabular-nums">{formatMoney(openingCents)}</span>
              </div>
              <div className="flex justify-between text-[#555]">
                <span>Cash received</span><span className="tabular-nums">{formatMoney(cashSales)}</span>
              </div>
              <div className="flex justify-between text-[#555]">
                <span>Expected in drawer</span><span className="tabular-nums font-medium">{formatMoney(expectedCash)}</span>
              </div>
              <div className="border-t border-[#E8E8E8] pt-2 flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#555]">Closing float ($)</label>
                  <input type="number" min="0" step="0.01" value={closing} onChange={e => setClosing(e.target.value)}
                    placeholder="0.00"
                    className="w-24 rounded border border-[#D9D9D9] px-2 py-1 text-sm focus:border-brand-600 focus:outline-none" />
                </div>
                <span className="tabular-nums text-[#555]">{closing ? formatMoney(closingCents) : "—"}</span>
              </div>
              {/* Spec: Cash to bank — bold */}
              <div className="border-t border-[#E8E8E8] pt-2 flex justify-between font-bold text-[#111]">
                <span>Cash to bank</span>
                <span className="tabular-nums">{closing ? formatMoney(cashToBank) : "—"}</span>
              </div>
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#F0F0F0] px-6 py-4">
          <button type="button" onClick={onCancel}
            className="rounded border border-[#D9D9D9] px-4 py-2 text-sm text-[#555] hover:bg-[#F5F5F5]">Cancel</button>
          <button type="button" disabled={!counted || working} onClick={() => void handleConfirm()}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-50">
            {working ? "Closing…" : "Confirm close"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Guard ─────────────────────────────────────────────────────────────────────

interface RegisterSessionGuardProps {
  registerId: string;
  children: React.ReactNode;
}

export function RegisterSessionGuard({ registerId, children }: RegisterSessionGuardProps) {
  const { setActiveSessionId } = useFinderContext();
  const [session, setSession]         = useState<Session | null | "loading">("loading");
  const [showClose, setShowClose]     = useState(false);
  const [expectedData, setExpectedData] = useState<ExpectedData | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ items: Session[] }>(`/api/v1/outlets/registers/${registerId}/sessions?limit=1`);
      const latest = res.items[0];
      const active = latest?.status === "open" ? latest : null;
      setSession(active);
      setActiveSessionId(active?.id ?? null);
    } catch {
      setSession(null);
      setActiveSessionId(null);
    }
  }, [registerId, setActiveSessionId]);

  const loadExpected = useCallback(async () => {
    try {
      const data = await apiGet<ExpectedData>(`/api/v1/outlets/registers/${registerId}/expected-cash`);
      setExpectedData(data);
    } catch { setExpectedData(null); }
  }, [registerId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (showClose) void loadExpected(); }, [showClose, loadExpected]);

  const handleOpen = async (floatCents: number, note: string) => {
    try {
      const s = await apiPost<Session>(`/api/v1/outlets/registers/${registerId}/open`, {
        openingFloatCents: floatCents,
        note: note || undefined,
      });
      setSession(s);
      setActiveSessionId(s.id);
    } catch (e) {
      // "Already has an open session" — the closed card was stale (another
      // device opened it, or the sessions load transiently failed). Re-sync
      // to the live session instead of stranding the cashier on an error.
      if (e instanceof ApiResponseError && e.status === 409) {
        await load();
        return;
      }
      throw e;
    }
  };

  const handleClose = async (countedCents: number, closingCents: number) => {
    await apiPost(`/api/v1/outlets/registers/${registerId}/close`, {
      countedCashCents: countedCents,
      closingFloatCents: closingCents,
    });
    setSession(null);
    setShowClose(false);
    setActiveSessionId(null);
    setExpectedData(null);
  };

  if (session === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600/30 border-t-brand-600" />
      </div>
    );
  }

  if (!session) {
    return <RegisterClosedCard onOpen={handleOpen} />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Open register strip */}
      <div className="flex-none border-b border-[#E8E8E8] bg-white px-4 py-2 flex items-center justify-between">
        <span className="text-xs text-[#888]">
          Register open · Float: <strong>{formatMoney(session.opening_float_cents)}</strong>
        </span>
        <button type="button" onClick={() => setShowClose(true)}
          className="text-xs text-brand-600 hover:underline">
          Close register
        </button>
      </div>

      <div className="flex-1 min-h-0">{children}</div>

      {/* Close modal */}
      {showClose && (
        <CloseRegisterModal
          session={session}
          expectedData={expectedData}
          onClose={handleClose}
          onCancel={() => setShowClose(false)}
        />
      )}
    </div>
  );
}
