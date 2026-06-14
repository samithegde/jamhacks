const path = require("node:path");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, "src/renderer/styles/widget-tailwind-safelist.html"),
  ],
  corePlugins: {
    preflight: false,
  },
};
