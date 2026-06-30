"use client";

import { useState, useCallback } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { apiGet, apiPost } from "@/api-client/client";
import type { useToast } from "@/components/Toast";

interface CustomerNote {
  id: string;
  note_type: string;
  content: string;
  created_at: string;
}

const NOTE_TYPE_BADGE: Record<string, string> = {
  general: "bg-gray-100 text-gray-700",
  billing: "bg-blue-100 text-blue-700",
  compliance: "bg-yellow-100 text-yellow-800",
  internal: "bg-purple-100 text-purple-700",
};

export function NotesPanel({
  customerId,
  canEdit,
  addToast,
}: {
  customerId: string;
  canEdit: boolean;
  addToast: ReturnType<typeof useToast>["addToast"];
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CustomerNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState("");
  const [noteType, setNoteType] = useState("general");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: CustomerNote[] }>(`/api/v1/customers/${customerId}/notes`)
      .then((r) => setItems(r.items ?? []))
      .catch(() => setItems([]))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [customerId]);

  const toggle = () => {
    setOpen((v) => {
      if (!v && !loaded) load();
      return !v;
    });
  };

  const addNote = async () => {
    if (!content.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/api/v1/customers/${customerId}/notes`, {
        note_type: noteType,
        content: content.trim(),
      });
      setContent("");
      setNoteType("general");
      load();
      addToast({ title: "Note added", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-950">Notes</span>
          {loaded && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {items.length}
            </span>
          )}
        </div>
        <svg
          aria-hidden="true"
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-200">
          {loading && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">Loading…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="px-4 py-4 text-sm text-slate-400">No notes yet.</div>
          )}
          {items.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {items.map((note) => (
                <li key={note.id} className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${NOTE_TYPE_BADGE[note.note_type] ?? "bg-gray-100 text-gray-700"}`}
                  >
                    {note.note_type}
                  </span>
                  <p className="flex-1 text-sm text-slate-700">{note.content}</p>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(note.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="space-y-3 border-t border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex gap-3">
                <select
                  value={noteType}
                  onChange={(e) => setNoteType(e.target.value)}
                  className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                >
                  <option value="general">General</option>
                  <option value="billing">Billing</option>
                  <option value="compliance">Compliance</option>
                  <option value="internal">Internal</option>
                </select>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={2}
                  placeholder="Add a note…"
                  className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy}
                  disabled={!content.trim()}
                  onClick={() => void addNote()}
                >
                  Add note
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
