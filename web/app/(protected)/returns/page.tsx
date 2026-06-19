"use client";

import { ModuleBlueprint } from "@/components/ModuleBlueprint";

export default function ReturnsPage() {
  return (
    <ModuleBlueprint
      active="returns"
      title="Returns"
      subtitle="Return mode, refunds, exchanges, and receipt lookup"
      overview="Support receipt-based returns, exchange workflows, refund approvals, inventory restock decisions, and return audit trails."
      workflows={[
        { title: "Return mode", description: "Start a return from receipt lookup, customer order history, or manual line entry.", status: "Planned" },
        { title: "Refund approval", description: "Route exceptions for manager approval based on amount, age, tender, and policy.", status: "Needs API" },
        { title: "Restock handling", description: "Decide whether returned items go back to stock, damage, quarantine, or vendor return.", status: "Needs API" },
      ]}
      dataSections={[
        { title: "Receipt lookup", description: "Order number, barcode, customer, date, register, and cashier search." },
        { title: "Return lines", description: "Quantity, original price, discount, tax, refund amount, reason, and disposition." },
        { title: "Inventory movement", description: "Restock, damaged, vendor return, or no inventory movement." },
        { title: "Payments", description: "Original tender, refund tender, split refunds, and capture status." },
        { title: "Customer history", description: "Return frequency, policy exceptions, notes, and loyalty impact." },
        { title: "Audit history", description: "Approvals, overrides, cashier actions, and policy decisions." },
      ]}
      actions={["Start return", "Recall receipt", "Review exceptions", "Export return log"]}
    />
  );
}
