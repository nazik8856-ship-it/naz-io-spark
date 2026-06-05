import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        "nazai-neon": "#00A3FF",
        "naz-logic": "hsl(142 71% 45%)",
        "naz-creation": "hsl(271 91% 65%)",
        "naz-research": "hsl(187 86% 53%)",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        glow: {
          primary: "hsl(var(--glow-primary))",
          secondary: "hsl(var(--glow-secondary))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      boxShadow: {
        "neon-blue-soft": "0 0 10px rgba(0, 163, 255, 0.4)",
        "neon-blue-hard": "0 0 20px rgba(0, 163, 255, 0.6), 0 0 40px rgba(0, 163, 255, 0.2)",
        "neon-green": "0 0 20px rgba(34, 197, 94, 0.4)",
        "neon-purple": "0 0 20px rgba(168, 85, 247, 0.4)",
        "neon-cyan": "0 0 20px rgba(6, 182, 212, 0.4)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "neon-pulse": {
          "0%, 100%": { boxShadow: "0 0 10px rgba(0, 163, 255, 0.4)" },
          "50%": { boxShadow: "0 0 25px rgba(0, 163, 255, 0.7), 0 0 50px rgba(0, 163, 255, 0.3)" },
        },
        "border-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 1px var(--glow-color, rgba(34,197,94,0.4)), 0 0 16px var(--glow-color, rgba(34,197,94,0.2))" },
          "50%": { boxShadow: "0 0 0 1px var(--glow-color, rgba(34,197,94,0.6)), 0 0 28px var(--glow-color, rgba(34,197,94,0.4))" },
        },
        "media-glow": {
          "0%, 100%": { boxShadow: "0 0 8px rgba(168,85,247,0.3)" },
          "50%": { boxShadow: "0 0 18px rgba(168,85,247,0.7)" },
        },
        "status-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "neon-pulse": "neon-pulse 2.5s ease-in-out infinite",
        "border-pulse": "border-pulse 2s ease-in-out infinite",
        "media-glow": "media-glow 1.5s ease-in-out infinite",
        "status-pulse": "status-pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
