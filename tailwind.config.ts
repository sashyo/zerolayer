import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Discord-inspired dark palette
        brand: {
          DEFAULT: "#5865F2",
          hover: "#4752C4",
          light: "#7983F5",
        },
        surface: {
          // Dark mode channel/server panels
          100: "#1e1f22", // sidebar bg
          200: "#2b2d31", // channel list bg
          300: "#313338", // main chat bg
          400: "#383a40", // input / hover
          500: "#404249", // message hover
        },
        muted: {
          DEFAULT: "#80848e",
          foreground: "#b5bac1",
        },
        status: {
          online: "#23a55a",
          idle: "#f0b232",
          dnd: "#f23f43",
          offline: "#80848e",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "slide-in": "slide-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
