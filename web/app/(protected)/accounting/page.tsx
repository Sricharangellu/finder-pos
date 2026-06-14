"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost } from "@/api-client/client";

interface Account { id: string; code: string; name: string; type: string; is_active: number; }
interface Deposit { id: string; batch_number: string; status: string; total_cents: number; account_id: string; created_at: number; }

const TYPE_STYLE: Record<string, string> = {
  asset: "bg-blue-100 text-blue-800",
  liability: "bg-amber-100 text-amber-800",
  income: "bg-green-100 text-green-800",
  expense: "bg-red-100 text-red-700",
};
const DEP_STYLE: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
};

export default function AccountingPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [a, d] = await Promise.all([
        apiGet<{ items: Account[] }>("/api/v1/accounting/accounts"),
        apiGet<{ items: Deposit[] }>("/api/v1/accounting/deposits"),
      ]);
      setAccounts(a.items ?? []);
      setDeposits(d.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const seed = async () => {
    setBusy(true);
    try { await apiPost("/api/v1/accounting/accounts/seed", {}); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Seed failed"); }
    finally { setBusy(false); }
  };

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusy(true);
    try { await apiPost(`/api/v1/accounting/deposits/${id}/${action}`, {}); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(false); }
  };

  return (
    <EnterpriseShell active="accounting" title="Accounting" subtitle="Chart of Accounts & Batch Deposits">
      <div className="space-y-4 p-4">
        {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

        <Card
          title="Chart of Accounts"
          description="Typed account tree used across products, shipping, and bills."
        >
          <div className="mb-3">
            {accounts.length === 0 && <Button size="sm" disabled={busy} onClick={seed}>Seed standard COA</Button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Code</th><th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Type</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-gray-400">No accounts — seed to get started</td></tr>}
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{a.code}</td>
                    <td className="py-2 pr-4">{a.name}</td>
                    <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[a.type] ?? "bg-gray-100"}`}>{a.type}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Batch Deposits" description="Group received payments into bank deposits for approval.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Batch #</th><th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4 text-right">Total</th><th className="py-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deposits.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-400">No batch deposits</td></tr>}
                {deposits.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{d.batch_number}</td>
                    <td className="py-2 pr-4"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DEP_STYLE[d.status] ?? "bg-gray-100"}`}>{d.status.replace(/_/g, " ")}</span></td>
                    <td className="py-2 pr-4 text-right">{formatMoney(d.total_cents)}</td>
                    <td className="py-2 pr-4 text-right">
                      {d.status === "pending_approval" && (
                        <span className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(d.id, "approve")}>Approve</Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(d.id, "reject")}>Reject</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </EnterpriseShell>
  );
}
