"use client";

/**
 * RetailSetupChecklist — "required next tasks for retail" from the forward
 * plan's Signup-and-setup requirements: outlet, register, tax, payment modes,
 * receipt, first product, first receiving.
 *
 * Completion is detected LIVE against the same APIs the setup pages write to,
 * so the card reflects real tenant state (mock or real backend) rather than a
 * stored wizard step. Shown on the dashboard for retail tenants until every
 * task passes; dismissible per browser.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/api-client/client";
import { useCapabilities } from "@/contexts/CapabilitiesContext";

const DISMISS_KEY = "finder_retail_setup_dismissed_v1";

interface OutletsResponse {
  items: Array<{ id: string; registers?: Array<{ id: string }> }>;
}

export interface SetupTaskState {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
}

/**
 * Evaluate the seven retail setup tasks against live tenant data.
 * Exported for tests. Every check fails closed to "not done" on error —
 * an incomplete checklist is annoying, a falsely-complete one hides setup.
 */
export async function evaluateRetailSetupTasks(): Promise<SetupTaskState[]> {
  const [outletsR, taxR, modesR, catalogR, levelsR] = await Promise.allSettled([
    apiGet<OutletsResponse>("/api/v1/outlets"),
    apiGet<{ items: unknown[] }>("/api/v1/settings/tax-rates"),
    apiGet<{ items: unknown[] }>("/api/v1/settings/payment-modes"),
    apiGet<{ items: unknown[]; total?: number }>("/api/v1/catalog?pageSize=1"),
    apiGet<{ items: Array<Record<string, unknown>> }>("/api/v1/inventory/levels?pageSize=50"),
  ]);

  const outlets = outletsR.status === "fulfilled" ? outletsR.value.items : [];
  const hasOutlet = outlets.length > 0;
  const hasRegister = outlets.some((o) => (o.registers?.length ?? 0) > 0);
  const hasTax = taxR.status === "fulfilled" && taxR.value.items.length > 0;
  const hasModes = modesR.status === "fulfilled" && modesR.value.items.length > 0;
  const hasProduct =
    catalogR.status === "fulfilled" &&
    ((catalogR.value.total ?? 0) > 0 || catalogR.value.items.length > 0);
  // "First receiving" = stock exists somewhere. Field name differs between
  // the mock (onHand) and real (stock_qty / on_hand) level shapes.
  const hasStock =
    levelsR.status === "fulfilled" &&
    levelsR.value.items.some((row) => {
      const qty = Number(row["stock_qty"] ?? row["onHand"] ?? row["on_hand"] ?? 0);
      return qty > 0;
    });

  // Receipt template needs an outlet first; treat any saved header/contact as
  // configured. A 404 (never saved) or missing outlet counts as not done.
  let hasReceipt = false;
  const firstOutletId = outlets[0]?.id;
  if (firstOutletId) {
    try {
      const receipt = await apiGet<{ headerText?: string; contactInfo?: string; footerText?: string }>(
        `/api/v1/settings/receipts/${firstOutletId}`,
      );
      hasReceipt = Boolean(
        (receipt.headerText && receipt.headerText.trim()) ||
        (receipt.contactInfo && receipt.contactInfo.trim()) ||
        (receipt.footerText && receipt.footerText.trim()),
      );
    } catch {
      hasReceipt = false;
    }
  }

  return [
    { key: "outlet",   label: "Create an outlet",        description: "Your store location — timezone, name, address.",            href: "/setup/outlets",       done: hasOutlet },
    { key: "register", label: "Add a register",           description: "A till the POS terminal can open and close.",               href: "/setup/outlets",       done: hasRegister },
    { key: "tax",      label: "Set a tax rate",           description: "Sales tax applied at checkout.",                            href: "/setup/taxes",         done: hasTax },
    { key: "payments", label: "Configure payment modes",  description: "Cash, card, and any other tenders you accept.",             href: "/setup/payment-modes", done: hasModes },
    { key: "receipt",  label: "Set up your receipt",      description: "Header, contact info, and return policy on receipts.",      href: "/settings",            done: hasReceipt },
    { key: "product",  label: "Add your first product",   description: "Create a product so the register has something to sell.",   href: "/catalog",             done: hasProduct },
    { key: "receive",  label: "Receive your first stock", description: "Bring inventory on hand through a receiving.",              href: "/inventory/receive-stock", done: hasStock },
  ];
}

export function RetailSetupChecklist() {
  const { capabilities } = useCapabilities();
  const [tasks, setTasks] = useState<SetupTaskState[] | null>(null);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we read storage

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const isRetail = capabilities?.business.type === "retail";

  useEffect(() => {
    if (!isRetail || dismissed) return;
    let cancelled = false;
    void evaluateRetailSetupTasks().then((result) => {
      if (!cancelled) setTasks(result);
    });
    return () => {
      cancelled = true;
    };
  }, [isRetail, dismissed]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const doneCount = useMemo(() => tasks?.filter((t) => t.done).length ?? 0, [tasks]);
  const allDone = tasks !== null && doneCount === tasks.length;

  // Nothing to show: not a retail tenant, dismissed, still checking, or done.
  if (!isRetail || dismissed || tasks === null || allDone) return null;

  return (
    <section
      aria-label="Retail setup checklist"
      className="mb-5 rounded-xl border border-brand-600/25 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[#111]">Finish setting up your store</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {doneCount} of {tasks.length} tasks complete — everything the register needs before your first sale.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs text-slate-400 hover:text-slate-600"
          aria-label="Dismiss setup checklist"
        >
          Dismiss
        </button>
      </div>

      {/* Progress */}
      <div className="mt-3 h-1.5 rounded-full bg-slate-100" role="progressbar"
        aria-valuemin={0} aria-valuemax={tasks.length} aria-valuenow={doneCount}
        aria-label="Setup progress">
        <div
          className="h-1.5 rounded-full bg-brand-600 transition-all"
          style={{ width: `${(doneCount / tasks.length) * 100}%` }}
        />
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {tasks.map((task) => (
          <li key={task.key}>
            <Link
              href={task.href}
              className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                task.done
                  ? "border-emerald-100 bg-emerald-50/50"
                  : "border-slate-200 bg-white hover:border-brand-600/40"
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  task.done ? "bg-emerald-500 text-white" : "border-2 border-slate-300 text-transparent"
                }`}
              >
                ✓
              </span>
              <span>
                <span className={`block text-sm font-medium ${task.done ? "text-emerald-700 line-through decoration-emerald-300" : "text-[#111]"}`}>
                  {task.label}
                </span>
                <span className="block text-xs text-slate-500">{task.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
