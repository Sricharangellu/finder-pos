import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ExpensesView,
  type Expense,
  type ExpensesSummary,
} from "@/app/(protected)/finance/_components/ExpensesPanel";

const now = Date.now();
const expenses: Expense[] = [
  { id: "exp_1", tenant_id: "tnt_demo", category: "Rent", amount_cents: 250000, spent_at: now, vendor: "Landlord Co", note: "July", account_id: null, created_by: "u", created_at: now },
  { id: "exp_2", tenant_id: "tnt_demo", category: null, amount_cents: 4200, spent_at: now, vendor: "Corner Store", note: "Supplies", account_id: null, created_by: "u", created_at: now },
];
const summary: ExpensesSummary = {
  totalCents: 254200, count: 2, uncategorizedCount: 1,
  byCategory: [{ category: "Rent", totalCents: 250000, count: 1 }],
};

function noop() {}

describe("ExpensesView", () => {
  it("renders summary totals and the expense list", () => {
    render(
      <ExpensesView expenses={expenses} summary={summary} canManage loading={false} error={null}
        onCreate={noop} onCategorize={noop} onDelete={noop} />,
    );
    expect(screen.getByText("$2,542.00")).toBeInTheDocument(); // total
    expect(screen.getByText("Rent")).toBeInTheDocument();
    // exp_2 has no category — its row shows the "Uncategorized" marker.
    const row2 = screen.getByText("Corner Store").closest("tr")!;
    expect(within(row2).getByText("Uncategorized")).toBeInTheDocument();
  });

  it("lets a manager record an expense", async () => {
    const onCreate = vi.fn();
    render(
      <ExpensesView expenses={expenses} summary={summary} canManage loading={false} error={null}
        onCreate={onCreate} onCategorize={noop} onDelete={noop} />,
    );
    await userEvent.type(screen.getByLabelText("Amount"), "12.50");
    await userEvent.type(screen.getByLabelText("Category"), "Utilities");
    await userEvent.click(screen.getByRole("button", { name: /add expense/i }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 1250, category: "Utilities" }),
    );
  });

  it("blocks recording a non-positive amount", async () => {
    const onCreate = vi.fn();
    render(
      <ExpensesView expenses={expenses} summary={summary} canManage loading={false} error={null}
        onCreate={onCreate} onCategorize={noop} onDelete={noop} />,
    );
    await userEvent.type(screen.getByLabelText("Amount"), "0");
    await userEvent.click(screen.getByRole("button", { name: /add expense/i }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/greater than zero/i)).toBeInTheDocument();
  });

  it("categorizes an uncategorized expense", async () => {
    const onCategorize = vi.fn();
    render(
      <ExpensesView expenses={expenses} summary={summary} canManage loading={false} error={null}
        onCreate={noop} onCategorize={onCategorize} onDelete={noop} />,
    );
    await userEvent.type(screen.getByLabelText("Category for expense exp_2"), "Supplies");
    // The Save button lives in the same row as the categorize input.
    const row = screen.getByLabelText("Category for expense exp_2").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: /save/i }));
    expect(onCategorize).toHaveBeenCalledWith("exp_2", "Supplies");
  });

  it("hides all mutation controls from read-only roles", () => {
    render(
      <ExpensesView expenses={expenses} summary={summary} canManage={false} loading={false} error={null}
        onCreate={noop} onCategorize={noop} onDelete={noop} />,
    );
    expect(screen.queryByText(/record an expense/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add expense/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete expense/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/category for expense/i)).not.toBeInTheDocument();
    // Data is still visible.
    expect(screen.getByText("Rent")).toBeInTheDocument();
  });

  it("shows loading, empty, and error states", () => {
    const { rerender } = render(
      <ExpensesView expenses={[]} summary={null} canManage loading error={null}
        onCreate={noop} onCategorize={noop} onDelete={noop} />,
    );
    expect(screen.getByRole("status", { name: /loading expenses/i })).toBeInTheDocument();

    rerender(
      <ExpensesView expenses={[]} summary={summary} canManage loading={false} error={null}
        onCreate={noop} onCategorize={noop} onDelete={noop} />,
    );
    expect(screen.getByText(/no expenses recorded yet/i)).toBeInTheDocument();

    rerender(
      <ExpensesView expenses={[]} summary={null} canManage loading={false} error="boom"
        onCreate={noop} onCategorize={noop} onDelete={noop} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load expenses/i);
  });
});
