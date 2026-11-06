/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // design.md palette. Do not add colors outside it.
      colors: {
        donna: {
          bg: "#F7F5F0",
          surface: "#FFFFFF",
          ink: "#14130F",
          muted: "#6B6860",
          line: "#E4E0D6",
          accent: "#1F6F5C",
          "accent-soft": "#DCEEE8",
          warn: "#B7791F",
          danger: "#B42318",
          success: "#1F7A3A",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // design.md type scale: 12, 14, 16, 20, 28, 40.
      fontSize: {
        xs: ["12px", "1.5"],
        sm: ["14px", "1.5"],
        base: ["16px", "1.6"],
        lg: ["20px", "1.4"],
        xl: ["28px", "1.25"],
        "2xl": ["40px", "1.15"],
      },
      maxWidth: { content: "1120px" },
    },
  },
  plugins: [],
};
