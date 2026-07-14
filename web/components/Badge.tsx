import { clsx } from "clsx";

// ─── Variant types ────────────────────────────────────────────────────────────
// Spec:
//   Billed / active  → #1890FF solid (blue)
//   Not Billed / pending → #FA8C16 solid (orange)
//   Completed / paid  → green outlined
//   Draft / voided    → gray outlined
//   Danger / error    → #FF4D4F solid (red)
//   Purple            → purple solid

export type BadgeVariant =
  | "gray"
  | "blue"
  | "green"
  | "yellow"
  | "red"
  | "purple"
  | "orange";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  /** Use outlined style instead of solid fill */
  outlined?: boolean;
}

// Solid fills (default — matches Ascend ERP status tags)
const solidClass: Record<BadgeVariant, string> = {
  blue:   "bg-[#1890FF] text-white",          // Billed
  orange: "bg-[#FA8C16] text-white",          // Not Billed / Pending
  yellow: "bg-[#FA8C16] text-white",          // alias for orange
  green:  "bg-[#52C41A] text-white",          // Completed / Paid
  gray:   "bg-gray-400 text-white",           // Draft / Voided
  red:    "bg-[#FF4D4F] text-white",          // Error / Overdue
  purple: "bg-purple-500 text-white",
};

// Outlined style (spec uses for "Completed", "Pending Shipment")
const outlinedClass: Record<BadgeVariant, string> = {
  blue:   "bg-transparent border border-[#1890FF] text-[#1890FF]",
  orange: "bg-transparent border border-[#FA8C16] text-[#FA8C16]",
  yellow: "bg-transparent border border-[#FA8C16] text-[#FA8C16]",
  green:  "bg-transparent border border-[#52C41A] text-[#52C41A]",
  gray:   "bg-transparent border border-gray-400 text-gray-500",
  red:    "bg-transparent border border-[#FF4D4F] text-[#FF4D4F]",
  purple: "bg-transparent border border-purple-500 text-purple-600",
};

export function Badge({
  children,
  variant = "gray",
  size = "md",
  outlined = false,
}: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center font-medium whitespace-nowrap",
        // Spec: border-radius 4px, padding 0 7px, font-size 12px
        "rounded-[4px] text-[12px] leading-[20px]",
        size === "sm" ? "px-1.5" : "px-[7px]",
        outlined ? outlinedClass[variant] : solidClass[variant]
      )}
    >
      {children}
    </span>
  );
}

// ─── Status → variant mapping ─────────────────────────────────────────────────

export function statusBadge(status: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    open:               "blue",
    billed:             "blue",
    active:             "green",
    completed:          "green",
    paid:               "green",
    received:           "green",
    approved:           "green",
    ready:              "green",
    partial:            "orange",
    partially_received: "orange",
    pending:            "orange",
    not_billed:         "orange",
    "not-billed":       "orange",
    in_progress:        "orange",
    draft:              "gray",
    voided:             "gray",
    void:               "gray",
    cancelled:          "gray",
    archived:           "gray",
    closed:             "gray",
    refunded:           "purple",
    overdue:            "red",
    failed:             "red",
    dunning_1:          "orange",
    dunning_2:          "orange",
    dunning_3:          "red",
  };
  return map[status.toLowerCase()] ?? "gray";
}

// ─── Outlined status badge (for Completed, Pending Shipment per spec) ─────────

export function OutlinedStatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const variant = statusBadge(status);
  const outlineVariants: BadgeVariant[] = ["green", "orange", "blue"];
  const useOutline = outlineVariants.includes(variant);

  return (
    <Badge variant={variant} outlined={useOutline}>
      {label ?? status}
    </Badge>
  );
}
