"use client";

/**
 * FE-ED1: Education — student registry and fee collection.
 * Module-gated by module:student_accounts.
 */

import { useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Badge } from "@/components/Badge";
import { apiGet, apiPatch, apiPost, safeLoad } from "@/api-client/client";
import { formatMoney } from "@/lib/money";

interface FeeRecord {
  id: string;
  description: string;
  amount_cents: number;
  due_date: number | null;
  paid_at: number | null;
  method: string | null;
  order_id: string | null;
  created_at: number;
}

interface Student {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  course: string | null;
  enrolled_at: number | null;
  status: "active" | "inactive";
  notes: string | null;
  outstanding?: number;
  fees?: FeeRecord[];
}

const STATUS_BADGE: Record<Student["status"], "green" | "gray"> = {
  active: "green",
  inactive: "gray",
};

export default function EducationPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [studentModal, setStudentModal] = useState(false);
  const [feeModal, setFeeModal] = useState(false);
  const [filter, setFilter] = useState<"all" | Student["status"]>("all");
  const [studentForm, setStudentForm] = useState({
    name: "",
    email: "",
    phone: "",
    course: "",
    notes: "",
  });
  const [feeForm, setFeeForm] = useState({
    description: "",
    amountCents: "",
    dueDate: "",
  });

  const loadStudents = () => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: Student[] }>("/api/v1/education/students")
        .then((res) => {
          const items = res.items ?? [];
          setStudents(items);
          if (!selected && items.length > 0) {
            void openStudent(items[0]!);
          }
        })
        .finally(() => setLoading(false)),
    );
  };

  const openStudent = (student: Student) => {
    setDetailLoading(true);
    safeLoad(
      apiGet<Student>(`/api/v1/education/students/${student.id}`)
        .then((res) => setSelected(res))
        .finally(() => setDetailLoading(false)),
    );
  };

  useEffect(() => {
    loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleStudents = useMemo(
    () => (filter === "all" ? students : students.filter((student) => student.status === filter)),
    [filter, students],
  );

  const activeCount = students.filter((student) => student.status === "active").length;
  const outstandingTotal = students.reduce((sum, student) => sum + Number(student.outstanding ?? 0), 0);

  const handleCreateStudent = async () => {
    if (!studentForm.name) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/education/students", {
        name: studentForm.name,
        email: studentForm.email || undefined,
        phone: studentForm.phone || undefined,
        course: studentForm.course || undefined,
        notes: studentForm.notes || undefined,
      });
      setStudentModal(false);
      setStudentForm({ name: "", email: "", phone: "", course: "", notes: "" });
      loadStudents();
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (student: Student) => {
    setSaving(true);
    try {
      await apiPatch(`/api/v1/education/students/${student.id}`, {
        status: student.status === "active" ? "inactive" : "active",
      });
      loadStudents();
      void openStudent(student);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFee = async () => {
    if (!selected || !feeForm.description || !feeForm.amountCents) return;
    setSaving(true);
    try {
      await apiPost(`/api/v1/education/students/${selected.id}/fees`, {
        description: feeForm.description,
        amountCents: Number(feeForm.amountCents),
        dueDate: feeForm.dueDate ? new Date(feeForm.dueDate).getTime() : undefined,
      });
      setFeeModal(false);
      setFeeForm({ description: "", amountCents: "", dueDate: "" });
      void openStudent(selected);
    } finally {
      setSaving(false);
    }
  };

  const handleCollect = async (fee: FeeRecord) => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiPost(`/api/v1/education/fees/${fee.id}/collect`, { method: "cash" });
      void openStudent(selected);
      loadStudents();
    } finally {
      setSaving(false);
    }
  };

  const dueFees = selected?.fees?.filter((fee) => !fee.paid_at) ?? [];

  return (
    <EnterpriseShell active="education" title="Students & Fees" subtitle="Student registry, balances, and fee collection">
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 sm:px-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Students</p>
              <p className="text-2xl font-semibold text-[var(--color-text-primary)]">{students.length}</p>
            </div>
          </Card>
          <Card>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Active</p>
              <p className="text-2xl font-semibold text-[var(--color-text-primary)]">{activeCount}</p>
            </div>
          </Card>
          <Card>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Outstanding</p>
              <p className="text-2xl font-semibold text-[var(--color-text-primary)]">{formatMoney(outstandingTotal)}</p>
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(["all", "active", "inactive"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === value
                    ? "bg-brand-600 text-white"
                    : "bg-gray-100 text-[var(--color-text-secondary)] hover:bg-gray-200"
                }`}
              >
                {value === "all" ? `All (${students.length})` : `${value} (${students.filter((student) => student.status === value).length})`}
              </button>
            ))}
          </div>

          <Button variant="primary" size="sm" onClick={() => setStudentModal(true)}>
            + Student
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-2">
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((index) => (
                  <div key={index} className="h-20 animate-pulse rounded-xl bg-gray-100" />
                ))}
              </div>
            ) : visibleStudents.length === 0 ? (
              <Card>
                <p className="py-10 text-center text-sm text-[var(--color-text-secondary)]">No students match the current filter.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {visibleStudents.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => openStudent(student)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-all hover:shadow-sm ${
                      selected?.id === student.id ? "border-brand-500 bg-brand-50" : "border-[var(--color-table-border)] bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{student.name}</p>
                        <p className="truncate text-xs text-[var(--color-text-secondary)]">
                          {student.course ?? "No course"}{student.email ? ` · ${student.email}` : ""}
                        </p>
                      </div>
                      <Badge variant={STATUS_BADGE[student.status]} size="sm">
                        {student.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
                      <span>{student.phone ?? "No phone"}</span>
                      <span>{formatMoney(student.outstanding ?? 0)} outstanding</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-3">
            {!selected ? (
              <Card>
                <div className="py-16 text-center">
                  <p className="text-2xl">🎓</p>
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Select a student to review the account</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                <Card>
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-[var(--color-text-primary)]">{selected.name}</h3>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                          {selected.course ?? "No course assigned"}
                          {selected.enrolled_at ? ` · Enrolled ${new Date(selected.enrolled_at).toLocaleDateString()}` : ""}
                        </p>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                          {selected.email ?? "No email"}{selected.phone ? ` · ${selected.phone}` : ""}
                        </p>
                      </div>
                      <Badge variant={STATUS_BADGE[selected.status]} size="sm">
                        {selected.status}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => handleToggleStatus(selected)} loading={saving}>
                        {selected.status === "active" ? "Deactivate" : "Activate"}
                      </Button>
                      <Button variant="primary" size="sm" onClick={() => setFeeModal(true)}>
                        + Fee
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">Balance</p>
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{formatMoney(selected.outstanding ?? 0)}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">Open fees</p>
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{dueFees.length}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)]">Notes</p>
                        <p className="line-clamp-2 text-sm font-medium text-[var(--color-text-primary)]">{selected.notes ?? "No notes"}</p>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Fee ledger</h4>
                      <p className="text-xs text-[var(--color-text-secondary)]">{selected.fees?.length ?? 0} record{(selected.fees?.length ?? 0) === 1 ? "" : "s"}</p>
                    </div>
                    {detailLoading && <span className="text-xs text-[var(--color-text-secondary)]">Refreshing…</span>}
                  </div>

                  <div className="mt-3 space-y-2">
                    {(selected.fees ?? []).length === 0 ? (
                      <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">No fee records yet.</p>
                    ) : (
                      selected.fees!.map((fee) => (
                        <div key={fee.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-table-border)] bg-white px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{fee.description}</p>
                            <p className="text-xs text-[var(--color-text-secondary)]">
                              {fee.due_date ? `Due ${new Date(fee.due_date).toLocaleDateString()}` : "No due date"}
                              {fee.method ? ` · Paid via ${fee.method}` : ""}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-[var(--color-text-primary)]">{formatMoney(fee.amount_cents)}</p>
                            {fee.paid_at ? (
                              <Badge variant="green" size="sm">Paid</Badge>
                            ) : (
                              <Button variant="secondary" size="sm" loading={saving} onClick={() => handleCollect(fee)}>
                                Collect
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={studentModal} onClose={() => setStudentModal(false)} title="Add Student">
        <div className="space-y-3 p-4">
          {[
            { key: "name", label: "Name *", placeholder: "Ava Patel" },
            { key: "email", label: "Email", placeholder: "ava@example.edu" },
            { key: "phone", label: "Phone", placeholder: "(555) 123-4567" },
            { key: "course", label: "Course", placeholder: "Culinary Arts" },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>
              <input
                type="text"
                placeholder={placeholder}
                value={studentForm[key as keyof typeof studentForm]}
                onChange={(event) => setStudentForm((form) => ({ ...form, [key]: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
              />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Notes</label>
            <textarea
              rows={3}
              value={studentForm.notes}
              onChange={(event) => setStudentForm((form) => ({ ...form, notes: event.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
              placeholder="Scholarship, payment schedule, advisor notes..."
            />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setStudentModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleCreateStudent} disabled={!studentForm.name}>
              Add
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={feeModal} onClose={() => setFeeModal(false)} title={`Add Fee — ${selected?.name ?? ""}`}>
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Description *</label>
            <input
              type="text"
              value={feeForm.description}
              onChange={(event) => setFeeForm((form) => ({ ...form, description: event.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
              placeholder="Tuition installment"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Amount (cents) *</label>
              <input
                type="number"
                min={1}
                value={feeForm.amountCents}
                onChange={(event) => setFeeForm((form) => ({ ...form, amountCents: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
                placeholder="25000"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Due date</label>
              <input
                type="date"
                value={feeForm.dueDate}
                onChange={(event) => setFeeForm((form) => ({ ...form, dueDate: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setFeeModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleCreateFee} disabled={!feeForm.description || !feeForm.amountCents}>
              Add
            </Button>
          </div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
