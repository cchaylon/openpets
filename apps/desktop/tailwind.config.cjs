module.exports = {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        navy: "#102149",
        muted: "#63708f",
        brand: {
          DEFAULT: "#176df2",
          light: "#3b96ff",
        },
      },
      fontFamily: {
        display: ['"SFMono-Regular"', '"Cascadia Code"', "monospace"],
      },
      boxShadow: {
        card: "0 18px 50px rgba(50, 104, 180, 0.12)",
      },
    },
  },
};
