"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiPost, apiPut } from "@/api-client/client";
import { useToast } from "@/components/Toast";

type Edition = "retail" | "wholesale" | "enterprise" | "hybrid";
type Step = "business-type" | "store-info" | "first-product" | "done";

const EDITIONS: Array<{ key: Edition; label: string; description: string; icon: string }> = [
  { key: "retail", label: "Retail", description: "Walk-in customers, POS terminal, loyalty, gift cards", icon: "🛒" },
  { key: "wholesale", label: "Wholesale / B2B", description: "Credit accounts, sales orders, invoices, vendor management", icon: "📦" },
  { key: "enterprise", label: "Enterprise", description: "Multi-location, full suite, advanced reporting, SSO", icon: "🏢" },
  { key: "hybrid", label: "Hybrid (Everything)", description: "Full retail + wholesale + enterprise features enabled", icon: "⚡" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [step, setStep] = useState<Step>("business-type");
  const [edition, setEdition] = useState<Edition>("retail");
  const [storeName, setStoreName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productSku, setProductSku] = useState("");
  const [busy, setBusy] = useState(false);

  const goBusinessType = useCallback(async () => {
    setBusy(true);
    try {
      await apiPost("/api/v1/settings/edition", { edition });
      setStep("store-info");
    } catch { setStep("store-info"); }
    finally { setBusy(false); }
  }, [edition]);

  const goStoreInfo = useCallback(async () => {
    if (!storeName.trim()) { addToast({ title: "Enter your store name", variant: "error" }); return; }
    setBusy(true);
    try {
      await apiPut("/api/v1/settings/business", { name: storeName.trim(), billingAddress: storeAddress.trim() || undefined });
      setStep("first-product");
    } catch { setStep("first-product"); }
    finally { setBusy(false); }
  }, [storeName, storeAddress, addToast]);

  const goFirstProduct = useCallback(async () => {
    if (productName.trim() && productPrice.trim()) {
      setBusy(true);
      try {
        const priceCents = Math.round(parseFloat(productPrice) * 100);
        await apiPost("/api/v1/catalog", { name: productName.trim(), sku: productSku.trim() || `SKU-${Date.now()}`, price_cents: priceCents, status: "active" });
      } catch { /* ok to skip */ }
      finally { setBusy(false); }
    }
    setStep("done");
  }, [productName, productPrice, productSku]);

  const PROGRESS: Record<Step, number> = { "business-type": 25, "store-info": 50, "first-product": 75, done: 100 };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-slate-950 text-white text-2xl font-bold mb-4">F</div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome to FinderPOS</h1>
          <p className="mt-1 text-sm text-slate-500">Let&apos;s set up your store in 3 quick steps</p>
        </div>

        {/* Progress */}
        <div className="mb-6 h-2 w-full rounded-full bg-slate-200 overflow-hidden">
          <div className="h-2 rounded-full bg-slate-950 transition-all duration-500" style={{ width: `${PROGRESS[step]}%` }} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">

          {/* Step 1: Business type */}
          {step === "business-type" && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">What type of business are you?</h2>
              <p className="text-sm text-slate-500 mb-5">This enables the right modules for your workflow.</p>
              <div className="space-y-3">
                {EDITIONS.map(e => (
                  <button key={e.key} onClick={() => setEdition(e.key)}
                    className={`w-full flex items-start gap-4 rounded-lg border-2 p-4 text-left transition-colors ${edition === e.key ? "border-slate-950 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}>
                    <span className="text-2xl">{e.icon}</span>
                    <div>
                      <p className="font-semibold text-slate-900">{e.label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{e.description}</p>
                    </div>
                    {edition === e.key && <div className="ml-auto h-5 w-5 rounded-full bg-slate-950 flex items-center justify-center text-white text-xs shrink-0 mt-0.5">&#x2713;</div>}
                  </button>
                ))}
              </div>
              <button onClick={() => void goBusinessType()} disabled={busy}
                className="mt-6 w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
                {busy ? "Saving…" : "Continue →"}
              </button>
            </div>
          )}

          {/* Step 2: Store info */}
          {step === "store-info" && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Tell us about your store</h2>
              <p className="text-sm text-slate-500 mb-5">This appears on receipts and reports.</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Store name <span className="text-red-500">*</span></label>
                  <input value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="e.g. Blue Sky Tobacco & Vape" autoFocus
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-950 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Address <span className="text-slate-400">(optional)</span></label>
                  <input value={storeAddress} onChange={e => setStoreAddress(e.target.value)} placeholder="123 Main St, Houston TX 77001"
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-950 focus:outline-none" />
                </div>
              </div>
              <button onClick={() => void goStoreInfo()} disabled={busy}
                className="mt-6 w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
                {busy ? "Saving…" : "Continue →"}
              </button>
              <button onClick={() => setStep("first-product")} className="mt-2 w-full text-sm text-slate-400 hover:text-slate-600">Skip for now</button>
            </div>
          )}

          {/* Step 3: First product */}
          {step === "first-product" && (
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Add your first product</h2>
              <p className="text-sm text-slate-500 mb-5">You can add more from the Catalog page any time.</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Product name</label>
                  <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Marlboro Red 100s" autoFocus
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-950 focus:outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Price ($)</label>
                    <input type="number" step="0.01" value={productPrice} onChange={e => setProductPrice(e.target.value)} placeholder="42.50"
                      className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-950 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">SKU <span className="text-slate-400">(optional)</span></label>
                    <input value={productSku} onChange={e => setProductSku(e.target.value)} placeholder="MAR-RED-100"
                      className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-slate-950 focus:outline-none" />
                  </div>
                </div>
              </div>
              <button onClick={() => void goFirstProduct()} disabled={busy}
                className="mt-6 w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
                {busy ? "Adding…" : (productName.trim() ? "Add product →" : "Skip →")}
              </button>
            </div>
          )}

          {/* Step 4: Done */}
          {step === "done" && (
            <div className="text-center py-4">
              <div className="text-5xl mb-4">&#x1F389;</div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">You&apos;re all set!</h2>
              <p className="text-sm text-slate-500 mb-6">Your store is ready. Start ringing up sales from the POS terminal, or explore the admin dashboard.</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => router.replace("/terminal")}
                  className="rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-colors">
                  Open POS Terminal
                </button>
                <button onClick={() => router.replace("/dashboard")}
                  className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                  Go to Dashboard
                </button>
              </div>
            </div>
          )}
        </div>

        {step !== "done" && (
          <p className="mt-4 text-center text-xs text-slate-400">
            Step {(Object.keys(PROGRESS) as Step[]).indexOf(step) + 1} of 3 · You can change these settings any time
          </p>
        )}
      </div>
    </div>
  );
}
