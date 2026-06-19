/**
 * Orchestration Metrics
 *
 * In-process counters and histograms for monitoring workflow health.
 * These are exposed via the existing /metrics endpoint (Prometheus-compatible).
 * In Year 2, replace with OpenTelemetry SDK metrics.
 */

interface Counter {
  value: number;
  labels: Record<string, string>;
}

interface Histogram {
  count: number;
  sum: number;
  buckets: number[];
  labels: Record<string, string>;
}

class OrchestrationMetricsRegistry {
  private counters = new Map<string, Counter>();
  private histograms = new Map<string, Histogram>();

  incrementCounter(name: string, labels: Record<string, string> = {}, by = 1): void {
    const key = this.labelKey(name, labels);
    const existing = this.counters.get(key) ?? { value: 0, labels };
    existing.value += by;
    this.counters.set(key, existing);
  }

  recordHistogram(name: string, valueMs: number, labels: Record<string, string> = {}): void {
    const key = this.labelKey(name, labels);
    const existing = this.histograms.get(key) ?? {
      count: 0, sum: 0, buckets: [10, 50, 100, 250, 500, 1000, 5000, 10000], labels,
    };
    existing.count += 1;
    existing.sum += valueMs;
    this.histograms.set(key, existing);
  }

  snapshot(): { counters: Record<string, number>; histograms: Record<string, { count: number; avg: number }> } {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v.value;
    const histograms: Record<string, { count: number; avg: number }> = {};
    for (const [k, v] of this.histograms) histograms[k] = { count: v.count, avg: v.count > 0 ? v.sum / v.count : 0 };
    return { counters, histograms };
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }

  private labelKey(name: string, labels: Record<string, string>): string {
    const lblStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return lblStr ? `${name}{${lblStr}}` : name;
  }
}

export const OrchestrationMetrics = new OrchestrationMetricsRegistry();

/** Helpers for common metric names. */
export const MetricNames = {
  WORKFLOW_STARTED: "orchestration_workflow_started_total",
  WORKFLOW_COMPLETED: "orchestration_workflow_completed_total",
  WORKFLOW_FAILED: "orchestration_workflow_failed_total",
  WORKFLOW_COMPENSATED: "orchestration_workflow_compensated_total",
  WORKFLOW_DURATION_MS: "orchestration_workflow_duration_ms",
  STEP_DURATION_MS: "orchestration_step_duration_ms",
  JOB_PROCESSED: "orchestration_job_processed_total",
  JOB_FAILED: "orchestration_job_failed_total",
} as const;
