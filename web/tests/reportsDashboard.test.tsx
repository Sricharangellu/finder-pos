import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportsDashboard } from "@/components/reports/ReportsDashboard";
import type { SalesSummary } from "@/api-client/types";

const summary: SalesSummary = {
  orders: { open: 2, completed: 5, refunded: 1, voided: 0, total: 8 },
  revenue: { grossCents: 21650, taxCents: 1650, netCents: 20000 },
  payments: { capturedCount: 5, capturedCents: 21651, byMethod: { cash: 11651, card: 10000 } },
};

describe("ReportsDashboard", () => {
  it("renders revenue KPIs formatted as money", () => {
    render(<ReportsDashboard summary={summary} />);
    expect(screen.getByText("$216.50")).toBeInTheDocument(); // gross
    expect(screen.getByText("$16.50")).toBeInTheDocument();  // tax
    expect(screen.getByText("$200.00")).toBeInTheDocument(); // net
  });

  it("renders order counts and payment methods", () => {
    render(<ReportsDashboard summary={summary} />);
    expect(screen.getByText("8")).toBeInTheDocument(); // total orders
    expect(screen.getByText(/cash/i)).toBeInTheDocument();
    expect(screen.getByText(/card/i)).toBeInTheDocument();
  });
});
