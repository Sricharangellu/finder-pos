import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillsView } from "@/app/(protected)/bills/_components/BillsView";
import type { Bill } from "@/api-client/types";

const now = Date.now();

function mkBill(over: Partial<Bill>): Bill {
  return {
    id: "bil_x", supplier_id: "sup_a", po_id: null, bill_number: "BILL-00001",
    status: "open", total_cents: 10000, paid_cents: 0, due_date: now + 86400000,
    issued_at: now, discount_pct: null, discount_date: null, discount_applied_cents: 0,
    supplier_name: "Alpha Distributing", supplier_company: null, ...over,
  };
}

const bills: Bill[] = [
  mkBill({ id: "bil_1", bill_number: "BILL-1", supplier_id: "sup_a", supplier_name: "Alpha Distributing", status: "open", total_cents: 10000, paid_cents: 0, po_id: "po_1" }),
  mkBill({ id: "bil_2", bill_number: "BILL-2", supplier_id: "sup_b", supplier_name: "Beta Wholesale", status: "partial", total_cents: 20000, paid_cents: 5000 }),
  mkBill({ id: "bil_3", bill_number: "BILL-3", supplier_id: "sup_a", supplier_name: "Alpha Distributing", status: "paid", total_cents: 8000, paid_cents: 8000 }),
];

const suppliers = [{ id: "sup_a", name: "Alpha Distributing" }, { id: "sup_b", name: "Beta Wholesale" }];

function renderView(props: Partial<React.ComponentProps<typeof BillsView>> = {}) {
  return render(
    <BillsView
      bills={bills}
      suppliers={suppliers}
      supplierFilter=""
      statusFilter=""
      loading={false}
      error={null}
      onSupplierChange={() => {}}
      onStatusChange={() => {}}
      {...props}
    />,
  );
}

describe("BillsView", () => {
  it("shows each bill with its supplier name and status", () => {
    renderView();
    const row = screen.getByText("BILL-2").closest("tr")!;
    expect(within(row).getByText("Beta Wholesale")).toBeInTheDocument();
    expect(within(row).getByText("Partial")).toBeInTheDocument();
  });

  it("sums outstanding balance across open + partial bills only (excludes paid)", () => {
    renderView();
    // open 10000 + partial (20000-5000=15000) = 25000; paid bill excluded.
    const tile = screen.getByText("Outstanding").closest("div")!;
    expect(within(tile).getByText("$250.00")).toBeInTheDocument();
  });

  it("emits the chosen supplier to the filter callback", async () => {
    const onSupplierChange = vi.fn();
    renderView({ onSupplierChange });
    await userEvent.selectOptions(screen.getByLabelText("Supplier"), "sup_b");
    expect(onSupplierChange).toHaveBeenCalledWith("sup_b");
  });

  it("emits the chosen status to the filter callback", async () => {
    const onStatusChange = vi.fn();
    renderView({ onStatusChange });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "paid");
    expect(onStatusChange).toHaveBeenCalledWith("paid");
  });

  it("reflects the active supplier filter as the select value", () => {
    renderView({ supplierFilter: "sup_a" });
    expect((screen.getByLabelText("Supplier") as HTMLSelectElement).value).toBe("sup_a");
  });

  it("shows an empty state that points to the receive-to-bill automation", () => {
    renderView({ bills: [] });
    expect(screen.getByText(/created automatically when a purchase order is received/i)).toBeInTheDocument();
  });

  it("shows a loading skeleton", () => {
    renderView({ loading: true });
    expect(screen.getByRole("status", { name: "Loading bills" })).toBeInTheDocument();
  });

  it("surfaces an error", () => {
    renderView({ error: "Failed to load bills." });
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load bills.");
  });
});
