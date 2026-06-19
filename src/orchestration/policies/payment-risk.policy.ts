/**
 * Payment Risk Policy
 *
 * Evaluates a payment for risk before authorization.
 * Returns a risk score and recommendation.
 */

export type RiskLevel = "low" | "medium" | "high" | "blocked";

export interface RiskInput {
  amountCents: number;
  customerId?: string | null;
  method: string;
  tenantId: string;
  orderId: string;
}

export interface RiskDecision {
  level: RiskLevel;
  score: number; // 0–100
  recommendation: "approve" | "review" | "decline";
  reasons: string[];
}

const HIGH_VALUE_THRESHOLD_CENTS = 100_000; // $1000
const VERY_HIGH_VALUE_CENTS = 500_000;       // $5000

export function evaluatePaymentRisk(input: RiskInput): RiskDecision {
  const reasons: string[] = [];
  let score = 0;

  if (input.amountCents > VERY_HIGH_VALUE_CENTS) {
    score += 60;
    reasons.push("very_high_value");
  } else if (input.amountCents > HIGH_VALUE_THRESHOLD_CENTS) {
    score += 30;
    reasons.push("high_value");
  }

  if (!input.customerId) {
    score += 10;
    reasons.push("guest_checkout");
  }

  if (input.method === "cash" && input.amountCents > HIGH_VALUE_THRESHOLD_CENTS) {
    score += 20;
    reasons.push("large_cash_transaction");
  }

  const level: RiskLevel = score >= 80 ? "blocked" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";
  const recommendation = level === "blocked" ? "decline" : level === "high" ? "review" : "approve";

  return { level, score, recommendation, reasons };
}
