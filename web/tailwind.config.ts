import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./flags/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Brand (Ascend primary: #5D5FEF) ─────────────────────────────────
        // Unified 2026-07-14: #5D5FEF was already the de facto primary across
        // ~75 pages/components (buttons, links, active tabs) despite #0137FC
        // being the only documented token. #5D5FEF matched real usage more
        // widely, so it is now the canonical brand-600 — see AGENTS.md
        // "Design System Rules". Full 50–950 ramp generated from this base.
        brand: {
          50:  "#F5F5FE",
          100: "#E8E9FD",
          200: "#CBCCFA",
          300: "#AEAFF7",
          400: "#8A8CF3",
          500: "#6D6FF1",
          600: "#5D5FEF", // primary — WCAG AA on white (4.83:1)
          700: "#5052CE",
          800: "#4344AC",
          900: "#36378B",
          950: "#292A69",
        },
        // ── ERP Design Tokens ────────────────────────────────────────────────
        erp: {
          sidebar:     "#030B25", // dark navy sidebar
          "sidebar-active": "#5D5FEF",
          header:      "#F7F7F7",
          "header-border": "rgb(229,220,220)",
          page:        "#F9F9F9",
          "table-header": "#FAFAFA",
          "table-border": "#F0F0F0",
          "text-primary":   "rgba(0,0,0,0.88)",
          "text-secondary": "rgba(0,0,0,0.45)",
          link:        "#5D5FEF",
          billed:      "#1890FF", // "Billed" status tag
          "not-billed": "#FA8C16", // "Not Billed" / "Pending"
        },
        // ── Semantic ─────────────────────────────────────────────────────────
        danger: {
          50:  "#FFF1F0",
          100: "#FFE4E2",
          500: "#FF4D4F",
          600: "#F5222D",
          700: "#CF1322",
        },
        success: {
          50:  "#F6FFED",
          100: "#D9F7BE",
          500: "#52C41A",
          600: "#389E0D",
          700: "#237804",
        },
        warning: {
          50:  "#FFFBE6",
          100: "#FFF1B8",
          500: "#FAAD14",
          600: "#D48806",
          700: "#AD6800",
        },
      },
      minHeight: { touch: "44px" },
      minWidth:  { touch: "44px" },
      fontFamily: {
        sans: [
          "-apple-system",
          '"system-ui"',
          '"Segoe UI"',
          "Roboto",
          "Oxygen",
          "Ubuntu",
          '"Helvetica Neue"',
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "erp-nav":   ["16px", { lineHeight: "1.5" }],
        "erp-table": ["13px", { lineHeight: "1.4" }],
        "erp-tag":   ["12px", { lineHeight: "1.4" }],
        "erp-ui":    ["14px", { lineHeight: "1.5" }],
      },
      borderRadius: {
        DEFAULT: "6px",
        tag: "4px",
      },
      boxShadow: {
        focus:   "0 0 0 3px rgba(1,55,252,0.3)",
        primary: "rgba(5,95,255,0.1) 0px 2px 0px 0px",
      },
      height: {
        "erp-header": "77px",
        "erp-btn":    "32px",
      },
    },
  },
  plugins: [],
};

export default config;
