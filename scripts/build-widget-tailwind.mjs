import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const inputPath = path.join(rootDir, "src/renderer/styles/widget-blueprint-tailwind.css");
const cssOutPath = path.join(rootDir, "src/renderer/styles/widget-blueprint-tailwind.build.css");
const jsOutPath = path.join(rootDir, "src/renderer/vendor/widget-blueprint-tailwind.css.js");
const tailwindConfigPath = path.join(rootDir, "tailwind.widget.config.js");

const source = fs.readFileSync(inputPath, "utf8");

const result = await postcss([
  tailwindcss(tailwindConfigPath),
  autoprefixer,
]).process(source, { from: inputPath });

fs.writeFileSync(cssOutPath, result.css, "utf8");
fs.writeFileSync(jsOutPath, `export default ${JSON.stringify(result.css)};\n`, "utf8");

console.log(`Built widget Tailwind CSS (${result.css.length} bytes)`);
