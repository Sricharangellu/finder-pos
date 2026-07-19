/**
 * Offline sync outbox.
 *
 * When the device goes offline, sales are stored here and replayed in order
 * when connectivity resumes. Mirrors the backend's sync_queue table.
 *
 * Storage: localStorage (survives tab closes; cleared on replay success).
 * Each item carries a stable client-side id so the UI can track status.
 */

import type { SyncQueueItem } from "@/api-client/types";

const STORAGE_KEY = "ascend_sync_outbox";

function readQueue(): SyncQueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SyncQueueItem[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: SyncQueueItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage quota — best effort
  }
}

function makeId(): string {
  return `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Enqueue a sale for offline replay. Returns the item id. */
export function enqueue(
  type: SyncQueueItem["type"],
  payload: unknown
): string {
  const item: SyncQueueItem = {
    id: makeId(),
    type,
    payload,
    createdAt: Date.now(),
    retryCount: 0,
  };
  const queue = readQueue();
  queue.push(item);
  writeQueue(queue);
  return item.id;
}

/** Returns all pending items in insertion order. */
export function getQueue(): SyncQueueItem[] {
  return readQueue();
}

/** Remove an item from the queue (called on successful replay). */
export function dequeue(id: string): void {
  const queue = readQueue().filter((i) => i.id !== id);
  writeQueue(queue);
}

/** Increment the retry counter for an item. */
export function incrementRetry(id: string): void {
  const queue = readQueue().map((i) =>
    i.id === id ? { ...i, retryCount: i.retryCount + 1 } : i
  );
  writeQueue(queue);
}

/** Remove all items (used in tests / hard-reset). */
export function clearQueue(): void {
  writeQueue([]);
}

/** Count of pending items. */
export function pendingCount(): number {
  return readQueue().length;
}
