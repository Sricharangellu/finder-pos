"use client";

import { useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { useFlag } from "@/flags/useFlag";
import { TabBar } from "./_components/TabBar";
import { OrdersTab } from "./_components/OrdersTab";
import { SuppliersTab } from "./_components/SuppliersTab";
import { ReorderTab } from "./_components/ReorderTab";
import { VendorQuotesTab } from "./_components/VendorQuotesTab";
import type { PurchasingTab } from "./_components/shared";

export default function PurchasingPage() {
  const [activeTab, setActiveTab] = useState<PurchasingTab>("orders");
  const vendorQuotationsEnabled = useFlag("vendor_quotations");

  return (
    <EnterpriseShell
      active="purchasing"
      title="Purchasing"
      subtitle="Suppliers, purchase orders, and receiving"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6">
        <Card className="overflow-hidden p-0">
          <TabBar active={activeTab} onChange={setActiveTab} showVendorQuotes={vendorQuotationsEnabled} />

          {activeTab === "orders"        && <OrdersTab />}
          {activeTab === "suppliers"     && <SuppliersTab />}
          {activeTab === "reorder"       && <ReorderTab onNavigateToOrders={() => setActiveTab("orders")} />}
          {activeTab === "vendor-quotes" && <VendorQuotesTab />}
        </Card>
      </div>
    </EnterpriseShell>
  );
}
