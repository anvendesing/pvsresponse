/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Trust Blue Pay design system
        primary: {
          DEFAULT: "#003087",
          hover: "#00246B",
          50: "#E6EBF5",
          100: "#CCD6EB",
          600: "#003087",
          700: "#00246B",
        },
        secondary: {
          DEFAULT: "#009CDE",
        },
        neutral: {
          DEFAULT: "#687173",
        },
        ink: {
          DEFAULT: "#1A1A2E",
          muted: "#687173",
        },
        canvas: "#F5F7FA",
        surface: "#FFFFFF",
        border: {
          DEFAULT: "#CBD2D6",
        },
        success: {
          DEFAULT: "#019C34",
          soft: "#E6F4EA",
        },
        warning: {
          DEFAULT: "#F5BA2E",
          soft: "#FFF8E1",
        },
        danger: {
          DEFAULT: "#D20000",
          soft: "#FDE7E7",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["40px", { lineHeight: "1.25", fontWeight: "700", letterSpacing: "-0.02em" }],
        h1: ["32px", { lineHeight: "1.25", fontWeight: "700", letterSpacing: "-0.02em" }],
        h2: ["24px", { lineHeight: "1.25", fontWeight: "600" }],
        h3: ["20px", { lineHeight: "1.3", fontWeight: "600" }],
        body: ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        "body-sm": ["13px", { lineHeight: "1.5", fontWeight: "400" }],
        caption: ["12px", { lineHeight: "1.4", fontWeight: "500" }],
        amount: ["28px", { lineHeight: "1.2", fontWeight: "700" }],
      },
      boxShadow: {
        e1: "0 1px 4px rgba(0,48,135,0.06)",
        e2: "0 4px 16px rgba(0,48,135,0.10)",
        e3: "0 12px 32px rgba(0,48,135,0.14)",
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "8px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "fade-in": "fade-in 120ms ease-out",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
