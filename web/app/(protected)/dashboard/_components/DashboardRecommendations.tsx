"use client";

import Link from "next/link";
import { Card } from "@/components/Card";

export type RecommendationSeverity = "critical" | "warning" | "info";

export interface DashboardRecommendation {
  id: string;
  signalCode: string | null;
  category: "setup" | "inventory" | "pricing" | "sales" | "expenses" | "profit";
  severity: RecommendationSeverity;
  title: string;
  detail: string;
  action: string;
  href: string;
  count: number;
  rank: number;
}

export interface RecommendationReport {
  ready: boolean;
  recommendations: DashboardRecommendation[];
  summary: { total: number; critical: number; warning: number; info: number };
  generatedAt: number;
  recentDays: number;
}

const SEVERITY_STYLES: Record<RecommendationSeverity, { badge: string; row: string; dot: string; label: string }> = {
  critical: {
    badge: "border-red-200 bg-red-50 text-red-700",
    row: "border-red-100 bg-red-50/70",
    dot: "bg-red-500",
    label: "Critical",
  },
  warning: {
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    row: "border-amber-100 bg-amber-50/70",
    dot: "bg-amber-500",
    label: "Warning",
  },
  info: {
    badge: "border-blue-200 bg-blue-50 text-blue-700",
    row: "border-blue-100 bg-blue-50/70",
    dot: "bg-blue-500",
    label: "Info",
  },
};

export function DashboardRecommendations({
  report,
  loading,
  error,
}: {
  report?: RecommendationReport;
  loading: boolean;
  error: string | null;
}) {
  const recommendations = [...(report?.recommendations ?? [])].sort((a, b) => a.rank - b.rank);
  const summary = report?.summary;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">What to do next</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Ranked actions from real setup, inventory, sales, expense, and profit signals.
          </p>
        </div>
        {summary && summary.total > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {summary.critical > 0 && <SummaryPill tone="critical" label={`${summary.critical} critical`} />}
            {summary.warning > 0 && <SummaryPill tone="warning" label={`${summary.warning} warning`} />}
            {summary.info > 0 && <SummaryPill tone="info" label={`${summary.info} info`} />}
          </div>
        )}
      </div>

      {loading && (
        <div role="status" aria-label="Loading recommendations" className="grid gap-2 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-100 bg-slate-50" />
          ))}
        </div>
      )}

      {!loading && error && (
        <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load recommendations.
        </p>
      )}

      {!loading && !error && recommendations.length === 0 && (
        <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
          No urgent actions right now. Finder will add recommendations when real setup, inventory, sales, expenses, or profit signals need attention.
        </p>
      )}

      {!loading && !error && recommendations.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-3">
          {recommendations.slice(0, 6).map((rec) => {
            const styles = SEVERITY_STYLES[rec.severity];
            return (
              <li key={rec.id} className={`flex min-h-[132px] flex-col rounded-lg border p-3 ${styles.row}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
                    <span className={`h-2 w-2 rounded-full ${styles.dot}`} aria-hidden="true" />
                    #{rec.rank} {rec.category}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles.badge}`}>
                    {styles.label}
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-950">{rec.title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">{rec.detail}</p>
                <div className="mt-auto pt-3">
                  <Link href={rec.href} className="text-sm font-semibold text-blue-700 hover:underline">
                    {rec.action}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function SummaryPill({ tone, label }: { tone: RecommendationSeverity; label: string }) {
  return (
    <span className={`rounded-full border px-2 py-1 font-semibold ${SEVERITY_STYLES[tone].badge}`}>
      {label}
    </span>
  );
}
