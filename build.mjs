// Builds index.html: the React source bundled into one self-contained page.
// Usage: npm install, then npm run build
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const out = await build({
  stdin: {
    contents: 'import { createRoot } from "react-dom/client";\nimport App from "./shadow-slave-site.jsx";\ncreateRoot(document.getElementById("root")).render(<App />);',
    loader: "jsx",
    resolveDir: ".",
  },
  bundle: true,
  minify: true,
  format: "iife",
  jsx: "automatic",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
writeFileSync(
  "index.html",
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shadow Slave · The Nightmare Spell</title></head><body><div id="root"></div><script>${js}</script></body></html>\n`,
);
console.log("built index.html");
