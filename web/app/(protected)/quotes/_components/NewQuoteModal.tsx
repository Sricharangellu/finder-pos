"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { apiPost } from "@/api-client/client";
import { useToast } from "@/components/Toast";
import { parseCents } from "./quotesTypes";

interface NewLine { name: string; qty: string; unitPrice: string; }
const EMPTY_LINE: NewLine = { name: "", qty: "1", unitPrice: "" };

export function NewQuoteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { addToast } = useToast();
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [lines, setLines] = useState<NewLine[]>([{ ...EMPTY_LINE }]);
  const [submitting, setSubmitting] = useState(false);

  const updateLine = (i: number, f: keyof NewLine, v: string) =>
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [f]: v } : l));

  const handleSubmit = async () => {
    if (!lines.some((l) => l.name.trim())) {
      addToast({ title: "Add at least one line item", variant: "error" }); return;
    }
    setSubmitting(true);
    try {
      await apiPost("/api/v1/quotes", {
        customerId: customerName.trim() || undefined,
        notes: notes.trim() || undefined,
        validUntil: validUntil ? new Date(validUntil).getTime() : undefined,
        lines: lines.filter((l) => l.name.trim()).map((l) => ({
          name: l.name.trim(),
          quantity: Math.max(1, parseInt(l.qty, 10) || 1),
          unitCents: parseCents(l.unitPrice),
        })),
      });
      addToast({ title: "Quote created", variant: "success" });
      onCreated(); onClose();
    } catch (e) {
      addToast({ title: "Failed to create quote", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="relative w-full max-w-xl rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#F0F0F0] px-5 py-4">
          <h2 className="text-base font-semibold text-[#111]">New quotation</h2>
          <button type="button" onClick={onClose} className="text-[#888] hover:text-[#555]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#555] mb-1">Customer</label>
              <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name"
                className="w-full h-8 rounded border border-[#D9D9D9] px-2 text-sm focus:border-brand-600 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#555] mb-1">Valid until</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
                className="w-full h-8 rounded border border-[#D9D9D9] px-2 text-sm focus:border-brand-600 focus:outline-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-[#555] mb-1">Note</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note"
                className="w-full h-8 rounded border border-[#D9D9D9] px-2 text-sm focus:border-brand-600 focus:outline-none" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#888]">Line items</p>
              <button type="button" onClick={() => setLines((p) => [...p, { ...EMPTY_LINE }])}
                className="text-xs text-brand-600 hover:underline">+ Add line</button>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <input type="text" value={line.name} onChange={(e) => updateLine(i, "name", e.target.value)} placeholder="Product name"
                  className="flex-1 h-8 rounded border border-[#D9D9D9] px-2 text-sm focus:border-brand-600 focus:outline-none" />
                <input type="number" value={line.qty} min="1" onChange={(e) => updateLine(i, "qty", e.target.value)} placeholder="Qty"
                  className="w-14 h-8 rounded border border-[#D9D9D9] px-2 text-sm text-center focus:border-brand-600 focus:outline-none" />
                <input type="number" value={line.unitPrice} min="0" step="0.01" onChange={(e) => updateLine(i, "unitPrice", e.target.value)} placeholder="$"
                  className="w-20 h-8 rounded border border-[#D9D9D9] px-2 text-sm text-right focus:border-brand-600 focus:outline-none" />
                <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} disabled={lines.length === 1}
                  className="text-[#ccc] hover:text-red-500 disabled:opacity-30">✕</button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#F0F0F0] px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={submitting} onClick={() => void handleSubmit()}>Create quote</Button>
        </div>
      </div>
    </div>
  );
}
