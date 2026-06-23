"use client";

/**
 * FE-30: useRealtimeStream — subscribes to GET /api/v1/stream (SSE).
 *
 * Receives domain events pushed by the backend EventBus and calls the
 * provided handler. Automatically reconnects on disconnect with
 * exponential backoff (max 30s). Closes on unmount.
 *
 * Supported events (sent by the SSE broker in app.ts):
 *   order.created, order.completed, payment.captured,
 *   inventory.low_stock, notification.created
 *
 * Usage:
 *   useRealtimeStream((event) => {
 *     if (event.type === "order.created") refetchOrders();
 *   });
 */

import { useEffect, useRef } from "react";

export interface StreamEvent {
  type: string;
  data: Record<string, unknown>;
}

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS  = 30_000;

export function useRealtimeStream(
  onEvent: (event: StreamEvent) => void,
  enabled = true,
) {
  const onEventRef  = useRef(onEvent);
  const esRef       = useRef<EventSource | null>(null);
  const retryRef    = useRef(0);
  const cleanupRef  = useRef<() => void>(() => {});

  // Keep callback ref up-to-date without triggering reconnect.
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !("EventSource" in window)) return;

    let destroyed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;
      // EventSource sends cookies automatically (withCredentials=true for cross-origin).
      // The backend reads the JWT from the Authorization header via the cookie-based
      // auth flow set up in BE-31. For same-origin requests, cookies are sent natively.
      const url = `/api/v1/stream`;
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      es.onopen = () => { retryRef.current = 0; };

      es.onerror = () => {
        es.close();
        if (destroyed) return;
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** retryRef.current, BACKOFF_MAX_MS);
        retryRef.current++;
        retryTimer = setTimeout(connect, delay);
      };

      // Listen for all named events the backend sends.
      const EVENTS = [
        "order.created", "order.completed", "payment.captured",
        "inventory.adjusted", "inventory.low_stock",
        "notification.created", "store_credit.debited",
      ];

      for (const type of EVENTS) {
        es.addEventListener(type, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as Record<string, unknown>;
            onEventRef.current({ type, data });
          } catch {
            // Ignore malformed events
          }
        });
      }
    }

    connect();

    cleanupRef.current = () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      esRef.current?.close();
      esRef.current = null;
    };

    return cleanupRef.current;
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
