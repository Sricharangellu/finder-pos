import React from "react";
import { clsx } from "clsx";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost"
  | "link";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

// ─── Variant styles ───────────────────────────────────────────────────────────
const variantClasses: Record<ButtonVariant, string> = {
  // #0137FC primary — matches Ascend ERP spec
  primary: [
    "bg-brand-600 text-white border-none",
    "hover:bg-brand-700 active:bg-brand-800",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    "shadow-[rgba(5,95,255,0.1)_0px_2px_0px_0px]",
    "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
  ].join(" "),

  // Outlined secondary — border: 1px solid #D9D9D9
  secondary: [
    "bg-white text-[rgba(0,0,0,0.88)] border border-[#D9D9D9]",
    "hover:bg-gray-50 hover:border-brand-600 hover:text-brand-600",
    "active:bg-gray-100",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
  ].join(" "),

  danger: [
    "bg-white text-[#FF4D4F] border border-[#FF4D4F]",
    "hover:bg-red-50 hover:border-red-600 hover:text-red-600",
    "active:bg-red-100",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    "focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
  ].join(" "),

  ghost: [
    "bg-transparent text-[rgba(0,0,0,0.88)] border-none",
    "hover:bg-gray-100 active:bg-gray-200",
    "disabled:opacity-40 disabled:cursor-not-allowed",
    "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
  ].join(" "),

  link: [
    "bg-transparent text-brand-600 border-none p-0 h-auto underline underline-offset-2",
    "hover:text-brand-800",
    "disabled:opacity-40 disabled:cursor-not-allowed",
    "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 rounded",
  ].join(" "),
};

// ─── Size styles ─────────────────────────────────────────────────────────────
// Spec: height 32px, padding 4px 15px, font-size 14px
const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] min-w-[44px]",
  md: "h-8 px-[15px] text-[14px] min-w-[44px]",
  lg: "h-10 px-5 text-[15px] min-w-[44px]",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      iconLeft,
      iconRight,
      children,
      disabled,
      className,
      ...rest
    },
    ref
  ) {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading}
        aria-disabled={isDisabled}
        className={clsx(
          "inline-flex items-center justify-center gap-1.5",
          "font-medium rounded transition-colors duration-150 select-none whitespace-nowrap",
          variantClasses[variant],
          variant !== "link" && sizeClasses[size],
          fullWidth && "w-full",
          className
        )}
        {...rest}
      >
        {loading ? (
          <Spinner size={14} aria-hidden="true" />
        ) : (
          iconLeft && <span className="shrink-0">{iconLeft}</span>
        )}
        {children}
        {!loading && iconRight && (
          <span className="shrink-0">{iconRight}</span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

// ─── Spinner ─────────────────────────────────────────────────────────────────

function Spinner({
  size = 14,
  ...props
}: { size?: number } & React.SVGAttributes<SVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      className="animate-spin"
      {...props}
    >
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}
