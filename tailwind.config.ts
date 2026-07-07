import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          page: "#f8fafc",
          panel: "#ffffff",
          muted: "#f1f5f9",
          border: "#e2e8f0",
          "border-strong": "#cbd5e1"
        },
        text: {
          primary: "#0f172a",
          body: "#334155",
          muted: "#64748b",
          disabled: "#94a3b8"
        },
        brand: {
          primary: "#2563eb",
          hover: "#1d4ed8",
          ring: "#3b82f6",
          point: "#eff6ff"
        },
        status: {
          paid: {
            fg: "#16a34a",
            bg: "#f0fdf4"
          },
          waiting: {
            fg: "#d97706",
            bg: "#fffbeb"
          },
          overdue: {
            fg: "#dc2626",
            bg: "#fef2f2"
          },
          neutral: {
            fg: "#64748b",
            bg: "#f1f5f9"
          }
        }
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        "2xl": "32px",
        "3xl": "48px"
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        full: "9999px"
      },
      boxShadow: {
        raised:
          "0 1px 2px rgba(15,23,42,0.06), 0 1px 3px rgba(15,23,42,0.10)",
        overlay: "0 8px 24px rgba(15,23,42,0.12)"
      },
      fontFamily: {
        sans: ["Pretendard", ...defaultTheme.fontFamily.sans]
      }
    }
  },
  plugins: []
};

export default config;
