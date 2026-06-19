"use client";

import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";

type BlueprintItem = {
  title: string;
  description: string;
  status?: "Ready" | "Planned" | "Needs API";
};

type ModuleBlueprintProps = {
  active:
    | "vendors"
    | "payments"
    | "returns"
    | "tax-compliance"
    | "integrations"
    | "imports-exports";
  title: string;
  subtitle: string;
  overview: string;
  workflows: BlueprintItem[];
  dataSections: BlueprintItem[];
  actions: string[];
};

const statusClass = {
  Ready: "border-success-200 bg-success-50 text-success-700",
  Planned: "border-slate-200 bg-slate-50 text-slate-600",
  "Needs API": "border-warning-200 bg-warning-50 text-warning-700",
};

export function ModuleBlueprint({
  active,
  title,
  subtitle,
  overview,
  workflows,
  dataSections,
  actions,
}: ModuleBlueprintProps) {
  return (
    <EnterpriseShell active={active} title={title} subtitle={subtitle} contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        <section className="rounded-md border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Enterprise POS module
              </p>
              <h1 className="mt-1 text-xl font-semibold text-slate-950">{title}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">{overview}</p>
            </div>
            <div className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700">
              Schema aligned
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <Card title="Primary Workflows" noPadding>
            <div className="divide-y divide-slate-100">
              {workflows.map((item) => (
                <BlueprintRow key={item.title} item={item} />
              ))}
            </div>
          </Card>

          <Card title="Action Surface" noPadding>
            <div className="grid gap-2 p-4">
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className="min-h-[40px] rounded-md border border-slate-200 bg-white px-3 text-left text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  {action}
                </button>
              ))}
            </div>
          </Card>
        </section>

        <Card title="Data Sections" noPadding>
          <div className="grid gap-px bg-slate-200 md:grid-cols-2 xl:grid-cols-3">
            {dataSections.map((item) => (
              <div key={item.title} className="bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-950">{item.title}</h2>
                  <StatusPill status={item.status ?? "Planned"} />
                </div>
                <p className="mt-2 text-sm leading-5 text-slate-500">{item.description}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </EnterpriseShell>
  );
}

function BlueprintRow({ item }: { item: BlueprintItem }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-950">{item.title}</h2>
        <p className="mt-1 text-sm leading-5 text-slate-500">{item.description}</p>
      </div>
      <StatusPill status={item.status ?? "Planned"} />
    </div>
  );
}

function StatusPill({ status }: { status: NonNullable<BlueprintItem["status"]> }) {
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass[status]}`}>
      {status}
    </span>
  );
}
