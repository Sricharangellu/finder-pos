"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet, apiPost, apiPatch, ApiResponseError } from "@/api-client/client";
import type { WorkflowDefinition, WorkflowsResponse } from "@/api-client/types";
import { WorkflowFormModal } from "./_components/WorkflowFormModal";
import { WorkflowRow } from "./_components/WorkflowRow";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "workflows" | "approval-chains" | "run-history" | "templates";

interface ApprovalStep { role: string; label: string }
interface ApprovalChain {
  id: string; name: string; trigger: string; threshold: number | null;
  steps: ApprovalStep[]; enabled: boolean; runs: number; created_at: number;
}
interface RunRecord {
  id: string; workflow_name: string; trigger: string;
  status: "passed" | "failed" | "skipped";
  cashier: string; duration_ms: number; ran_at: number; outlet: string;
}
interface WfTemplate {
  id: string; name: string; category: string; description: string;
  steps: number; installs: number; installed: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "workflows",       label: "Workflows" },
  { key: "approval-chains", label: "Approval Chains" },
  { key: "run-history",     label: "Run History" },
  { key: "templates",       label: "Templates" },
];

const TRIGGER_LABELS: Record<string, string> = {
  price_override:  "Price Override",
  refund:          "Refund",
  vendor_create:   "New Vendor",
  discount_create: "Discount Created",
  custom:          "Custom",
  age_verification:"Age Verification",
  loyalty_capture: "Loyalty Capture",
  custom_prompt:   "Custom Prompt",
};

const CATEGORY_CLS: Record<string, string> = {
  compliance: "bg-red-100 text-red-700",
  loyalty:    "bg-purple-100 text-purple-700",
  approvals:  "bg-amber-100 text-amber-700",
  payments:   "bg-teal-100 text-teal-700",
  b2b:        "bg-indigo-100 text-indigo-700",
};

// ── Shared ────────────────────────────────────────────────────────────────────

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}

function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
          <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

// ── Workflows Tab ─────────────────────────────────────────────────────────────

function WorkflowsTab() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<WorkflowsResponse>("/api/v1/workflows");
      setWorkflows(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load workflows.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeCount   = workflows.filter(w => w.enabled).length;
  const inactiveCount = workflows.filter(w => !w.enabled).length;

  return (
    <div className="space-y-4">
      {!loading && !error && workflows.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Active",   count: activeCount,   cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
            { label: "Inactive", count: inactiveCount, cls: "bg-slate-50 text-slate-600 ring-1 ring-slate-200" },
          ].map(({ label, count, cls }) => (
            <span key={label} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${cls}`}>
              <span className="text-base font-semibold">{count}</span> {label}
            </span>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Workflow definitions</h2>
            {!loading && <p className="text-xs text-slate-500">{workflows.length} {workflows.length === 1 ? "workflow" : "workflows"}</p>}
          </div>
          <button type="button" onClick={() => setShowCreate(true)}
            className="rounded-lg bg-[#5D5FEF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + New Workflow
          </button>
        </div>

        {loading ? <Skeleton /> : error ? (
          <p className="px-5 py-6 text-sm text-red-600">{error}</p>
        ) : workflows.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-sm font-medium text-slate-700">No workflows yet</p>
            <p className="mt-1 text-sm text-slate-500">Create a workflow to automate checkout steps — or install one from Templates.</p>
            <button type="button" onClick={() => setShowCreate(true)}
              className="mt-4 rounded-lg bg-[#5D5FEF] px-4 py-2 text-sm font-medium text-white hover:bg-[#4B4DC8]">
              Create first workflow
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {workflows.map(wf => <WorkflowRow key={wf.id} workflow={wf} onReload={load} />)}
          </div>
        )}
      </div>

      {!loading && workflows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm text-slate-600">
          <span className="font-semibold">How workflows fire: </span>
          Each workflow runs at the point-of-sale when its trigger condition is met (e.g. an age-restricted product is added to a cart).
          Steps execute in order — a Gate step can block the transaction until the condition is cleared.
        </div>
      )}

      {showCreate && (
        <WorkflowFormModal
          onSave={async body => { await apiPost("/api/v1/workflows", body); await load(); }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

// ── Approval Chains Tab ───────────────────────────────────────────────────────

function ApprovalChainsTab() {
  const [chains, setChains]   = useState<ApprovalChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiGet<{ items: ApprovalChain[] }>("/api/v1/workflows/approval-chains");
      setChains(r.items ?? []);
    } catch (err: unknown) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load approval chains.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const ROLE_CLS: Record<string, string> = {
    manager:    "bg-blue-100 text-blue-700",
    supervisor: "bg-purple-100 text-purple-700",
    finance:    "bg-teal-100 text-teal-700",
    legal:      "bg-orange-100 text-orange-700",
    owner:      "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-700">
        Approval chains define multi-step sign-off flows for sensitive operations. Each step routes to a role and blocks the action until approved.
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900">{chains.length} approval chains</h3>
          <button type="button"
            className="rounded-lg bg-[#5D5FEF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + New Chain
          </button>
        </div>

        {loading ? <Skeleton /> : error ? (
          <p className="px-5 py-6 text-sm text-red-600">{error}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {chains.map(c => (
              <div key={c.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900">{c.name}</p>
                      <Badge label={c.enabled ? "Active" : "Disabled"}
                        cls={c.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"} />
                      <Badge label={TRIGGER_LABELS[c.trigger] ?? c.trigger} cls="bg-indigo-100 text-indigo-700" />
                      {c.threshold !== null && (
                        <Badge label={`Threshold: ${c.threshold}${c.trigger === "price_override" || c.trigger === "discount_create" ? "%" : c.trigger === "refund" ? "¢" : ""}`}
                          cls="bg-orange-100 text-orange-700" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">{c.runs.toLocaleString()} lifetime runs</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={async () => {
                        await apiPatch(`/api/v1/workflows/approval-chains/${c.id}`, { enabled: !c.enabled });
                        await load();
                      }}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${c.enabled ? "bg-[#5D5FEF]" : "bg-slate-200"}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${c.enabled ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                    <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {c.steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-xs text-slate-300">→</span>}
                      <div className="flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ROLE_CLS[s.role] ?? "bg-slate-100 text-slate-600"}`}>{s.role}</span>
                        <span className="text-xs text-slate-700">{s.label}</span>
                      </div>
                    </div>
                  ))}
                  {c.steps.length === 0 && <span className="text-xs text-slate-400">No approvers configured</span>}
                </div>
              </div>
            ))}
            {chains.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-400">No approval chains configured.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Run History Tab ───────────────────────────────────────────────────────────

function RunHistoryTab() {
  const [runs, setRuns]       = useState<RunRecord[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: RunRecord[]; total: number }>("/api/v1/workflows/run-history").then(r => {
      setRuns(r.items ?? []); setTotal(r.total ?? 0); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  const STATUS_CLS: Record<RunRecord["status"], string> = {
    passed:  "bg-emerald-100 text-emerald-700",
    failed:  "bg-red-100 text-red-700",
    skipped: "bg-slate-100 text-slate-500",
  };

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;

  const passedCount  = runs.filter(r => r.status === "passed").length;
  const failedCount  = runs.filter(r => r.status === "failed").length;
  const skippedCount = runs.filter(r => r.status === "skipped").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Passed",  value: passedCount,  cls: "text-emerald-700" },
          { label: "Failed",  value: failedCount,  cls: "text-red-600" },
          { label: "Skipped", value: skippedCount, cls: "text-slate-500" },
        ].map(m => (
          <div key={m.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{m.label}</p>
            <p className={`mt-1 text-2xl font-bold ${m.cls}`}>{m.value}</p>
            <p className="mt-0.5 text-xs text-slate-400">of {runs.length} shown ({total.toLocaleString()} total)</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900">Recent workflow runs</h3>
        </div>
        {loading ? <Skeleton /> : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-5 py-3">Workflow</th>
                <th className="px-5 py-3">Trigger</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Cashier</th>
                <th className="px-5 py-3">Outlet</th>
                <th className="px-5 py-3 text-right">Duration</th>
                <th className="px-5 py-3">Ran at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-900">{r.workflow_name}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{TRIGGER_LABELS[r.trigger] ?? r.trigger}</td>
                  <td className="px-5 py-3.5">
                    <Badge label={r.status.charAt(0).toUpperCase() + r.status.slice(1)} cls={STATUS_CLS[r.status]} />
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">{r.cashier}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{r.outlet}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-xs text-slate-500">{r.duration_ms}ms</td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{new Date(r.ran_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Templates Tab ─────────────────────────────────────────────────────────────

function TemplatesTab({ onInstall }: { onInstall: () => void }) {
  const [templates, setTemplates] = useState<WfTemplate[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiGet<{ items: WfTemplate[] }>("/api/v1/workflows/templates");
      setTemplates(r.items ?? []);
    } catch (err: unknown) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load templates.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleInstall = async (id: string) => {
    setInstalling(id);
    try {
      await apiPost(`/api/v1/workflows/templates/${id}/install`, {});
      await load();
      onInstall();
    } catch { /* ignore */ }
    finally { setInstalling(null); }
  };

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;

  const CATEGORY_LABEL: Record<string, string> = {
    compliance: "Compliance",
    loyalty:    "Loyalty",
    approvals:  "Approvals",
    payments:   "Payments",
    b2b:        "B2B",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-3 text-sm text-blue-700">
        Templates are pre-built workflow definitions. Install one to add it to your Workflows list, then customize it as needed.
      </div>

      {loading ? <Skeleton rows={8} /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <div key={t.id} className={`rounded-xl border bg-white p-5 shadow-sm ${t.installed ? "border-[#5D5FEF]/30" : "border-slate-200"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{t.name}</p>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    <Badge label={CATEGORY_LABEL[t.category] ?? t.category} cls={CATEGORY_CLS[t.category] ?? "bg-slate-100 text-slate-600"} />
                    <span className="text-[10px] text-slate-400">{t.steps} step{t.steps !== 1 ? "s" : ""}</span>
                    <span className="text-[10px] text-slate-400">{t.installs.toLocaleString()} installs</span>
                  </div>
                </div>
                {t.installed && (
                  <span className="shrink-0 rounded-full bg-[#5D5FEF]/10 px-2.5 py-0.5 text-[10px] font-bold text-[#5D5FEF]">Installed</span>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-500 leading-relaxed">{t.description}</p>
              <div className="mt-4">
                {t.installed ? (
                  <button disabled className="w-full rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-400 cursor-not-allowed">
                    Already installed
                  </button>
                ) : (
                  <button
                    onClick={() => void handleInstall(t.id)}
                    disabled={installing === t.id}
                    className="w-full rounded-lg bg-[#5D5FEF] py-2 text-xs font-semibold text-white hover:bg-[#4B4DC8] disabled:opacity-50"
                  >
                    {installing === t.id ? "Installing…" : "Install template"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const [activeTab, setActiveTab]     = useState<Tab>("workflows");
  const [workflowsKey, setWorkflowsKey] = useState(0);

  return (
    <EnterpriseShell
      active="workflows"
      title="Workflow Engine"
      subtitle="Checkout automation, approval chains, and compliance gates"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl space-y-0 px-4 py-5 sm:px-6">
        {/* Tabs */}
        <div className="border-b border-slate-200">
          <nav className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === t.key
                    ? "border-[#5D5FEF] text-[#5D5FEF]"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="pt-5">
          {activeTab === "workflows"       && <WorkflowsTab key={workflowsKey} />}
          {activeTab === "approval-chains" && <ApprovalChainsTab />}
          {activeTab === "run-history"     && <RunHistoryTab />}
          {activeTab === "templates"       && (
            <TemplatesTab onInstall={() => setWorkflowsKey(k => k + 1)} />
          )}
        </div>
      </div>
    </EnterpriseShell>
  );
}
