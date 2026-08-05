import type { Config } from "tailwindcss";

// 配色は「たこ焼き＝ソースの茶／紅ショウガの赤／青のりの緑」を意識しつつ、
// 長時間見る管理画面なので彩度は抑えめ。アクセント＝amber。
const config: Config = {
  // OS の設定に追従させる。会場で切り替える運用は想定していないのでトグルは持たない。
  darkMode: "media",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Hiragino Kaku Gothic ProN",
          "Hiragino Sans",
          "Meiryo",
          "sans-serif",
        ],
      },
      colors: {
        sauce: {
          50: "#faf6f2",
          100: "#f2e8df",
          200: "#e4cfbc",
          300: "#d1ae93",
          400: "#bd8a69",
          500: "#ac6f4e",
          600: "#9a5c43",
          700: "#804a39",
          800: "#693e33",
          900: "#56342c",
        },
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
