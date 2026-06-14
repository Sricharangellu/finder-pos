"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPatch } from "@/api-client/client";

interface Discount {
  id: string;
  name: string;
  coupon_code: string | null;
  rule_type: string;
  discount_type: string;
  value: number;
  apply_to: string;
  status: string;
  auto_applicable: number;
  used_count: number;
  usage_limit: number | null;
}

export default function DiscountsPage() {
  const [items, setItems] = useState<Discount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await apiGet<{ items: Discount[] }>("/api/v1/discounts");
      setItems(r.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load discounts");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (d: Discount) => {
    setBusy(true);
    try {
      await apiPatch(`/api/v1/discounts/${d.id}/status`, { status: d.status === "active" ? "inactive" : "active" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(false); }
  };

  const valueLabel = (d: Discount) =>
    d.rule_type === "bxgy" ? "Buy/Get" : d.discount_type === "fixed" ? formatMoney(d.value) : `${d.value}%`;

  return (
    <EnterpriseShell active="discounts" title="Discounts" subtitle="Promotions & coupon rules">
      <div className="space-y-4 p-4">
        {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        <Card title="Discount Rules" description="Simple, volume, and buy-X-get-Y promotions with coupon or auto-apply.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Coupon</th>
                  <th className="py-2 pr-4">Type</th><th className="py-2 pr-4">Value</th>
                  <th className="py-2 pr-4">Applies</th><th className="py-2 pr-4">Usage</th>
                  <th className="py-2 pr-4">Status</th><th className="py-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-gray-400">No discount rules</td></tr>}
                {items.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{d.name}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{d.coupon_code ?? (d.auto_applicable ? "auto" : "—")}</td>
                    <td className="py-2 pr-4 capitalize">{d.rule_type}</td>
                    <td className="py-2 pr-4">{valueLabel(d)}</td>
                    <td className="py-2 pr-4 capitalize">{d.apply_to}</td>
                    <td className="py-2 pr-4 text-gray-500">{d.used_count}{d.usage_limit ? `/${d.usage_limit}` : ""}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${d.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>{d.status}</span>
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(d)}>{d.status === "active" ? "Disable" : "Enable"}</Button>
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
