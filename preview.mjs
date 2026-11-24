// Writes preview.html: the built site opened straight on a tab, with test data, never saved to the browser.
// Usage: npm run build, then  npm run preview -- [tab] [echoes]
//   npm run preview                 → Echoes tab with the test Echo (Hollow Mendicant), selected
//   npm run preview -- echoes 8     → 8 test Echoes (the test Echo + 7 copies across shapes and Ranks)
//   npm run preview -- status 1     → Status tab with the test Echo
// Then open preview.html in a browser. preview.html is ignored by git.
import { readFileSync, writeFileSync } from "node:fs";

const [tab = "echoes", count = "1"] = process.argv.slice(2);
const n = Math.max(0, Math.min(20, Number(count) || 0));
const base = JSON.parse(readFileSync(new URL("./preview/hollow-mendicant.echo.json", import.meta.url), "utf8"));
delete base._note;
const RANKS = ["Dormant", "Awakened", "Ascended", "Transcendent", "Supreme", "Sacred", "Divine"];
const SHAPES = ["humanoid", "beast", "winged", "serpent", "swarm", ""];
const echoes = Array.from({ length: n }, (_, i) => (i === 0 ? base : {
  ...base, id: `${base.id}-${i}`, name: `${base.name} (test copy ${i})`, rank: RANKS[i % RANKS.length], tier: ["I", "II", "III", "IV", "V", "VI", "VII"][i % 7], shape: SHAPES[i % SHAPES.length],
}));
const preview = { phase: "site", tab, echo: n > 0, patch: { addEchoes: echoes } };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const inject = `<script>window.__SS_PREVIEW=${JSON.stringify(preview).replace(/</g, "\\u003c")}</script>`;
if (!html.includes('<div id="root"></div>')) throw new Error("index.html has no root div; run npm run build first");
writeFileSync(new URL("./preview.html", import.meta.url), html.replace('<div id="root"></div>', `<div id="root"></div>${inject}`));
console.log(`wrote preview.html (tab: ${tab}, ${n} test Echo${n === 1 ? "" : "es"})`);
