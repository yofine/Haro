import type { Config } from "tailwindcss";

export default {
  content: ["./sidepanel.html", "./options.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "#e5e7eb",
        surface: "#f8fafc",
        ink: "#111827",
        muted: "#6b7280"
      }
    }
  },
  plugins: []
} satisfies Config;
