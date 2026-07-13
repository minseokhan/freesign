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
      },
      keyframes: {
        "flow-rise": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "flow-pop": {
          "0%": { opacity: "0", transform: "scale(0.85)" },
          "60%": { transform: "scale(1.08)" },
          "100%": { opacity: "1", transform: "scale(1)" }
        },
        "flow-draw": {
          "0%": { strokeDashoffset: "1" },
          "70%": { strokeDashoffset: "0" },
          "100%": { strokeDashoffset: "0" }
        },
        "flow-pen": {
          "0%": { offsetDistance: "0%", opacity: "0" },
          "8%": { opacity: "1" },
          "70%": { offsetDistance: "100%", opacity: "1" },
          "78%": { opacity: "0" },
          "100%": { offsetDistance: "100%", opacity: "0" }
        },
        "flow-caret": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" }
        },
        "flow-typing": {
          "0%, 60%, 100%": { opacity: "0.35", transform: "translateY(0)" },
          "30%": { opacity: "1", transform: "translateY(-3px)" }
        },
        "flow-toggle": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(16px)" }
        },
        "flow-fill": {
          "0%": { width: "0%" },
          "100%": { width: "var(--flow-fill, 100%)" }
        }
      },
      animation: {
        "flow-rise": "flow-rise 0.5s ease-out both",
        "flow-pop": "flow-pop 0.45s ease-out both",
        "flow-draw": "flow-draw 2.4s ease-in-out infinite",
        "flow-pen": "flow-pen 2.4s ease-in-out infinite",
        "flow-caret": "flow-caret 1s step-end infinite",
        "flow-typing": "flow-typing 1.2s ease-in-out infinite",
        "flow-toggle": "flow-toggle 0.5s ease-out both",
        "flow-fill": "flow-fill 0.9s ease-out both"
      }
    }
  },
  plugins: []
};

export default config;
