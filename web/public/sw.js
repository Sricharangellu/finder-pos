// Ascend — offline shell service worker.
// INF-8: adds Background Sync for checkout outbox replay.
//
// Strategies:
//   • _next/static/** — cache-first (immutable hashed filenames)
//   • Navigation requests — network-first, fallback to cached shell
//   • /api/** — network-only (never cache API responses)
//   • sync: "checkout-replay" — drain IndexedDB outbox when online

const CACHE = "finder-pos-shell-v2";
const DB_NAME = "finder-pos-outbox";
const DB_VERSION = 1;
const STORE = "checkout_queue";

// Pages to pre-cache on install so the app shell loads offline.
const SHELL = ["/", "/login", "/terminal", "/sell"];

// ── Lifecycle ────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// ── Fetch strategy ────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests via the cache strategy.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache API traffic.
  if (url.pathname.startsWith("/api/")) return;

  // Static Next.js assets — cache-first (content-hashed filenames).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE).then((c) => c.put(request, clone));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Navigation — network-first, shell fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached ?? caches.match("/")),
        ),
    );
  }
});

// ── Background Sync — checkout outbox replay ──────────────────────────────────

self.addEventListener("sync", (event) => {
  if (event.tag === "checkout-replay") {
    event.waitUntil(drainOutbox());
  }
});

// Also listen for postMessage from the main thread (Safari / Firefox fallback).
self.addEventListener("message", (event) => {
  if (event.data?.type === "DRAIN_OUTBOX") {
    drainOutbox().catch(() => {});
  }
});

// ── IndexedDB helpers (duplicated from offlineOutbox.ts for SW scope) ─────────

function openOutboxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () =>
      resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, item) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db, id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function drainOutbox() {
  let db;
  try {
    db = await openOutboxDb();
    const items = await idbGetAll(db);

    for (const item of items) {
      try {
        const res = await fetch(item.url, {
          method: item.method,
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": item.id,
            ...(item.authToken
              ? { Authorization: `Bearer ${item.authToken}` }
              : {}),
          },
          body: item.body,
        });

        if (res.ok) {
          await idbDelete(db, item.id);
          // Notify open terminal tabs that an item was replayed.
          const clients = await self.clients.matchAll({ type: "window" });
          for (const client of clients) {
            client.postMessage({ type: "OUTBOX_ITEM_REPLAYED", id: item.id });
          }
        } else if (res.status >= 400 && res.status < 500) {
          // Permanent error — remove and notify with failure.
          await idbDelete(db, item.id);
          const clients = await self.clients.matchAll({ type: "window" });
          for (const client of clients) {
            client.postMessage({
              type: "OUTBOX_ITEM_FAILED",
              id: item.id,
              status: res.status,
            });
          }
        } else {
          // Server/network error — increment retry, leave in queue.
          await idbPut(db, { ...item, retryCount: (item.retryCount ?? 0) + 1 });
        }
      } catch {
        // Network error — leave item in queue for next sync event.
        await idbPut(db, { ...item, retryCount: (item.retryCount ?? 0) + 1 });
      }
    }
  } finally {
    db?.close();
  }
}
