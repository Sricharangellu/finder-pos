"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { apiGet, apiPost, apiPatch, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { GolfMember, MembershipTier } from "@/api-client/types";
import { fmtDate } from "@/lib/date";

type BadgeVariant = "green" | "yellow" | "red" | "gray" | "blue" | "purple";

const TIER_BADGE: Record<MembershipTier, BadgeVariant> = {
  standard: "gray",
  premium: "blue",
  vip: "purple",
  corporate: "green",
};

interface MembersResponse { items: GolfMember[]; total: number; }

interface MemberFormState {
  name: string;
  email: string;
  phone: string;
  tier: MembershipTier;
  handicap: string;
  notes: string;
  expires_at: string;
}

const BLANK_FORM: MemberFormState = {
  name: "", email: "", phone: "", tier: "standard",
  handicap: "", notes: "",
  expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
};

function memberInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function membershipExpired(m: GolfMember) {
  return m.expires_at !== null && m.expires_at < Date.now();
}

function membershipExpiringSoon(m: GolfMember) {
  return m.expires_at !== null && m.expires_at > Date.now() && m.expires_at < Date.now() + 30 * 86_400_000;
}

function MemberModal({ member, onClose, onSaved }: {
  member?: GolfMember;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!member;
  const [form, setForm] = useState<MemberFormState>(member ? {
    name: member.name,
    email: member.email,
    phone: member.phone ?? "",
    tier: member.tier,
    handicap: member.handicap != null ? String(member.handicap) : "",
    notes: member.notes ?? "",
    expires_at: member.expires_at ? new Date(member.expires_at).toISOString().slice(0, 10) : "",
  } : { ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = (k: keyof MemberFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    const body = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      tier: form.tier,
      handicap: form.handicap ? Number(form.handicap) : null,
      notes: form.notes.trim() || null,
      expires_at: form.expires_at ? new Date(form.expires_at).getTime() : null,
    };
    try {
      if (isEdit) {
        await apiPatch(`/api/v1/golf/members/${member!.id}`, body);
      } else {
        await apiPost("/api/v1/golf/members", body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to save member.");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">{isEdit ? "Edit Member" : "Add Member"}</h2>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form id="member-form" onSubmit={submit} className="flex-1 overflow-y-auto flex flex-col gap-3 px-5 py-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="mf-name">Full Name *</label>
            <input id="mf-name" type="text" value={form.name} onChange={field("name")} required
                   className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="mf-email">Email *</label>
              <input id="mf-email" type="email" value={form.email} onChange={field("email")} required
                     className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="mf-phone">Phone</label>
              <input id="mf-phone" type="tel" value={form.phone} onChange={field("phone")}
                     className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="mf-tier">Tier</label>
              <select id="mf-tier" value={form.tier} onChange={field("tier")}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600">
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
                <option value="vip">VIP</option>
                <option value="corporate">Corporate</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="mf-hcp">Handicap</label>
              <input id="mf-hcp" type="number" step="0.1" min="0" max="54" value={form.handicap} onChange={field("handicap")}
                     placeholder="Optional"
                     className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="mf-exp">Membership Expires</label>
            <input id="mf-exp" type="date" value={form.expires_at} onChange={field("expires_at")}
                   className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="mf-notes">Notes</label>
            <textarea id="mf-notes" rows={2} value={form.notes} onChange={field("notes")}
                      className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
        </form>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" form="member-form" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Member"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function GolfMembersPage() {
  const [members, setMembers] = useState<GolfMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"new" | GolfMember | null>(null);
  const [filterTier, setFilterTier] = useState("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<MembersResponse>("/api/v1/golf/members");
      setMembers(data.items ?? []);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load members.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    let list = members;
    if (filterTier !== "all") list = list.filter(m => m.tier === filterTier);
    if (q.trim()) {
      const lq = q.toLowerCase();
      list = list.filter(m =>
        m.name.toLowerCase().includes(lq) ||
        m.email.toLowerCase().includes(lq) ||
        m.membership_number.toLowerCase().includes(lq),
      );
    }
    return list;
  }, [members, filterTier, q]);

  const expiring = members.filter(membershipExpiringSoon).length;
  const expired = members.filter(membershipExpired).length;

  return (
    <EnterpriseShell active="golf-members" title="Members" subtitle="Membership management"
      contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">

        {/* Sub-nav */}
        <div className="flex items-center gap-2 flex-wrap">
          <a href="/golf" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Tee Sheet</a>
          <a href="/golf/bookings" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Bookings</a>
          <a href="/golf/members" className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white">Members</a>
          <a href="/golf/pro-shop" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Pro Shop</a>
        </div>

        {/* Alerts */}
        {(expiring > 0 || expired > 0) && (
          <div className="flex flex-wrap gap-2">
            {expired > 0 && (
              <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-2 text-sm text-red-700">
                {expired} membership{expired !== 1 ? "s" : ""} expired — renewal needed
              </div>
            )}
            {expiring > 0 && (
              <div role="alert" className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-2 text-sm text-amber-700">
                {expiring} membership{expiring !== 1 ? "s" : ""} expiring within 30 days
              </div>
            )}
          </div>
        )}

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2">
          {(["all", "standard", "premium", "vip", "corporate"] as const).map(t => {
            const count = t === "all" ? members.length : members.filter(m => m.tier === t).length;
            return (
              <button key={t}
                      onClick={() => setFilterTier(t)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        filterTier === t ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}>
                {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)} ({count})
              </button>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <input type="search" placeholder="Search name, email, number…" value={q} onChange={e => setQ(e.target.value)}
                 className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          <Button variant="primary" size="sm" onClick={() => setModal("new")}>+ Add Member</Button>
        </div>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-14 text-center">
            <p className="text-sm font-medium text-slate-600">No members found</p>
            <button onClick={() => setModal("new")}
                    className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Add First Member
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Member</th>
                  <th className="px-4 py-3 text-left">Tier</th>
                  <th className="px-4 py-3 text-left">Handicap</th>
                  <th className="px-4 py-3 text-left">Rounds</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-left">Expires</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map(m => {
                  const expired = membershipExpired(m);
                  const expiringSoon = membershipExpiringSoon(m);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                            {memberInitials(m.name)}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{m.name}</p>
                            <p className="text-xs text-slate-400">{m.membership_number} · {m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={TIER_BADGE[m.tier]}>{m.tier.charAt(0).toUpperCase() + m.tier.slice(1)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {m.handicap != null ? m.handicap : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{m.rounds_played}</td>
                      <td className="px-4 py-3 text-right">
                        {m.outstanding_cents > 0
                          ? <span className="font-medium text-amber-700">{formatMoney(m.outstanding_cents)}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {m.expires_at == null ? (
                          <span className="text-slate-400 text-xs">No expiry</span>
                        ) : expired ? (
                          <span className="text-xs font-medium text-red-600">Expired</span>
                        ) : expiringSoon ? (
                          <span className="text-xs font-medium text-amber-600">
                            {fmtDate(m.expires_at)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">{fmtDate(m.expires_at)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setModal(m)}
                                className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal !== null && (
        <MemberModal
          member={modal === "new" ? undefined : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); void load(); }}
        />
      )}
    </EnterpriseShell>
  );
}
