import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        void: {
          darkest: "#000000",
          dark: "#0a0a0a",
          bg: "#111111",
          surface: "#1a1a1a",
          elevated: "#222222",
          hover: "#2a2a2a",
          active: "#333333",
          accent: "#808080",
          "accent-light": "#a0a0a0",
          "accent-lighter": "#c0c0c0",
          foggy: "#f5f5f5",
        },
        discord: {
          dark: "#0a0a0a",
          darker: "#000000",
          sidebar: "#111111",
          bg: "#1a1a1a",
          light: "#222222",
          hover: "#2a2a2a",
          active: "#333333",
        },
        text: {
          primary: "#f5f5f5",
          secondary: "#c0c0c0",
          muted: "#808080",
          link: "#a0a0a0",
        },
        accent: {
          primary: "#808080",
          success: "#6b6b6b",
          warning: "#7a7a7a",
          danger: "#5a5a5a",
          gold: "#8a8a8a",
        },
        status: {
          online: "#7a7a7a",
          idle: "#6a6a6a",
          dnd: "#5a5a5a",
          offline: "#4a4a4a",
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        "slide-in": "slide-in 0.2s ease-out",
        "fade-in": "fade-in 0.15s ease-out",
        "void-pulse": "void-pulse 3s ease-in-out infinite",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        "slide-in": {
          from: { transform: "translateX(-100%)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "void-pulse": {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "0.6" },
        },
      },
      boxShadow: {
        "elevation-low": "0 1px 0 rgba(0,0,0,0.4), 0 1.5px 0 rgba(0,0,0,0.2)",
        "elevation-high": "0 8px 16px rgba(0,0,0,0.6)",
        "void": "0 0 20px rgba(0,0,0,0.8)",
      },
    },
  },
  plugins: [],
};

export default config;
