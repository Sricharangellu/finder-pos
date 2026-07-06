import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  DashboardRecommendations,
  type RecommendationReport,
} from "@/app/(protected)/dashboard/_components/DashboardRecommendations";

const report: RecommendationReport = {
  ready: false,
  generatedAt: Date.now(),
  recentDays: 30,
  summary: { total: 3, critical: 1, warning: 1, info: 1 },
  recommendations: [
    {
      id: "rec_low_stock",
      signalCode: "low_stock",
      category: "inventory",
      severity: "warning",
      title: "Restock low inventory",
      detail: "Some products are at or below reorder point.",
      action: "Review reorder list",
      href: "/inventory/reorder",
      count: 4,
      rank: 2,
    },
    {
      id: "rec_negative_net_profit",
      signalCode: "negative_net_profit",
      category: "profit",
      severity: "critical",
      title: "Review negative net profit",
      detail: "Net profit is below zero.",
      action: "Open profit report",
      href: "/reports/p-l",
      count: 1,
      rank: 1,
    },
    {
      id: "rec_uncategorized_expenses",
      signalCode: "uncategorized_expenses",
      category: "expenses",
      severity: "info",
      title: "Categorize expenses",
      detail: "Uncategorized expenses reduce confidence.",
      action: "Open expenses",
      href: "/finance",
      count: 3,
      rank: 3,
    },
  ],
};

describe("DashboardRecommendations", () => {
  it("renders ranked actions sorted by backend rank with deep links", () => {
    render(<DashboardRecommendations report={report} loading={false} error={null} />);

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Review negative net profit")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Restock low inventory")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Categorize expenses")).toBeInTheDocument();

    expect(screen.getByText("1 critical")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review reorder list" })).toHaveAttribute("href", "/inventory/reorder");
  });

  it("shows loading state", () => {
    render(<DashboardRecommendations loading error={null} />);
    expect(screen.getByRole("status", { name: "Loading recommendations" })).toBeInTheDocument();
  });

  it("shows empty state", () => {
    render(<DashboardRecommendations report={{ ...report, recommendations: [], summary: { total: 0, critical: 0, warning: 0, info: 0 } }} loading={false} error={null} />);
    expect(screen.getByText(/No urgent actions right now/i)).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(<DashboardRecommendations loading={false} error="Request failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load recommendations.");
  });
});
