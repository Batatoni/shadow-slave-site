// Runs the console.assert self-checks of shadow-slave-site.jsx in Node, then counts animated layers per tab.
// Usage: npm run check   (exit code 1 if any self-check fails)
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const bundle = (await build({
  stdin: {
    contents: 'import App from "./shadow-slave-site.jsx";\nimport { renderToStaticMarkup } from "react-dom/server";\nimport { createElement } from "react";\nexport const render = () => renderToStaticMarkup(createElement(App));',
    loader: "jsx",
    resolveDir: ".",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  write: false,
  logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
})).outputFiles[0].text;

// The bundle is written under node_modules/.cache (ignored by git) and imported fresh for each fake browser.
const dir = join(process.cwd(), "node_modules", ".cache", "ss-check");
mkdirSync(dir, { recursive: true });
const file = join(dir, "bundle.mjs");
writeFileSync(file, bundle);
let run = 0;
/** Import a fresh copy of the bundle with a fake browser (viewport + optional __SS_PREVIEW). */
async function load(w, h, preview) {
  globalThis.window = { innerWidth: w, innerHeight: h, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {}, __SS_PREVIEW: preview };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  return import(`${pathToFileURL(file).href}?run=${run++}`);
}

// 1) Self-checks: every console.assert in the source runs once at import.
const fails = [];
let total = 0;
const assert = console.assert;
console.assert = (ok, ...msg) => { total += 1; if (!ok) fails.push(msg.join(" ")); };
const mod = await load(1440, 900);
console.assert = assert;
if (!total) { console.error("No self-checks ran."); process.exit(1); }
if (fails.length) {
  console.error(`Self-checks: ${fails.length} of ${total} FAILED`);
  fails.forEach((f) => console.error(`  ✗ ${f}`));
  process.exit(1);
}
console.log(`Self-checks: ${total}/${total} passed`);
void mod;

// 2) Animated layers: elements with a running infinite CSS animation, per tab, from a static render.
//    Counts what is mounted; layers inside a hidden (visibility) parent still count, so this is an upper bound.
const fixture = (n) => Array.from({ length: n }, (_, i) => ({
  id: `echo-check-${i}`, name: `Echo ${i + 1}`, source: "Test", rank: ["Dormant", "Awakened", "Ascended", "Transcendent", "Supreme", "Sacred", "Divine"][i % 7],
  tier: "I", shape: ["beast", "humanoid", "winged", "serpent", "swarm", ""][i % 6],
}));
const count = (html) => (html.match(/style="[^"]*animation:[^"]*infinite[^"]*"/g) || []).filter((s) => !/animation-play-state:paused/.test(s)).length;
const tabs = ["status", "memories", "echoes", "aspect"];
for (const [w, h, tag] of [[1440, 900, "desktop 1440×900"], [360, 740, "mobile 360×740"]]) {
  const rows = [];
  for (const tab of tabs) {
    for (const n of tab === "echoes" ? [0, 1, 8] : [0]) {
      const m = await load(w, h, { phase: "site", tab, echo: n > 0, patch: { addEchoes: fixture(n) } });
      try { rows.push(`${tab}${tab === "echoes" ? ` (${n} echo${n === 1 ? "" : "es"})` : ""}: ${count(m.render())}`); } catch (e) { rows.push(`${tab}: render failed (${e.message})`); }
    }
  }
  console.log(`Animated layers, ${tag} (Ranulfo, 1 Memory): ${rows.join(" · ")}`);
}
