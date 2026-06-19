"use client";

import { ModuleBlueprint } from "@/components/ModuleBlueprint";

export default function VendorsPage() {
  return (
    <ModuleBlueprint
      active="vendors"
      title="Vendors"
      subtitle="Supplier records, balances, ledgers, and product mapping"
      overview="Manage supplier profiles, payment terms, compliance records, vendor product mappings, open balances, and ledger activity."
      workflows={[
        { title: "Vendor list", description: "Search suppliers by number, name, company, email, phone, and compliance type.", status: "Planned" },
        { title: "Vendor product mapping", description: "Connect supplier SKUs, UPCs, costs, and preferred vendors to catalog items.", status: "Needs API" },
        { title: "Vendor ledger", description: "Review AP activity, credits, payments, and current due amount by supplier.", status: "Needs API" },
      ]}
      dataSections={[
        { title: "Basic info", description: "Supplier number, name, company, DBA, email, phone, and description." },
        { title: "Compliance", description: "Tax ID, FEIN, vendor type, MSA type, and document readiness." },
        { title: "Payment", description: "Payment terms, due amount, and primary sales representative." },
        { title: "Addresses", description: "Billing, remit-to, pickup, and warehouse contact addresses." },
        { title: "Product mapping", description: "Vendor SKU, vendor UPC, supply price, and preferred item relationships." },
        { title: "Ledger", description: "Bills, payments, credits, adjustments, and audit trail." },
      ]}
      actions={["New vendor", "Import vendors", "Map products", "Review balances"]}
    />
  );
}
