"use client";

/**
 * FE-HC1: Patients list + prescription viewer.
 * Module-gated by module:healthcare.
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, safeLoad } from "@/api-client/client";

interface Patient {
  id: string;
  name: string;
  dob: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  allergies: string | null;
  created_at: number;
}

interface Prescription {
  id: string;
  drug_name: string;
  dosage: string;
  prescriber: string | null;
  quantity: number;
  refills_remaining: number;
  dispensed_at: number | null;
  expiry_date: number | null;
  created_at: number;
}

interface PatientDetail extends Patient {
  prescriptions: Prescription[];
}

export default function HealthcarePage() {
  const [patients, setPatients]     = useState<Patient[]>([]);
  const [loading, setLoading]       = useState(true);
  const [q, setQ]                   = useState("");
  const [selected, setSelected]     = useState<PatientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modal, setModal]           = useState(false);
  const [saving, setSaving]         = useState(false);
  const [dispensing, setDispensing] = useState<string | null>(null);
  const [form, setForm]             = useState({ name: "", dob: "", gender: "", phone: "", email: "" });

  const load = (search = "") => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: Patient[] }>(`/api/v1/healthcare/patients${search ? `?q=${encodeURIComponent(search)}` : ""}`)
        .then(r => setPatients(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  };

  const openDetail = (id: string) => {
    setDetailLoading(true);
    safeLoad(
      apiGet<PatientDetail>(`/api/v1/healthcare/patients/${id}`)
        .then(r => setSelected(r))
        .finally(() => setDetailLoading(false)),
    );
  };

  useEffect(() => { load(); }, []);

  const handleSearch = (v: string) => { setQ(v); load(v); };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await apiPost("/api/v1/healthcare/patients", form);
      setModal(false);
      setForm({ name: "", dob: "", gender: "", phone: "", email: "" });
      load(q);
    } finally { setSaving(false); }
  };

  const handleDispense = async (rxId: string) => {
    setDispensing(rxId);
    try {
      await apiPost(`/api/v1/healthcare/prescriptions/${rxId}/dispense`, {});
      if (selected) openDetail(selected.id);
    } finally { setDispensing(null); }
  };

  return (
    <EnterpriseShell active="healthcare" title="Patients" subtitle="Patient records and prescriptions">
      <div className="mx-auto w-full max-w-6xl gap-5 px-4 py-5 sm:px-6 grid grid-cols-1 lg:grid-cols-5">

        {/* Patient list (3 cols) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex gap-2">
            <input
              type="search"
              value={q}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search patients…"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
            />
            <Button variant="primary" size="sm" onClick={() => setModal(true)}>+ New</Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : patients.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">No patients found.</p>
            </Card>
          ) : (
            <div className="space-y-1.5">
              {patients.map(p => (
                <button key={p.id} type="button"
                  onClick={() => openDetail(p.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors hover:border-brand-400 hover:bg-brand-50 ${
                    selected?.id === p.id ? "border-brand-600 bg-brand-50" : "border-[var(--color-table-border)] bg-white"
                  }`}>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{p.name}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {p.dob ? `DOB: ${p.dob}` : "No DOB"}{p.phone ? ` · ${p.phone}` : ""}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel (3 cols) */}
        <div className="lg:col-span-3">
          {!selected && !detailLoading && (
            <Card>
              <div className="py-16 text-center">
                <p className="text-2xl">🏥</p>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Select a patient to view their records</p>
              </div>
            </Card>
          )}
          {detailLoading && (
            <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
          )}
          {selected && !detailLoading && (
            <div className="space-y-4">
              <Card>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-[var(--color-text-primary)]">{selected.name}</h3>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {selected.dob && `DOB: ${selected.dob}`}
                      {selected.gender && ` · ${selected.gender}`}
                    </p>
                    {selected.phone && <p className="text-sm text-[var(--color-text-secondary)]">{selected.phone}</p>}
                    {selected.email && <p className="text-sm text-[var(--color-text-secondary)]">{selected.email}</p>}
                    {selected.allergies && (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
                        ⚠ Allergies: {selected.allergies}
                      </p>
                    )}
                  </div>
                  <Badge variant="blue" size="sm">Patient</Badge>
                </div>
              </Card>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  Prescriptions ({selected.prescriptions.length})
                </h4>
                {selected.prescriptions.length === 0 ? (
                  <Card>
                    <p className="py-6 text-center text-sm text-[var(--color-text-secondary)]">No prescriptions on file.</p>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {selected.prescriptions.map(rx => (
                      <div key={rx.id}
                        className="flex items-center justify-between rounded-xl border border-[var(--color-table-border)] bg-white px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                            {rx.drug_name}
                            <span className="ml-2 text-xs font-normal text-[var(--color-text-secondary)]">{rx.dosage}</span>
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                            Qty {rx.quantity} · Refills left: {rx.refills_remaining}
                            {rx.prescriber && ` · Dr. ${rx.prescriber}`}
                          </p>
                        </div>
                        {rx.refills_remaining > 0 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={dispensing === rx.id}
                            onClick={() => handleDispense(rx.id)}
                          >
                            Dispense
                          </Button>
                        )}
                        {rx.refills_remaining === 0 && (
                          <Badge variant="gray" size="sm">No refills</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New patient modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Register Patient">
        <div className="space-y-3 p-4">
          {[
            { key: "name",   label: "Full name *",  type: "text",  placeholder: "Jane Smith" },
            { key: "dob",    label: "Date of birth", type: "date",  placeholder: "" },
            { key: "gender", label: "Gender",        type: "text",  placeholder: "Male / Female / Other" },
            { key: "phone",  label: "Phone",         type: "tel",   placeholder: "+1 555 0100" },
            { key: "email",  label: "Email",         type: "email", placeholder: "jane@example.com" },
          ].map(({ key, label, type, placeholder }) => (
            <div key={key}>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>
              <input
                type={type}
                placeholder={placeholder}
                value={form[key as keyof typeof form]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setModal(false)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleCreate} disabled={!form.name}>
              Register
            </Button>
          </div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
