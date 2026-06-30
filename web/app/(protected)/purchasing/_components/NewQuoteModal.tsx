"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { parseToCents } from "@/lib/money";
import type { QuoteLine } from "./shared";

interface DraftQuoteLine { product: string; qty: string; unit_price: string; }

function emptyQuoteLine(): DraftQuoteLine {
  return { product: "", qty: "1", unit_price: "" };
}

export function NewQuoteModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: { vendor: string; line_items: QuoteLine[]; expires_at: number }) => void;
}) {
  const [vendor, setVendor] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [draftLines, setDraftLines] = useState<DraftQuoteLine[]>([emptyQuoteLine()]);

  const updateDraftLine = (i: number, patch: Partial<DraftQuoteLine>) =>
    setDraftLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = () => {
    if (!vendor.trim()) return;
    const line_items: QuoteLine[] = draftLines
      .filter((l) => l.product.trim() && l.qty && l.unit_price)
      .map((l) => ({
        product: l.product.trim(),
        qty: Number(l.qty),
        unit_price_cents: parseToCents(l.unit_price),
      }));
    if (line_items.length === 0) return;
    const expires_at = expiresOn ? new Date(expiresOn).getTime() : Date.now() + 7 * 86400000;
    onSubmit({ vendor: vendor.trim(), line_items, expires_at });
  };

  const canSubmit = vendor.trim() && draftLines.some((l) => l.product.trim() && l.qty && l.unit_price);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Quote"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!canSubmit} onClick={submit}>
            Create quote
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Vendor</label>
          <input
            type="text"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="e.g. Supplier Co"
            className="min-h-[44px] w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Expires on</label>
          <input
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            className="min-h-[44px] rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase text-slate-500">Line items</label>
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="pb-1 pr-2">Product</th>
                <th className="pb-1 pr-2 w-16">Qty</th>
                <th className="pb-1 pr-2 w-24">Unit price ($)</th>
                <th className="pb-1 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {draftLines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      value={l.product}
                      onChange={(e) => updateDraftLine(i, { product: e.target.value })}
                      placeholder="Product name"
                      className="min-h-[36px] w-full rounded border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min="1"
                      value={l.qty}
                      onChange={(e) => updateDraftLine(i, { qty: e.target.value })}
                      className="min-h-[36px] w-full rounded border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={l.unit_price}
                      onChange={(e) => updateDraftLine(i, { unit_price: e.target.value })}
                      placeholder="0.00"
                      className="min-h-[36px] w-full rounded border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                    />
                  </td>
                  <td className="py-1">
                    {draftLines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setDraftLines((cur) => cur.filter((_, idx) => idx !== i))}
                        className="rounded p-1 text-slate-400 hover:text-red-500"
                        aria-label="Remove line"
                      >
                        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => setDraftLines((cur) => [...cur, emptyQuoteLine()])}
            className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            + Add line
          </button>
        </div>
      </div>
    </Modal>
  );
}
