"use client";

import { useState, useCallback } from "react";
import { clsx } from "clsx";

export type DatePreset = "today" | "7d" | "30d" | "90d" | "custom";

export interface DateRange {
  from: string; // ISO date YYYY-MM-DD
  to: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange, preset: DatePreset) => void;
  /** Which presets to show. Defaults to all. */
  presets?: DatePreset[];
  className?: string;
}

const PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  "7d":  "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  custom: "Custom",
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function presetRange(preset: Exclude<DatePreset, "custom">): DateRange {
  const today = isoToday();
  switch (preset) {
    case "today": return { from: today, to: today };
    case "7d":    return { from: isoMinus(6),  to: today };
    case "30d":   return { from: isoMinus(29), to: today };
    case "90d":   return { from: isoMinus(89), to: today };
  }
}

export function DateRangePicker({
  value,
  onChange,
  presets = ["today", "7d", "30d", "90d", "custom"],
  className,
}: DateRangePickerProps) {
  const [activePreset, setActivePreset] = useState<DatePreset>("30d");
  const [showCustom, setShowCustom] = useState(false);

  const handlePreset = useCallback(
    (preset: DatePreset) => {
      setActivePreset(preset);
      if (preset === "custom") {
        setShowCustom(true);
        return;
      }
      setShowCustom(false);
      onChange(presetRange(preset), preset);
    },
    [onChange],
  );

  const handleCustomChange = useCallback(
    (field: "from" | "to", val: string) => {
      const next = { ...value, [field]: val };
      if (next.from && next.to && next.from <= next.to) {
        onChange(next, "custom");
      }
    },
    [value, onChange],
  );

  return (
    <div className={clsx("flex flex-wrap items-center gap-1", className)}>
      {presets.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => handlePreset(p)}
          className={clsx(
            "h-7 rounded px-3 text-[12px] font-medium transition-colors",
            activePreset === p
              ? "bg-brand-600 text-white"
              : "bg-white border border-[#D9D9D9] text-[var(--color-text-primary)] hover:border-brand-600 hover:text-brand-600",
          )}
        >
          {PRESET_LABELS[p]}
        </button>
      ))}

      {showCustom && (
        <div className="flex items-center gap-1.5 ml-1">
          <input
            type="date"
            value={value.from}
            max={value.to || isoToday()}
            onChange={(e) => handleCustomChange("from", e.target.value)}
            className="h-7 rounded border border-[#D9D9D9] px-2 text-[12px] text-[var(--color-text-primary)] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-opacity-20"
            aria-label="From date"
          />
          <span className="text-[12px] text-[var(--color-text-secondary)]">–</span>
          <input
            type="date"
            value={value.to}
            min={value.from}
            max={isoToday()}
            onChange={(e) => handleCustomChange("to", e.target.value)}
            className="h-7 rounded border border-[#D9D9D9] px-2 text-[12px] text-[var(--color-text-primary)] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-opacity-20"
            aria-label="To date"
          />
        </div>
      )}
    </div>
  );
}
