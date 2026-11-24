module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  darkMode: "class", // enable class-based dark mode
  theme: {
    extend: {
      colors: {
        primary: "hsl(210, 70%, 50%)",
        secondary: "hsl(260, 70%, 45%)",
        accent: "hsl(340, 70%, 55%)",
        background: "hsl(0, 0%, 98%)",
        foreground: "hsl(0, 0%, 12%)",
        "glass-bg": "rgba(255, 255, 255, 0.25)"
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"]
      },
      backdropBlur: {
        xs: "2px"
      }
    }
  },
  plugins: []
};
