/**
 * Keyset (cursor) pagination — the shared primitive for list endpoints.
 *
 * Offset pagination skips O(n) rows and shifts under concurrent inserts;
 * keyset pagination seeks directly via `(created_at, id) < (cursor)` using the
 * existing (tenant_id, <timestamp>) indexes, and stays stable while rows are
 * added. Cursors are opaque base64url tokens encoding only values the caller
 * already saw on the previous page.
 */

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
}

export interface CursorKey {
  at: number;
  id: string;
}

export function clampLimit(limit: number | undefined, def = 50, max = 200): number {
  if (!limit || limit <= 0 || Number.isNaN(limit)) return def;
  return Math.min(Math.floor(limit), max);
}

export function decodeCursor(cursor?: string): CursorKey | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString()) as CursorKey;
    if (typeof parsed?.at === "number" && typeof parsed?.id === "string") return parsed;
  } catch { /* malformed cursor → treat as first page */ }
  return null;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

/** Build the page envelope: nextCursor is set only when the page is full. */
export function toPage<T extends Record<string, unknown>>(
  items: T[],
  limit: number,
  atField: keyof T,
): CursorPage<T> {
  const last = items[items.length - 1];
  const nextCursor =
    items.length === limit && last
      ? encodeCursor({ at: Number(last[atField]), id: String(last["id"]) })
      : null;
  return { items, nextCursor, limit };
}
