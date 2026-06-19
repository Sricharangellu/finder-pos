"use client";

import { ModuleBlueprint } from "@/components/ModuleBlueprint";

export default function PaymentsPage() {
  return (
    <ModuleBlueprint
      active="payments"
      title="Payments"
      subtitle="Tender capture, split payments, credits, and history"
      overview="Centralize payment activity across POS, invoices, customer credit, split payments, refunds, and settlement monitoring."
      workflows={[
        { title: "Payment history", description: "Filter by date, store, register, cashier, customer, method, status, and amount.", status: "Planned" },
        { title: "Split payment review", description: "Inspect transactions that combine cash, card, customer credit, and manual tenders.", status: "Needs API" },
        { title: "Settlement exceptions", description: "Track failed captures, gateway mismatch, voids, and refund reconciliation.", status: "Needs API" },
      ]}
      dataSections={[
        { title: "Tender details", description: "Method, authorization, status, captured amount, refunded amount, and gateway reference." },
        { title: "Customer credit", description: "Credit balance use, remaining balance, terms, and linked invoice activity." },
        { title: "Cash drawer", description: "Expected cash, counted cash, variance, drops, and shift relationship." },
        { title: "Refunds", description: "Refund lines, reasons, original payment links, and audit approvals." },
        { title: "Receipts", description: "Receipt delivery method, print/email events, and resend state." },
        { title: "Audit history", description: "Cashier actions, overrides, gateway messages, and settlement notes." },
      ]}
      actions={["Record payment", "Review settlements", "Open cash drawer", "Export tender report"]}
    />
  );
}
