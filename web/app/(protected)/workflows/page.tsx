"use client";

/**
 * /workflows — Checkout workflow automation.
 * Lists workflow definitions; each can be expanded to show/manage steps.
 * Supports create/edit workflow, toggle enabled, add/delete steps.
 * Fetches GET /api/v1/workflows.
 */

import { useEffect, useState, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowsResponse,
  TriggerCondition,
  StepType,
} from "@/api-client/types";
import { fmtDate } from "@/lib/date";

// ── Constants ─────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<TriggerCondition, string> = {
  age_verification:  "Age verification",
  loyalty_capture:   "Loyalty capture",
  id_scan:           "ID scan",
  customer_required: "Customer required",
  signature_required:"Signature required",
  custom_prompt:     "Custom prompt",
};

const STEP_TYPE_LABELS: Record<StepType, string> = {
  prompt:       "Prompt",
  gate:         "Gate",
  capture:      "Capture",
  external_api: "External API",
};

const STEP_TYPE_BADGE: Record<StepType, "blue" | "yellow" | "green" | "purple"> = {
  prompt:       "blue",
  gate:         "yellow",
  capture:      "green",
  external_api: "purple",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Workflow Form Modal ───────────────────────────────────────────────────────

function WorkflowFormModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: WorkflowDefinition;
  onSave: (body: { name: string; description?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName]               = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required."); return; }
    setSaving(true); setErr(null);
    try {
      await onSave({ name: name.trim(), description: description.trim() || undefined });
      onClose();
    } catch (ex) {
      setErr(ex instanceof ApiResponseError ? ex.message : "Save failed.");
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            {initial ? "Edit workflow" : "New workflow"}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form id="wf-form" onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Name <span className="text-red-500">*</span></label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Age Verification" className={inputCls} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What does this workflow do?" className={`${inputCls} resize-none`} />
          </div>
        </form>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" form="wf-form" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Saving…" : initial ? "Save changes" : "Create workflow"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step Form Modal ───────────────────────────────────────────────────────────

function StepFormModal({
  workflowId,
  initial,
  onSave,
  onClose,
}: {
  workflowId: string;
  initial?: WorkflowStep;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName]                         = useState(initial?.name ?? "");
  const [stepType, setStepType]                 = useState<StepType>(initial?.stepType ?? "prompt");
  const [triggerCondition, setTriggerCondition] = useState<TriggerCondition>(initial?.triggerCondition ?? "age_verification");
  const [configJson, setConfigJson]             = useState(() =>
    initial?.config ? JSON.stringify(initial.config, null, 2) : "{}"
  );
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Step name is required."); return; }
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(configJson); } catch { setErr("Config must be valid JSON."); return; }
    setSaving(true); setErr(null);
    try {
      await onSave({ name: name.trim(), stepType, triggerCondition, config });
      onClose();
    } catch (ex) {
      setErr(ex instanceof ApiResponseError ? ex.message : "Save failed.");
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            {initial ? "Edit step" : "Add step"}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form id="step-form" onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Step name <span className="text-red-500">*</span></label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Prompt cashier for ID" className={inputCls} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Type</label>
              <select value={stepType} onChange={(e) => setStepType(e.target.value as StepType)} className={inputCls}>
                {(Object.keys(STEP_TYPE_LABELS) as StepType[]).map((t) => (
                  <option key={t} value={t}>{STEP_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Trigger</label>
              <select value={triggerCondition} onChange={(e) => setTriggerCondition(e.target.value as TriggerCondition)} className={inputCls}>
                {(Object.keys(TRIGGER_LABELS) as TriggerCondition[]).map((t) => (
                  <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Config <span className="font-normal text-slate-400">(JSON)</span>
            </label>
            <textarea
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              rows={4}
              spellCheck={false}
              className={`${inputCls} font-mono text-xs resize-none`}
            />
          </div>
        </form>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" form="step-form" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Saving…" : initial ? "Save changes" : "Add step"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Steps Panel ───────────────────────────────────────────────────────────────

function StepsPanel({
  workflow,
  onReload,
}: {
  workflow: WorkflowDefinition;
  onReload: () => void;
}) {
  const [showAddStep, setShowAddStep]   = useState(false);
  const [editStep, setEditStep]         = useState<WorkflowStep | null>(null);
  const [deleteStep, setDeleteStep]     = useState<WorkflowStep | null>(null);
  const [deleting, setDeleting]         = useState(false);
  const [actionError, setActionError]   = useState<string | null>(null);

  const handleAddStep = async (body: Record<string, unknown>) => {
    await apiPost(`/api/v1/workflows/${workflow.id}/steps`, body);
    onReload();
  };

  const handleEditStep = async (body: Record<string, unknown>) => {
    if (!editStep) return;
    await apiPatch(`/api/v1/workflows/${workflow.id}/steps/${editStep.id}`, body);
    onReload();
  };

  const handleDeleteStep = async () => {
    if (!deleteStep) return;
    setDeleting(true); setActionError(null);
    try {
      await apiDelete(`/api/v1/workflows/${workflow.id}/steps/${deleteStep.id}`);
      setDeleteStep(null);
      onReload();
    } catch (ex) {
      setActionError(ex instanceof ApiResponseError ? ex.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  const sorted = [...workflow.steps].sort((a, b) => a.position - b.position);

  return (
    <div className="border-t border-slate-200 bg-slate-50/60">
      {actionError && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2">
          <p className="text-sm text-red-700">{actionError}</p>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="px-6 py-6 text-center">
          <p className="text-sm text-slate-500">No steps yet.</p>
          <p className="mt-0.5 text-xs text-slate-400">Steps define what happens when this workflow triggers at checkout.</p>
        </div>
      ) : (
        <ol className="divide-y divide-slate-200">
          {sorted.map((step, i) => (
            <li key={step.id} className="flex items-start gap-3 px-6 py-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{step.name}</span>
                  <Badge variant={STEP_TYPE_BADGE[step.stepType]}>{STEP_TYPE_LABELS[step.stepType]}</Badge>
                  <span className="text-xs text-slate-400">{TRIGGER_LABELS[step.triggerCondition]}</span>
                  {!step.enabled && <Badge variant="gray">Disabled</Badge>}
                </div>
                {Object.keys(step.config).length > 0 && (
                  <p className="mt-0.5 font-mono text-xs text-slate-400 truncate">
                    {JSON.stringify(step.config)}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => { setEditStep(step); setActionError(null); }}
                  className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-white"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => { setDeleteStep(step); setActionError(null); }}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="px-6 py-3 border-t border-slate-200">
        <button
          type="button"
          onClick={() => setShowAddStep(true)}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          + Add step
        </button>
      </div>

      {showAddStep && (
        <StepFormModal
          workflowId={workflow.id}
          onSave={handleAddStep}
          onClose={() => setShowAddStep(false)}
        />
      )}
      {editStep && (
        <StepFormModal
          workflowId={workflow.id}
          initial={editStep}
          onSave={handleEditStep}
          onClose={() => setEditStep(null)}
        />
      )}
      {deleteStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteStep(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-950">Remove &ldquo;{deleteStep.name}&rdquo;?</h2>
            <p className="mt-2 text-sm text-slate-600">This step will be permanently removed from the workflow.</p>
            {actionError && <p className="mt-3 text-sm text-red-700">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteStep(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleDeleteStep} disabled={deleting} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                {deleting ? "Removing…" : "Remove step"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Workflow Row ──────────────────────────────────────────────────────────────

function WorkflowRow({
  workflow,
  onReload,
}: {
  workflow: WorkflowDefinition;
  onReload: () => void;
}) {
  const [expanded, setExpanded]     = useState(false);
  const [showEdit, setShowEdit]     = useState(false);
  const [toggling, setToggling]     = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleToggle = async () => {
    setToggling(true);
    try {
      await apiPatch(`/api/v1/workflows/${workflow.id}`, { enabled: !workflow.enabled });
      onReload();
    } catch { /* non-fatal */ } finally { setToggling(false); }
  };

  const handleEdit = async (body: { name: string; description?: string }) => {
    await apiPatch(`/api/v1/workflows/${workflow.id}`, body);
    onReload();
  };

  const handleDelete = async () => {
    setDeleting(true); setActionError(null);
    try {
      await apiDelete(`/api/v1/workflows/${workflow.id}`);
      onReload();
    } catch (ex) {
      setActionError(ex instanceof ApiResponseError ? ex.message : "Delete failed.");
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="divide-y divide-slate-100">
        <div className="flex items-center gap-4 px-4 py-4 hover:bg-slate-50 transition-colors">
          {/* Expand toggle */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-slate-400 hover:text-slate-600 transition-transform"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-950">{workflow.name}</span>
              <Badge variant={workflow.enabled ? "green" : "gray"}>
                {workflow.enabled ? "Active" : "Inactive"}
              </Badge>
              <span className="text-xs text-slate-400">
                {workflow.steps.length} {workflow.steps.length === 1 ? "step" : "steps"}
              </span>
            </div>
            {workflow.description && (
              <p className="mt-0.5 text-sm text-slate-500 truncate">{workflow.description}</p>
            )}
            <p className="mt-0.5 text-xs text-slate-400">Updated {fmtDate(workflow.updatedAt)}</p>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Enable/disable toggle */}
            <button
              type="button"
              onClick={handleToggle}
              disabled={toggling}
              aria-label={workflow.enabled ? "Disable workflow" : "Enable workflow"}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 ${
                workflow.enabled ? "bg-blue-600" : "bg-slate-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform ${
                  workflow.enabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setShowDelete(true)}
              className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Steps panel */}
        {expanded && (
          <StepsPanel workflow={workflow} onReload={onReload} />
        )}
      </div>

      {showEdit && (
        <WorkflowFormModal
          initial={workflow}
          onSave={handleEdit}
          onClose={() => setShowEdit(false)}
        />
      )}

      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowDelete(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-950">Delete &ldquo;{workflow.name}&rdquo;?</h2>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently remove the workflow and all its steps. Active checkouts using this workflow will not be affected.
            </p>
            {actionError && <p className="mt-3 text-sm text-red-700">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowDelete(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleDelete} disabled={deleting} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                {deleting ? "Deleting…" : "Delete workflow"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (body: { name: string; description?: string }) => {
    await apiPost("/api/v1/workflows", body);
    await load();
  };

  const activeCount   = workflows.filter((w) => w.enabled).length;
  const inactiveCount = workflows.filter((w) => !w.enabled).length;

  return (
    <EnterpriseShell
      active="workflows"
      title="Workflows"
      subtitle="Automate checkout steps and compliance gates"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-5 sm:px-6">

        {/* Summary chips */}
        {!loading && !error && workflows.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {[
              { label: "Active",   count: activeCount,   color: "bg-green-50 text-green-700 ring-1 ring-green-200" },
              { label: "Inactive", count: inactiveCount, color: "bg-slate-50 text-slate-600 ring-1 ring-slate-200" },
            ].map(({ label, count, color }) => (
              <span key={label} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${color}`}>
                <span className="text-base font-semibold">{count}</span> {label}
              </span>
            ))}
          </div>
        )}

        <Card className="overflow-hidden p-0">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Workflow definitions</h2>
              <p className="text-sm text-slate-500">
                {!loading && `${workflows.length} ${workflows.length === 1 ? "workflow" : "workflows"}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              + New workflow
            </button>
          </div>

          {loading ? (
            <TableSkeleton headers={["Name", "Trigger", "Steps", "Status", ""]} rows={5} />
          ) : error ? (
            <div className="px-4 py-6">
              <p role="alert" className="text-sm text-red-700">{error}</p>
            </div>
          ) : workflows.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <p className="text-sm font-medium text-slate-700">No workflows yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Create a workflow to automate checkout steps like age verification, loyalty capture, or custom prompts.
              </p>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create first workflow
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {workflows.map((wf) => (
                <WorkflowRow key={wf.id} workflow={wf} onReload={load} />
              ))}
            </div>
          )}
        </Card>

        {/* Info callout */}
        {!loading && workflows.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <span className="font-medium">How workflows fire: </span>
            Each workflow runs at the point-of-sale when its trigger condition is met (e.g. an age-restricted product is added to a cart).
            Steps execute in order — a Gate step can block the transaction until the condition is cleared.
          </div>
        )}
      </div>

      {showCreate && (
        <WorkflowFormModal
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </EnterpriseShell>
  );
}
