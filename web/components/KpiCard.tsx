"use client";

interface SparklinePoint {
  value: number;
}

interface KpiCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  /** +/- percentage vs prior period */
  trend?: { value: number; label: string };
  tone?: "blue" | "green" | "amber" | "red" | "neutral";
  loading?: boolean;
  /** Last N data points for the sparkline (renders when ≥ 2 points provided) */
  sparkline?: SparklinePoint[];
  /** Deep-link for "View report" — renders a small link below the KPI */
  reportHref?: string;
}

const TONE_ICON: Record<string, string> = {
  blue:    "bg-blue-50 text-blue-600",
  green:   "bg-emerald-50 text-emerald-600",
  amber:   "bg-amber-50 text-amber-600",
  red:     "bg-red-50 text-red-600",
  neutral: "bg-slate-100 text-[var(--color-text-secondary)]",
};

const TONE_SPARK: Record<string, string> = {
  blue:    "#1890FF",
  green:   "#52C41A",
  amber:   "#FAAD14",
  red:     "#FF4D4F",
  neutral: "#0137FC",
};

function Sparkline({ points, color }: { points: SparklinePoint[]; color: string }) {
  if (points.length < 2) return null;
  const W = 64;
  const H = 24;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const xs = vals.map((_, i) => (i / (vals.length - 1)) * W);
  const ys = vals.map((v) => H - ((v - min) / range) * (H - 2) - 1);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");
  const fill = `${d} L${W},${H} L0,${H} Z`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="shrink-0">
      <path d={fill} fill={color} fillOpacity={0.12} />
      <path d={d} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function KpiCard({
  title,
  value,
  icon,
  trend,
  tone = "neutral",
  loading = false,
  sparkline,
  reportHref,
}: KpiCardProps) {
  const isPositive = trend ? trend.value >= 0 : true;

  return (
    <div className="rounded-lg border border-[var(--color-table-border)] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        {icon ? (
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}>
            {icon}
          </div>
        ) : <div />}
        {sparkline && !loading && (
          <Sparkline points={sparkline} color={TONE_SPARK[tone] ?? "#0137FC"} />
        )}
      </div>

      {loading ? (
        <div className="h-8 w-3/4 animate-pulse rounded bg-slate-200 mt-1" />
      ) : (
        <p className="text-2xl font-bold tabular-nums text-[var(--color-text-primary)]">{value}</p>
      )}
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">{title}</p>

      <div className="mt-2 flex items-center justify-between">
        {trend && !loading ? (
          <div className="flex items-center gap-1">
            <svg
              width="11" height="11" viewBox="0 0 12 12" fill="none"
              className={isPositive ? "text-success-500" : "text-danger-500"}
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              {isPositive
                ? <path d="M2 9L6 3L10 9" />
                : <path d="M2 3L6 9L10 3" />}
            </svg>
            <span className={`text-xs font-semibold ${isPositive ? "text-success-600" : "text-danger-500"}`}>
              {isPositive ? "+" : ""}{trend.value.toFixed(1)}%
            </span>
            <span className="text-xs text-[var(--color-text-secondary)]">{trend.label}</span>
          </div>
        ) : <div />}

        {reportHref && !loading && (
          <a
            href={reportHref}
            className="text-[11px] font-medium text-brand-600 hover:underline"
          >
            View report →
          </a>
        )}
      </div>
    </div>
  );
}
