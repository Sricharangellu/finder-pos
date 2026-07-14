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
        // ── Brand (Ascend primary: #0137FC) ─────────────────────────────────
        brand: {
          50:  "#EBF0FF",
          100: "#D6E0FF",
          200: "#ADBFFF",
          300: "#85A0FF",
          400: "#5C7FFF",
          500: "#2B5FFF",
          600: "#0137FC", // primary — WCAG AA on white (5.1:1)
          700: "#002EDB",
          800: "#0025B8",
          900: "#001C94",
          950: "#001270",
        },
        // ── ERP Design Tokens ────────────────────────────────────────────────
        erp: {
          sidebar:     "#030B25", // dark navy sidebar
          "sidebar-active": "#0137FC",
          header:      "#F7F7F7",
          "header-border": "rgb(229,220,220)",
          page:        "#F9F9F9",
          "table-header": "#FAFAFA",
          "table-border": "#F0F0F0",
          "text-primary":   "rgba(0,0,0,0.88)",
          "text-secondary": "rgba(0,0,0,0.45)",
          link:        "#0137FC",
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
