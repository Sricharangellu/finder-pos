"use client";

import { clsx } from "clsx";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  options: SelectOption[];
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  error?: boolean;
  label?: string;
}

const sizeClasses: Record<string, string> = {
  sm: "h-7 px-2 text-[12px]",
  md: "h-8 px-3 text-[13px]",
  lg: "h-10 px-3 text-[14px]",
};

export function Select({
  options,
  placeholder,
  size = "md",
  error = false,
  label,
  className,
  id,
  ...rest
}: SelectProps) {
  const selectId = id ?? (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  const select = (
    <select
      id={selectId}
      className={clsx(
        "w-full rounded border bg-white pr-8 leading-tight",
        "appearance-none bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iOCIgdmlld0JveD0iMCAwIDEyIDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTEgMUw2IDdMMTEgMSIgc3Ryb2tlPSIjODg4IiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+')] bg-no-repeat bg-[center_right_10px]",
        "transition-colors duration-100",
        error
          ? "border-danger-500 focus:border-danger-500 focus:ring-2 focus:ring-danger-500 focus:ring-offset-0"
          : "border-[#D9D9D9] focus:border-brand-600 focus:ring-2 focus:ring-brand-600 focus:ring-opacity-20 focus:ring-offset-0",
        "text-[var(--color-text-primary)] disabled:bg-gray-50 disabled:text-[var(--color-text-secondary)] disabled:cursor-not-allowed",
        "outline-none",
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  );

  if (!label) return select;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="text-xs font-medium text-[var(--color-text-primary)]">
        {label}
      </label>
      {select}
    </div>
  );
}
