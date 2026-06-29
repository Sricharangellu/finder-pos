"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { StudentStatus, Student, StudentsResponse, FeeStatus, FeeRecord, FeeRecordsResponse } from "@/api-client/types";
import { clsx } from "clsx";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STUDENT_STATUS_BADGE: Record<StudentStatus, BadgeVariant> = {
  active:    "green",
  inactive:  "gray",
  graduated: "blue",
};

const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  active:    "Active",
  inactive:  "Inactive",
  graduated: "Graduated",
};

const FEE_STATUS_BADGE: Record<FeeStatus, BadgeVariant> = {
  pending: "yellow",
  paid:    "green",
  overdue: "red",
  waived:  "gray",
};

interface EnrollForm { name: string; email: string; phone: string; }
const EMPTY_ENROLL: EnrollForm = { name: "", email: "", phone: "" };

export default function EducationStudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StudentStatus | "all">("all");
  const [selected, setSelected] = useState<Student | null>(null);
  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [showEnroll, setShowEnroll] = useState(false);
  const [showFee, setShowFee] = useState(false);
  const [feeForm, setFeeForm] = useState({ description: "", amountCents: "" });
  const [enrollForm, setEnrollForm] = useState<EnrollForm>(EMPTY_ENROLL);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<StudentsResponse>("/api/v1/education/students");
      setStudents(data.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load students"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function loadFees(student: Student) {
    setSelected(student); setFees([]);
    try {
      const data = await apiGet<FeeRecordsResponse>(`/api/v1/education/students/${student.id}/fees`);
      setFees(data.items ?? []);
    } catch { setFees([]); }
  }

  async function enroll() {
    if (!enrollForm.name.trim() || !enrollForm.email.trim()) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/education/students", {
        name: enrollForm.name.trim(),
        email: enrollForm.email.trim(),
        phone: enrollForm.phone.trim() || undefined,
      });
      setShowEnroll(false); setEnrollForm(EMPTY_ENROLL); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  async function addFee() {
    if (!selected || !feeForm.description.trim() || !feeForm.amountCents) return;
    setSaving(true);
    try {
      await apiPost(`/api/v1/education/students/${selected.id}/fees`, {
        description: feeForm.description.trim(),
        amountCents: Math.round(parseFloat(feeForm.amountCents) * 100),
      });
      setShowFee(false); setFeeForm({ description: "", amountCents: "" });
      await loadFees(selected);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  async function payFee(feeId: string) {
    if (!selected) return;
    try {
      await apiPatch(`/api/v1/education/fees/${feeId}/pay`, { paymentMethod: "cash" });
      await loadFees(selected);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  const ALL_STATUSES: StudentStatus[] = ["active", "inactive", "graduated"];
  const counts = ALL_STATUSES.reduce<Record<string, number>>((a, s) => { a[s] = students.filter(st => st.status === s).length; return a; }, {});

  const filtered = students.filter(s => {
    const matchStatus = statusFilter === "all" || s.status === statusFilter;
    const matchSearch = search === "" || `${s.name} ${s.email ?? ""}`.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const totalPending = fees.filter(f => f.status === "pending" || f.status === "overdue").reduce((s, f) => s + f.amount_cents, 0);

  return (
    <EnterpriseShell active="education-students" title="Students" subtitle="Student enrollment & fee management">
      <div className="flex flex-col gap-6 p-6">
        <div className="grid grid-cols-3 gap-3">
          {ALL_STATUSES.map(s => (
            <Card key={s} className={clsx("p-4 cursor-pointer hover:shadow-md transition-shadow", statusFilter === s && "ring-2 ring-brand-500")}
              onClick={() => setStatusFilter(f => f === s ? "all" : s)}>
              <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">{STUDENT_STATUS_LABEL[s]}</p>
              <p className={clsx("mt-1 text-2xl font-bold", s === "active" && "text-green-600", statusFilter === s && "text-brand-600")}>{counts[s] ?? 0}</p>
            </Card>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <input type="text" placeholder="Search students…" value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 rounded border border-[#D9D9D9] px-3 py-1.5 text-sm" />
          <Button size="sm" onClick={() => setShowEnroll(true)}>+ Enroll Student</Button>
        </div>

        {loading && <TableSkeleton rows={6} cols={5} />}
        {error && <p className="text-red-600 text-sm py-4">{error}</p>}

        {!loading && (
          <div className="overflow-hidden rounded-lg border border-[#E8E8E8] bg-white">
            {filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-[rgba(0,0,0,0.45)]">No students found.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Phone</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Enrolled</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(st => (
                    <tr key={st.id} className="border-b border-[#F0F0F0] cursor-pointer hover:bg-[#FAFAFA]" onClick={() => void loadFees(st)}>
                      <td className="px-4 py-3 font-medium text-[rgba(0,0,0,0.88)]">{st.name}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{st.email ?? "—"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{st.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{st.enrolled_at ? new Date(st.enrolled_at).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3"><Badge variant={STUDENT_STATUS_BADGE[st.status]} size="sm">{STUDENT_STATUS_LABEL[st.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Student detail / fees modal */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
            <div className="w-full max-w-md rounded-xl bg-white shadow-2xl p-6 overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">{selected.name}</h3>
                  <p className="text-xs text-[rgba(0,0,0,0.45)]">{selected.email ?? ""}</p>
                </div>
                <Badge variant={STUDENT_STATUS_BADGE[selected.status]}>{STUDENT_STATUS_LABEL[selected.status]}</Badge>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">Fees {totalPending > 0 && <span className="text-red-600 ml-1">({formatMoney(totalPending)} due)</span>}</h4>
                  <Button size="sm" variant="secondary" onClick={() => setShowFee(true)}>+ Add Fee</Button>
                </div>
                {fees.length === 0
                  ? <p className="text-xs text-[rgba(0,0,0,0.35)]">No fee records.</p>
                  : (
                    <div className="space-y-1">
                      {fees.map(f => (
                        <div key={f.id} className="flex items-center justify-between text-xs rounded border border-[#F0F0F0] px-2 py-1.5">
                          <div>
                            <p className="font-medium">{f.description}</p>
                            <p className="text-[rgba(0,0,0,0.45)]">{formatMoney(f.amount_cents)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={FEE_STATUS_BADGE[f.status]} size="sm">{f.status}</Badge>
                            {(f.status === "pending" || f.status === "overdue") && (
                              <button type="button" onClick={() => void payFee(f.id)} className="text-xs text-brand-600 hover:underline">Pay</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                }
              </div>
              <button type="button" onClick={() => setSelected(null)} className="w-full rounded border border-[#D9D9D9] py-1.5 text-xs text-[rgba(0,0,0,0.45)] hover:bg-[#F5F5F5]">Close</button>
            </div>
          </div>
        )}

        {/* Add fee modal */}
        {showFee && selected && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowFee(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Add Fee — {selected.name}</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Description *</label>
                  <input type="text" placeholder="Tuition, Lab fee…" value={feeForm.description}
                    onChange={e => setFeeForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Amount ($) *</label>
                  <input type="number" min="0.01" step="0.01" placeholder="500.00" value={feeForm.amountCents}
                    onChange={e => setFeeForm(f => ({ ...f, amountCents: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowFee(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void addFee()} loading={saving}>Add</Button>
              </div>
            </div>
          </div>
        )}

        {/* Enroll modal */}
        {showEnroll && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowEnroll(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Enroll Student</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Full Name *</label>
                  <input type="text" placeholder="Jane Smith" value={enrollForm.name}
                    onChange={e => setEnrollForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Email *</label>
                  <input type="email" placeholder="jane@example.com" value={enrollForm.email}
                    onChange={e => setEnrollForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Phone</label>
                  <input type="tel" placeholder="+1 555 0000" value={enrollForm.phone}
                    onChange={e => setEnrollForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowEnroll(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void enroll()} loading={saving}>Enroll</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
