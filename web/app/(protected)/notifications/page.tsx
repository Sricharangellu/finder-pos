"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { apiGet, apiPost, apiPatch, ApiResponseError } from "@/api-client/client";
import type { Notification, NotificationsResponse, NotificationSeverity, NotificationType } from "@/api-client/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEV_BADGE: Record<NotificationSeverity, "blue" | "yellow" | "red"> = {
  info: "blue",
  warning: "yellow",
  critical: "red",
};

const TYPE_LABELS: Record<NotificationType, string> = {
  low_stock: "Low Stock",
  payment_failed: "Payment Failed",
  new_order: "New Order",
  order_fulfilled: "Fulfilled",
  purchase_order_received: "PO Received",
  sync_error: "Sync Error",
  system: "System",
};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = filter === "unread" ? "?unread=true" : "";
      const data = await apiGet<NotificationsResponse>(`/api/v1/notifications${params}`);
      setItems(data.items);
      setUnreadCount(data.unread_count);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load notifications.");
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const markRead = async (id: string) => {
    try {
      await apiPatch(`/api/v1/notifications/${id}/read`, {});
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await apiPost("/api/v1/notifications/mark-all-read", {});
      setItems(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } finally { setMarkingAll(false); }
  };

  return (
    <EnterpriseShell active="notifications" title="Notifications" subtitle="System alerts and activity" contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-5 sm:px-6">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </span>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {(["all", "unread"] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 capitalize transition-colors ${filter === f ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          {unreadCount > 0 && (
            <Button size="sm" variant="secondary" loading={markingAll} onClick={() => void markAllRead()}>
              Mark all as read
            </Button>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3">{error}</p>}

        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
            <p className="text-sm text-gray-400">{filter === "unread" ? "No unread notifications." : "No notifications yet."}</p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="space-y-2">
            {items.map(n => (
              <div
                key={n.id}
                className={`relative rounded-xl border px-5 py-4 transition-colors ${n.read ? "border-gray-200 bg-white" : "border-blue-200 bg-blue-50"}`}
              >
                {!n.read && (
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-blue-500" aria-label="Unread" />
                )}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 pl-2">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm text-gray-900">{n.title}</span>
                      <Badge variant={SEV_BADGE[n.severity]}>{n.severity}</Badge>
                      <Badge variant="gray">{TYPE_LABELS[n.type]}</Badge>
                    </div>
                    <p className="text-sm text-gray-600">{n.body}</p>
                    <p className="text-xs text-gray-400 mt-1">{relativeTime(n.created_at)}</p>
                  </div>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => void markRead(n.id)}
                      className="shrink-0 text-xs text-blue-600 hover:underline"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
