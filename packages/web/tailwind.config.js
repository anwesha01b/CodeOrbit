/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Premium white, minimal (tasteskill "white-mint-tiles" palette, Swiss minimalism).
      // Semantic tokens only; components never use raw greys.
      colors: {
        canvas: { DEFAULT: "#ffffff", dim: "#fafaf9" },
        surface: "#ffffff",
        sunken: "#f5f5f3",
        line: { DEFAULT: "#e7e7e4", strong: "#d4d4d0" },
        fg: { DEFAULT: "#18181b", 2: "#3f3f46" },
        muted: "#52525b", // 7.7:1 on white
        subtle: "#6b6b73", // 5.2:1 on white — smallest text colour
        faint: "#a1a1aa", // placeholders and decoration only
        // One brand accent: deep green for links, focus and active states; mint as a highlight wash
        accent: {
          DEFAULT: "#0a7d55",
          soft: "#0a7d55",
          dim: "#086747",
          mint: "#a1ffcb",
          wash: "#ecfdf4",
        },
        live: "#1a7f37",
        warn: "#b45309",
      },
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'Geist Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        // Sharp scale for a developer tool
        DEFAULT: "6px",
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(24,24,27,0.04)",
        lift: "0 12px 32px -12px rgba(24,24,27,0.18), 0 2px 6px -2px rgba(24,24,27,0.06)",
        frame: "0 30px 60px -30px rgba(24,24,27,0.25), 0 0 0 1px rgba(24,24,27,0.06)",
      },
      letterSpacing: {
        display: "-0.045em",
        heading: "-0.03em",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        pulse_line: { "0%": { strokeDashoffset: "24" }, "100%": { strokeDashoffset: "0" } },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
