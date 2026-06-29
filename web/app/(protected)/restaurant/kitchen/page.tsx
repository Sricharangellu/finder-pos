"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { apiGet, apiPatch } from "@/api-client/client";
import type { KitchenQueueLine, KitchenQueueResponse, CourseType, CourseStatus } from "@/api-client/types";
import { clsx } from "clsx";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const COURSE_ORDER: CourseType[] = ["appetizer", "main", "dessert", "drinks"];

const COURSE_LABEL: Record<CourseType, string> = {
  appetizer: "Appetizers",
  main:      "Mains",
  dessert:   "Desserts",
  drinks:    "Drinks",
};

const COURSE_COLOR: Record<CourseType, string> = {
  appetizer: "border-amber-400 bg-amber-50",
  main:      "border-blue-400 bg-blue-50",
  dessert:   "border-purple-400 bg-purple-50",
  drinks:    "border-emerald-400 bg-emerald-50",
};

const STATUS_BADGE: Record<CourseStatus, BadgeVariant> = {
  pending: "yellow",
  cooking: "blue",
  ready:   "green",
};

const STATUS_LABEL: Record<CourseStatus, string> = {
  pending: "Pending",
  cooking: "Cooking",
  ready:   "Ready",
};

const BUMP_LABEL: Record<CourseStatus, string> = {
  pending: "Start Cooking",
  cooking: "Mark Ready",
  ready:   "Done",
};

export default function KitchenPage() {
  const [lines, setLines] = useState<KitchenQueueLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bumping, setBumping] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CourseStatus | "all">("all");
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<KitchenQueueResponse>("/api/v1/restaurant/kitchen/queue");
      setLines(data.items ?? []);
      setLastRefresh(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function bump(lineId: string) {
    setBumping(lineId);
    try {
      await apiPatch(`/api/v1/restaurant/kitchen/${lineId}/bump`, {});
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to bump");
    } finally {
      setBumping(null);
    }
  }

  const visible = statusFilter === "all" ? lines.filter(l => l.status !== "ready") : lines.filter(l => l.status === statusFilter);

  const grouped = COURSE_ORDER.reduce<Record<CourseType, KitchenQueueLine[]>>((acc, c) => {
    acc[c] = visible.filter(l => l.course === c);
    return acc;
  }, { appetizer: [], main: [], dessert: [], drinks: [] });

  const pendingCount = lines.filter(l => l.status === "pending").length;
  const cookingCount = lines.filter(l => l.status === "cooking").length;
  const readyCount   = lines.filter(l => l.status === "ready").length;

  return (
    <EnterpriseShell active="restaurant-kitchen" title="Kitchen Display" subtitle="Active order queue — auto-refreshes every 10s">
      <div className="flex flex-col gap-4 p-6">
        {/* Stats + controls row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
              <p className="text-xs text-[rgba(0,0,0,0.45)]">Pending</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{cookingCount}</p>
              <p className="text-xs text-[rgba(0,0,0,0.45)]">Cooking</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-600">{readyCount}</p>
              <p className="text-xs text-[rgba(0,0,0,0.45)]">Ready</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded border border-[#D9D9D9] bg-white p-0.5">
              {(["all", "pending", "cooking", "ready"] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s as CourseStatus | "all")}
                  className={clsx(
                    "rounded px-3 py-1 text-xs font-medium transition-colors",
                    statusFilter === s ? "bg-brand-600 text-white" : "text-[rgba(0,0,0,0.65)] hover:bg-[#F5F5F5]",
                  )}
                >
                  {s === "all" ? "Active" : STATUS_LABEL[s as CourseStatus]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1 rounded border border-[#D9D9D9] bg-white px-3 py-1.5 text-xs text-[rgba(0,0,0,0.65)] hover:bg-[#F5F5F5]"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
              Refresh
            </button>
          </div>
        </div>

        {loading && <p className="text-center text-sm text-[rgba(0,0,0,0.45)] py-12">Loading kitchen queue…</p>}
        {error && <p className="text-center text-sm text-red-600 py-12">{error}</p>}

        {!loading && visible.length === 0 && (
          <div className="rounded-lg border-2 border-dashed border-[#D9D9D9] p-12 text-center">
            <p className="text-sm text-[rgba(0,0,0,0.45)]">No active orders in the kitchen queue.</p>
            <p className="text-xs text-[rgba(0,0,0,0.35)] mt-1">Refreshed {new Date(lastRefresh).toLocaleTimeString()}</p>
          </div>
        )}

        {/* Course columns */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {COURSE_ORDER.map(course => {
            const courseLines = grouped[course];
            if (courseLines.length === 0 && statusFilter !== "all") return null;
            return (
              <div key={course}>
                <div className={clsx("mb-3 flex items-center justify-between rounded-t-lg border-l-4 px-3 py-2", COURSE_COLOR[course])}>
                  <span className="font-semibold text-sm">{COURSE_LABEL[course]}</span>
                  <span className="text-xs text-[rgba(0,0,0,0.45)]">{courseLines.length} item{courseLines.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="space-y-2">
                  {courseLines.map(line => (
                    <div key={line.id} className="rounded-lg border border-[#E8E8E8] bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-[rgba(0,0,0,0.88)] truncate">{line.product_name}</p>
                          <p className="text-xs text-[rgba(0,0,0,0.45)]">
                            × {line.quantity}
                            {line.table_number && ` · Table ${line.table_number}`}
                          </p>
                        </div>
                        <Badge variant={STATUS_BADGE[line.status]} size="sm">{STATUS_LABEL[line.status]}</Badge>
                      </div>
                      {line.status !== "ready" && (
                        <button
                          type="button"
                          disabled={bumping === line.id}
                          onClick={() => void bump(line.id)}
                          className={clsx(
                            "mt-2 w-full rounded px-2 py-1.5 text-xs font-semibold transition-colors",
                            line.status === "pending"
                              ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                              : "bg-blue-100 text-blue-800 hover:bg-blue-200",
                            bumping === line.id && "opacity-50 cursor-not-allowed",
                          )}
                        >
                          {bumping === line.id ? "…" : BUMP_LABEL[line.status]}
                        </button>
                      )}
                      {line.status === "ready" && (
                        <p className="mt-1 text-center text-xs font-semibold text-emerald-600">Ready to serve</p>
                      )}
                    </div>
                  ))}
                  {courseLines.length === 0 && (
                    <p className="text-center text-xs text-[rgba(0,0,0,0.35)] py-4">No {COURSE_LABEL[course].toLowerCase()}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </EnterpriseShell>
  );
}
