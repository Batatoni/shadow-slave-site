import { useState, useEffect, useMemo, useRef, useContext, useId, createContext, Fragment } from "react";

/**
 * Shadow Slave TTRPG: the Soul Sea site (step 1).
 * Fan-made companion for the TTRPG adaptation of "Shadow Slave" by Guiltythree.
 *
 * The background is the player's Soul Sea and every tab is a camera zoom on it:
 *   Status   = the whole Soul Sea, zoomed out
 *   Memories = the Soul Core, with each Memory orbiting it as a star (canon: Rain's Soul Sea)
 *   Aspect   = inside the Soul Core
 * Text arrives in the Spell's runes and translates into English on every tab switch.
 * Characters use the same JSON as the character sheet app (.ss.json). Saved in localStorage.
 */

/* ------------------------------------------------------------------ */
/*  Palette, type, helpers                                             */
/* ------------------------------------------------------------------ */
const C = {
  void: "#030407", ash: "#C7CDD6", dim: "#7E8794", faint: "#4A525E",
  gold: "#B99A5B", goldHi: "#D8BC7E", cyan: "#5FD3E8", danger: "#E06666",
};
const F = {
  title: "'Cinzel','Noto Sans Runic','Segoe UI Historic',serif",
  body: "'Spectral','Noto Sans Runic','Segoe UI Historic',Georgia,serif",
  mono: "'IBM Plex Mono','Noto Sans Runic','Segoe UI Historic',monospace",
};
const REDUCED = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// Set only by the build script to screenshot a given tab; undefined in normal use.
const PREVIEW = typeof window !== "undefined" ? window.__SS_PREVIEW : undefined;

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexA = (h, a) => `rgba(${rgb(h).join(",")},${a})`;
const mix = (a, b, t) => "#" + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");
const lum = (h) => { const [r, g, b] = rgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const fmt = (n) => (n >= 0 ? `+${n}` : `${n}`);
let idc = 0;
const mkId = () => `c${Date.now().toString(36)}${(idc++).toString(36)}`;
const at = (x, y, w, h = w) => ({ position: "absolute", left: x - w / 2, top: y - h / 2, width: w, height: h });

/* ------------------------------------------------------------------ */
/*  Rules engine (Master Reference, current LOCKED rules)              */
/* ------------------------------------------------------------------ */
const ATTRS = [
  { key: "STR", name: "Strength" }, { key: "DEX", name: "Dexterity" }, { key: "CON", name: "Constitution" },
  { key: "INT", name: "Intelligence" }, { key: "WIS", name: "Wisdom" }, { key: "SOUL", name: "Soul" },
];
const SCORE_MOD = [[3, -3], [5, -2], [7, -1], [11, 0], [13, 1], [15, 2], [17, 3], [19, 4], [21, 5], [25, 7], [31, 10], [41, 14], [50, 19]];
const scoreToMod = (s) => { for (const [max, m] of SCORE_MOD) if (s <= max) return m; return 19; };
const RANKS = {
  Dormant: { num: 1, dice: 1, cap: 16, vit: 0, ess: 6, title: "Dreamer" },
  Awakened: { num: 2, dice: 3, cap: 20, vit: 4, ess: 8, title: "Awakened" },
  Ascended: { num: 3, dice: 6, cap: 26, vit: 10, ess: 12, title: "Master" },
  Transcendent: { num: 4, dice: 10, cap: 36, vit: 20, ess: 16, title: "Saint" },
  Supreme: { num: 5, dice: 18, cap: 50, vit: 35, ess: 20, title: "Sovereign" },
};
const RANK_ORDER = ["Dormant", "Awakened", "Ascended", "Transcendent", "Supreme", "Sacred", "Divine"];
const CLASSES = [
  { name: "Beast", tier: "I", bonus: 1, next: 100 }, { name: "Monster", tier: "II", bonus: 1, next: 300 },
  { name: "Demon", tier: "III", bonus: 2, next: 600 }, { name: "Devil", tier: "IV", bonus: 2, next: 1000 },
  { name: "Tyrant", tier: "V", bonus: 3, next: 1500 }, { name: "Terror", tier: "VI", bonus: 4, next: 2100 },
  { name: "Titan", tier: "VII", bonus: 5, next: null },
];
const classIndex = (name) => Math.max(0, CLASSES.findIndex((c) => c.name === name)); // old sheets saved "None" = Beast

/** Pool conversion §4: +3 = a die; the +1/+2 leftover sits on ONE keen die; −3 removes a die; 0 dice = keep lowest; 20-dice cap. */
function dicePool(base, total) {
  let pool, keen, keepLowest = 0, auto = 0;
  if (total >= 0) { pool = base + Math.floor(total / 3); keen = total % 3; }
  else {
    const m = -total;
    pool = base - Math.floor(m / 3); keen = -(m % 3);
    if (pool <= 0) { keepLowest = 2 - pool; pool = 0; }
  }
  if (pool > 20) { auto = Math.floor((pool - 20) / 2); pool = 20; }
  return { pool, keen, keepLowest, auto };
}
function poolText(p) {
  const keen = p.keen ? ` · keen ${fmt(p.keen)}` : "";
  if (p.keepLowest) return `${p.keepLowest}d10 keep lowest${keen}`;
  return `${p.pool}d10${keen}${p.auto ? ` + ${p.auto} auto` : ""}`;
}
const d10 = () => 1 + Math.floor(Math.random() * 10);
/** Roll a pool: one keen die carries the ±1/±2; keep-lowest rolls N dice and only the lowest counts. */
function rollPool(p) {
  if (p.keepLowest) {
    const vs = Array.from({ length: p.keepLowest }, d10), low = vs.indexOf(Math.min(...vs));
    return { dice: vs.map((v, i) => ({ v, kept: i === low, keen: i === low ? p.keen : 0 })), auto: 0 };
  }
  return { dice: Array.from({ length: p.pool }, (_, i) => ({ v: d10(), kept: true, keen: i === 0 ? p.keen : 0 })), auto: p.auto };
}
/** 6+ succeeds (keen face included); a natural 10 is 2; each natural 1 cancels one success, or gifts one to the opponent if none is left. */
function scoreRoll({ dice, auto }) {
  let succ = auto, ones = 0, sum = 0;
  for (const d of dice) {
    sum += d.v;
    if (!d.kept) continue;
    if (d.v === 10) succ += 2; else if (d.v === 1) ones += 1; else if (d.v + d.keen >= 6) succ += 1;
  }
  return { successes: Math.max(0, succ - ones), gifted: Math.max(0, ones - succ), sum };
}
function derive(ch) {
  const rank = RANKS[ch.soulRank] || RANKS.Dormant;
  const ci = classIndex(ch.soulClass), cls = CLASSES[ci];
  const attrs = ATTRS.map((a) => {
    const score = Number(ch.attributes?.[a.key]) || 0, mod = scoreToMod(score);
    return { ...a, score, mod, pool: dicePool(rank.dice, mod + cls.bonus), over: score > rank.cap };
  });
  const get = (k) => attrs.find((a) => a.key === k);
  const dex = get("DEX").score;
  return {
    rank, ci, cls, attrs,
    vitality: get("CON").score * 2 + rank.vit,
    ap: 3 + (dex >= 50 ? 3 : dex >= 35 ? 2 : dex >= 21 ? 1 : 0),
    essence: Math.max(0, rank.num * get("SOUL").mod + rank.ess + ci * 2 * rank.num),
  };
}

/* ------------------------------------------------------------------ */
/*  Characters                                                         */
/* ------------------------------------------------------------------ */
const DEFAULT_CORE = { inner: "#EAFBFF", outer: "#5FD3E8" };
const PRESETS = [
  { name: "Spell Cyan", inner: "#EAFBFF", outer: "#5FD3E8" },
  { name: "Pale Star", inner: "#FFFFFF", outer: "#B8C7FF" },
  { name: "Black Sun", inner: "#050608", outer: "#C9D2E0" },
  { name: "Gold Dawn", inner: "#FFF4D6", outer: "#D8A84E" },
  { name: "Verdant", inner: "#EAFFF2", outer: "#3DDC97" },
  { name: "Crimson", inner: "#FFE3E3", outer: "#E0475A" },
  { name: "Violet", inner: "#F3EAFF", outer: "#9B6BFF" },
  { name: "Ember", inner: "#1A0A04", outer: "#FF7A2F" },
];

// Source: 03 Characters/Players/Ranulfo.md + Tallow-Ember.md (English text).
const RANULFO = {
  id: "ranulfo", name: "Ranulfo", trueName: "Soul of a Poet (Whispers From Above)",
  soulRank: "Dormant", soulClass: "Beast", soulShards: 0,
  attributes: { STR: 10, DEX: 10, CON: 10, INT: 12, WIS: 14, SOUL: 14 },
  training: { Willpower: 2, Insight: 1, Resonance: 1 },
  aspectName: "Word's of Power", aspectRank: "Sacred", aspectType: "Sorcery",
  aspectDescription: "Having sealed ancient pacts with the demon of truth, his words carry power beyond the ordinary. Every syllable bears supernatural weight, able to sway minds, alter events and bend the world to his will. That power has consequences: every word echoes deeply, shaping both the speaker and those who hear him.",
  abilities: [{
    id: "ab-do", name: "Power Word: Do", rank: "Dormant", type: "Sorcery", cost: "Soul Essence",
    desc: "With the force of his voice he can command creatures and beings to follow his orders. They are not suggestions but irresistible decrees, compelling everyone within earshot to obey, as long as they understand his intent.",
    effect: "Original mechanic (pre-v2): DT = (Dice ÷ 2 + Willpower) · Absolute · 3 successes against the enemy's die.",
  }],
  statusAttributes: [
    { id: "at-fated", name: "Fated", flavor: "The strings of fate wrap tightly around him; unlikely events, good and bad, are drawn to his presence.", effect: "He always follows the correct path and can force fate, turning any of his rolls into a 50/50. First time each week; resets if it fails." },
    { id: "at-tomb", name: "Tomb Raider", flavor: "Having survived the terror of the Tomb of Ariel, he has a natural resilience against fear and trauma.", effect: "Immune to threats or frightening from creatures of equal or lower Rank; +2 on resistance tests if the Rank is higher." },
  ],
  flaw: "Keeper of Truths — Cursed by the demon of truth, he cannot lie.",
  memories: [{
    id: "mem-tallow", name: "Tallow-Ember, the Nine-Hour Candle", type: "Tool", rank: "Awakened", tier: "III", image: "",
    form: "A squat black-iron candle-lantern; its single tallow candle is always half-burnt, never fresh, never gone.",
    enchantments: [
      { id: "en-wick", name: "The Waking Wick", kind: "Passive", cost: "", desc: "While lit, the candle sheds a cold light the Dream Realm's dark will not fully swallow. Within its reach (a small room), any Nightmare Creature of lower Soul Rank than the bearer must hesitate to enter the lit zone; treat it as difficult ground for them to cross into. No bonus to hit, no damage; it only makes ambush cost the dark something." },
      { id: "en-snuff", name: "Snuff the Hour", kind: "Active", cost: "2 AP · 1 Soul Essence", desc: "Snuff the candle and choose one. Reveal: name one creature or hazard you see; the GM tells you one true, exploitable weakness. This satisfies the \"observed weak point\" clause for a dice-bypass plan against the Impossibility Threshold. Steady: until your next turn, allies in the light may reroll 1 die on their next Avoid, Endure, or escape roll. Relight for 1 AP; the passive works only while lit, so each use trades your safety-light for the effect." },
    ],
  }],
  echoes: [],
};

const safeImg = (s) => (typeof s === "string" && /^(data:image\/|https?:\/\/)/.test(s) ? s : "");
const arr = (v) => (Array.isArray(v) ? v : []);
/** Fill defaults on any character (seed, localStorage, or an imported .ss.json). */
function normalize(raw) {
  const c = {
    name: "", trueName: "", soulRank: "Dormant", soulClass: "Beast", soulShards: 0,
    attributes: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, SOUL: 10 }, training: {},
    aspectName: "", aspectRank: "Dormant", aspectType: "", aspectDescription: "",
    innateAbility: "", aspectLegacy: "", legacyRelic: "", flaw: "", ...raw,
  };
  c.id = typeof c.id === "string" && c.id ? c.id : mkId();
  c.soulClass = CLASSES[classIndex(c.soulClass)].name;
  c.abilities = arr(c.abilities); c.statusAttributes = arr(c.statusAttributes); c.echoes = arr(c.echoes);
  c.conditions = arr(c.conditions); c.wounds = Math.max(0, Math.min(3, Number(c.wounds) || 0));
  c.memories = arr(c.memories).map((m) => ({ ...m, id: m.id || mkId(), image: safeImg(m.image), enchantments: arr(m.enchantments) }));
  const core = c.core || {};
  c.core = { inner: HEX.test(core.inner) ? core.inner : DEFAULT_CORE.inner, outer: HEX.test(core.outer) ? core.outer : DEFAULT_CORE.outer };
  return c;
}
/** "Keeper of Truths — he cannot lie" → name + description. */
function splitFlaw(s = "") {
  const m = String(s).match(/^\s*\[?([^\]—:]+?)\]?\s*(?:—|:|\s-)\s+([\s\S]*)$/);
  return m ? { name: m[1].trim(), desc: m[2].trim() } : { name: String(s).trim(), desc: "" };
}

const LS_KEY = "ss-soul-sea-v1";
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && Array.isArray(s.roster) && s.roster.length) return { roster: s.roster.map(normalize), activeId: s.activeId || null };
  } catch { /* first visit or blocked storage */ }
  return { roster: [normalize(RANULFO)], activeId: null };
}

/* ------------------------------------------------------------------ */
/*  Runes: text arrives as runes and resolves into English             */
/* ------------------------------------------------------------------ */
const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟᚪᚫᚣᛡᛠ";
const RUNE_STYLE = { color: C.cyan, WebkitTextFillColor: C.cyan, textShadow: `0 0 8px ${hexA(C.cyan, 0.75)}` };
const DelayCtx = createContext(0);

/** One frame of the decode, as segments of {t, rune}. p: 0 = all runes … 1 = all English. */
function decodeSegments(text, p, tick) {
  const segs = [], n = Math.max(1, text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const rune = ch.trim() !== "" && (p <= 0 || p < (i / n) * 0.7 + hash(i) * 0.3);
    const t = rune ? RUNES[Math.floor(hash(i * 13 + tick) * RUNES.length)] : ch;
    const last = segs[segs.length - 1];
    if (last && last.rune === rune) last.t += t; else segs.push({ t, rune });
  }
  return segs;
}
function useDecode(text, delay) {
  const dur = Math.min(1500, 420 + text.length * 8);
  const [frame, setFrame] = useState(() => (REDUCED ? null : decodeSegments(text, 0, 0)));
  useEffect(() => {
    if (REDUCED) return undefined;
    let raf, t0, last = -1;
    setFrame(decodeSegments(text, 0, 0));
    const step = (t) => {
      if (t0 === undefined) t0 = t;
      const el = t - t0, p = (el - delay) / dur;
      if (p >= 1) { setFrame(null); return; }
      const tick = Math.floor(el / 75); // ~13 rune changes a second
      if (tick !== last) { last = tick; setFrame(decodeSegments(text, p, tick)); }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, delay, dur]);
  return frame;
}
function Rune({ text, delay = 0, block, style }) {
  const s = text == null ? "" : String(text);
  const frame = useDecode(s, useContext(DelayCtx) + delay);
  if (!frame) return block ? <div style={style}>{s}</div> : <span style={style}>{s}</span>;
  const runes = frame.map((g, i) => (g.rune ? <span key={i} style={RUNE_STYLE}>{g.t}</span> : <Fragment key={i}>{g.t}</Fragment>));
  // inline text decodes in place; paragraphs overlay a hidden copy so the layout doesn't jump
  if (!block) return <span aria-label={s} style={style}>{runes}</span>;
  return (
    <div aria-label={s} style={{ ...style, position: "relative" }}>
      <span style={{ visibility: "hidden" }}>{s}</span>
      <span aria-hidden="true" style={{ position: "absolute", inset: 0 }}>{runes}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small UI pieces                                                    */
/* ------------------------------------------------------------------ */
const label = { fontFamily: F.mono, fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: hexA(C.cyan, 0.85) };

function Panel({ title, children, accent = C.cyan, delay = 0.5, style }) {
  return (
    <section style={{
      position: "relative", background: "rgba(6,9,14,0.88)",
      border: `1px solid ${hexA(accent, 0.3)}`, borderRadius: 2, padding: "24px 22px 20px",
      animation: REDUCED ? undefined : `ssFadeIn .9s ease ${delay}s both`, ...style,
    }}>
      <Corners color={accent} />
      {title && (
        <div style={{ ...label, color: accent, position: "absolute", top: -8, left: 16, padding: "0 8px", background: C.void, lineHeight: "16px" }}>
          ▏ <Rune text={title} /> ▏
        </div>
      )}
      {children}
    </section>
  );
}

function Line({ k, delay = 0, children, accent }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(96px, 128px) 1fr", gap: 12, padding: "8px 0", borderBottom: `1px solid ${hexA(C.cyan, 0.08)}`, alignItems: "baseline" }}>
      <span style={{ ...label, color: accent || label.color }}><Rune text={k} delay={delay} />:</span>
      <span style={{ fontFamily: F.body, fontSize: 16.5, color: C.ash, lineHeight: 1.55 }}>{children}</span>
    </div>
  );
}

function Tag({ text, onClick, color = C.cyan, delay = 0, active }) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp onClick={onClick} style={{
      background: active ? hexA(color, 0.14) : "transparent", border: "none", padding: "0 3px", margin: "0 6px 0 0",
      cursor: onClick ? "pointer" : "default", fontFamily: F.body, fontSize: 16.5, color, textShadow: `0 0 12px ${hexA(color, 0.5)}`,
    }}>[<Rune text={text} delay={delay} />]</Comp>
  );
}

function Badge({ children, color = C.cyan }) {
  return <span style={{ ...label, fontSize: 9.5, color, border: `1px solid ${hexA(color, 0.4)}`, padding: "4px 10px", borderRadius: 20 }}>{children}</span>;
}

function Stat({ k, v, sub }) {
  return (
    <div style={{ border: `1px solid ${hexA(C.cyan, 0.14)}`, background: "rgba(3,4,7,0.5)", padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontFamily: F.title, fontSize: 26, color: C.cyan, textShadow: `0 0 14px ${hexA(C.cyan, 0.45)}` }}>{v}</div>
      <div style={{ ...label, fontSize: 9, color: C.ash, marginTop: 2 }}><Rune text={k} /></div>
      {sub && <div style={{ fontFamily: F.mono, fontSize: 9, color: C.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const sphereBg = (inner, outer) =>
  `radial-gradient(circle at 38% 34%, ${mix(inner, "#ffffff", lum(inner) < 0.2 ? 0.16 : 0.55)} 0%, ${inner} 30%, ${mix(inner, outer, 0.55)} 72%, ${outer} 94%, ${hexA(outer, 0.7)} 100%)`;

function MiniSun({ inner, outer, size = 30 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", flex: "none", background: sphereBg(inner, outer), boxShadow: `0 0 ${size * 0.55}px ${hexA(outer, 0.6)}` }} />;
}

function IconBtn({ onClick, title, children }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} style={{
      width: 36, height: 36, borderRadius: "50%", border: `1px solid ${hexA(C.cyan, 0.35)}`, background: "rgba(6,9,14,0.7)",
      color: C.cyan, cursor: "pointer", fontSize: 15, display: "grid", placeItems: "center",
    }}>{children}</button>
  );
}

const btn = (color = C.cyan) => ({
  background: hexA(color, 0.08), border: `1px solid ${hexA(color, 0.5)}`, color, borderRadius: 2, padding: "9px 16px",
  fontFamily: F.mono, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer",
});
const inputStyle = {
  background: "rgba(3,4,7,0.7)", border: `1px solid ${hexA(C.cyan, 0.25)}`, color: C.ash, borderRadius: 2,
  padding: "9px 12px", fontFamily: F.body, fontSize: 15, outline: "none",
};

/* ------------------------------------------------------------------ */
/*  Memory stars: the look grows with the Memory's Rank                */
/* ------------------------------------------------------------------ */
const STARS = {
  Dormant: { c: "#C9D1DB", r: 2.2, n: 0, len: 0 },
  Awakened: { c: "#E6F7FF", r: 2.6, n: 4, len: 7 },
  Ascended: { c: "#7FE3F2", r: 3, n: 4, len: 10 },
  Transcendent: { c: "#A8EBFF", r: 3.2, n: 6, len: 11, ring: 1 },
  Supreme: { c: "#E3C98A", r: 3.6, n: 8, len: 12 },
  Sacred: { c: "#FFE2A0", r: 4, n: 8, len: 13, ring: 1, pulse: 1 },
  Divine: { c: "#FFF6DD", r: 4.6, n: 12, len: 14, ring: 2, pulse: 1 },
};
const rankIdx = (r) => Math.max(0, RANK_ORDER.indexOf(r));

function StarDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {RANK_ORDER.map((r, i) => (
          <radialGradient key={r} id={`ssg-${i}`}>
            <stop offset="0" stopColor={STARS[r].c} stopOpacity="0.6" />
            <stop offset="1" stopColor={STARS[r].c} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
    </svg>
  );
}

function StarIcon({ rank, size = 28, active }) {
  const s = STARS[rank] || STARS.Dormant;
  const k = s.n / 2;
  return (
    <svg width={size} height={size} viewBox="-16 -16 32 32" style={{ overflow: "visible", display: "block" }} aria-hidden="true">
      <circle r={s.r * 3.6} fill={`url(#ssg-${rankIdx(rank)})`} />
      <g fill={s.c} style={s.pulse && !REDUCED ? { animation: "ssPulse 2.6s ease-in-out infinite", transformBox: "fill-box", transformOrigin: "center" } : undefined}>
        {Array.from({ length: k }, (_, i) => {
          const L = s.len * (s.n >= 8 && i % 2 ? 0.55 : 1);
          return <polygon key={i} points={`0,${-L} 0.8,0 0,${L} -0.8,0`} transform={`rotate(${(i * 180) / k})`} opacity="0.9" />;
        })}
        <circle r={s.r} />
        {s.ring >= 1 && <circle r={s.r + 4.5} fill="none" stroke={s.c} strokeOpacity="0.55" strokeWidth="0.6" />}
        {s.ring >= 2 && <circle r={s.r + 8} fill="none" stroke={s.c} strokeOpacity="0.35" strokeWidth="0.5" strokeDasharray="1.5 2.5" />}
      </g>
      {active && <circle r="13" fill="none" stroke={C.cyan} strokeWidth="0.8" strokeDasharray="3 3"
        style={{ animation: "ssSpin 8s linear infinite", transformBox: "fill-box", transformOrigin: "center" }} />}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  The Soul Sea scene (world coordinates; the camera zooms it)        */
/* ------------------------------------------------------------------ */
const R = 64, SEA_Y = 300, ORBITS = [R * 2.35, R * 3, R * 3.65], ORBIT_S = [150, 210, 280];
const ringOf = (rank) => { const i = RANK_ORDER.indexOf(rank); return i < 2 ? 0 : i < 4 ? 1 : 2; };

/** Where the sun sits on screen and how big, per tab. x/y = the sun's offset from screen center. */
function camera(view, w, h) {
  const u = Math.min(w, h) / 800, wide = w >= 980;
  if (view === "aspect") return { s: 13 * u, x: 0, y: 0 };
  if (view === "memories") return wide ? { s: 1.15 * u, x: -w * 0.02, y: h * 0.03 } : { s: 0.95 * u, x: 0, y: -h * 0.2 };
  const status = wide ? { s: 0.62 * u, x: w * 0.22, y: -h * 0.04 } : { s: 0.5 * u, x: 0, y: -h * 0.24 };
  return view === "birth" ? { ...status, s: 0.015 } : status;
}

function Sea({ inner, outer }) {
  const W = 7000, H = 2400, top = SEA_Y - 70, gw = 400, gh = 1500;
  const lines = useMemo(() => Array.from({ length: 34 }, (_, k) => SEA_Y + 2.4 * Math.pow(k + 1, 1.75)), []);
  // the sun's reflection: three groups of glints shimmer out of step (one GPU fade per group, not one animation per glint)
  const glints = useMemo(() => [0, 1, 2].map((g) => Array.from({ length: 16 }, (_, i) => {
    const j = i * 3 + g;
    return { y: SEA_Y + 6 + 2.6 * Math.pow(j, 1.55), w: 10 + j * 2.2 * (0.5 + hash(j)), x: (hash(j + 99) - 0.5) * (14 + j * 2.4), h: 1.6 + j * 0.05, c: j % 3 };
  })), []);
  return (
    <>
      <svg width={W} height={H} viewBox={`${-W / 2} ${top} ${W} ${H}`} style={{ position: "absolute", left: -W / 2, top }} aria-hidden="true">
        <defs>
          <linearGradient id="ssSea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={outer} stopOpacity="0" />
            <stop offset={70 / H} stopColor={outer} stopOpacity="0.2" />
            <stop offset={170 / H} stopColor="#05070B" stopOpacity="0.96" />
            <stop offset="1" stopColor="#020305" stopOpacity="1" />
          </linearGradient>
          <radialGradient id="ssGlow">
            <stop offset="0" stopColor={outer} stopOpacity="0.16" />
            <stop offset="1" stopColor={outer} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x={-W / 2} y={top} width={W} height={H} fill="url(#ssSea)" />
        <ellipse cx="0" cy={SEA_Y - 4} rx="900" ry="30" fill="url(#ssGlow)" />
        <line x1={-W / 2} x2={W / 2} y1={SEA_Y} y2={SEA_Y} stroke={hexA(outer, 0.55)} strokeWidth="1.2" />
        {lines.map((y, k) => {
          const a = 60 + k * 9, g = 22 + k * 4, b = 8 + k;
          return <line key={k} x1={-W / 2} x2={W / 2} y1={y} y2={y} stroke={hexA(outer, 0.17 * (1 - k / 34))} strokeWidth={0.6 + k * 0.05} strokeDasharray={`${a} ${g} ${b} ${g}`} />;
        })}
        <ellipse cx="0" cy={SEA_Y + 260} rx="170" ry="300" fill="url(#ssGlow)" />
      </svg>
      {glints.map((set, g) => (
        <svg key={g} width={gw} height={gh} viewBox={`${-gw / 2} ${SEA_Y} ${gw} ${gh}`} aria-hidden="true"
          style={{ position: "absolute", left: -gw / 2, top: SEA_Y, opacity: 0.45, animation: REDUCED ? undefined : `ssShimmer ${2.6 + g * 0.9}s ease-in-out ${-g * 1.1}s infinite` }}>
          {set.map((s, i) => <rect key={i} x={s.x - s.w / 2} y={s.y} width={s.w} height={s.h} rx="1" fill={s.c ? outer : inner} />)}
        </svg>
      ))}
    </>
  );
}

// Everything around the core shares one CSS 3D space, so tilted rings and orbits really pass behind the sphere.
const P3 = { position: "absolute", left: 0, top: 0, transformStyle: "preserve-3d" };
const ORBIT_TILT = [[72, -14], [66, 20], [76, -32]]; // [tilt away from the viewer, turn on screen] per orbit, like an orrery
const surface = (i, o) => [
  `radial-gradient(ellipse 9% 12% at 14% 30%, ${hexA(o, 0.6)}, transparent)`,
  `radial-gradient(ellipse 7% 9% at 31% 66%, ${hexA(i, 0.7)}, transparent)`,
  `radial-gradient(ellipse 11% 8% at 52% 40%, ${hexA(o, 0.5)}, transparent)`,
  `radial-gradient(ellipse 6% 10% at 70% 72%, ${hexA(i, 0.6)}, transparent)`,
  `radial-gradient(ellipse 8% 9% at 86% 24%, ${hexA(o, 0.45)}, transparent)`,
  `repeating-linear-gradient(0deg, transparent 0 9%, ${hexA(o, 0.14)} 10% 12%, transparent 13% 19%)`,
].join(",");

/** A shaded sphere: highlight, limb darkening, rim light. `turning` slides a surface across it so it reads as rotating. */
function Sphere({ inner, outer, d, turning }) {
  return (
    <div style={{ ...at(0, 0, d), borderRadius: "50%", overflow: "hidden", background: sphereBg(inner, outer), boxShadow: `0 0 ${d * 0.15}px ${hexA(outer, 0.85)}, 0 0 ${d * 0.45}px ${hexA(outer, 0.35)}` }}>
      {turning && <div style={{ position: "absolute", left: 0, top: 0, width: d * 4, height: d, opacity: 0.8, backgroundImage: surface(inner, outer), backgroundSize: `${d * 2}px ${d}px`, animation: REDUCED ? undefined : "ssSlide 30s linear infinite" }} />}
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle at 34% 30%, rgba(255,255,255,.5) 0%, rgba(255,255,255,0) 20%), radial-gradient(circle at 46% 42%, transparent 50%, ${hexA(mix(outer, "#000000", 0.45), 0.65)} 100%)` }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", boxShadow: `inset 0 0 ${d * 0.16}px ${hexA(outer, 0.9)}, inset ${-d * 0.1}px ${-d * 0.12}px ${d * 0.3}px rgba(0,0,0,.35)` }} />
    </div>
  );
}

function Core3D({ ch, ci, far, sel, onPick, active }) {
  const { inner, outer } = ch.core;
  const glow = 0.55 + (ci / 6) * 0.45; // Class = how saturated the one core is (Open Issue #3)
  // more runes than the band holds; the path clips the rest, so the band always closes
  const band = useMemo(() => Array.from({ length: 130 }, (_, i) => RUNES[Math.floor(hash(i * 3.1) * RUNES.length)]).join(""), []);
  const rr = 124;
  return (
    <div style={{ ...P3, perspective: 900 }}>
      <div style={{ ...at(0, 0, R * 10), borderRadius: "50%", background: `radial-gradient(circle, ${hexA(outer, 0.26 * glow)} 0%, ${hexA(outer, 0.1 * glow)} 28%, transparent 62%)`, animation: "ssBreath 8s ease-in-out infinite" }} />
      <div style={{ ...at(0, 0, R * 6), borderRadius: "50%", background: `repeating-conic-gradient(${hexA(outer, 0.22 * glow)} 0deg 1.4deg, transparent 1.4deg 8deg)`,
        WebkitMaskImage: "radial-gradient(circle, #000 25%, transparent 68%)", maskImage: "radial-gradient(circle, #000 25%, transparent 68%)", animation: "ssSpin 180s linear infinite" }} />
      <div style={{ ...at(0, 0, R * 3.4), borderRadius: "50%", background: `radial-gradient(circle, ${hexA(outer, 0.7 * glow)} 0%, ${hexA(outer, 0.25 * glow)} 42%, transparent 70%)` }} />
      {Array.from({ length: ci + 1 }, (_, i) => { // one gyroscope ring per Class step
        const rad = R * 1.24 + i * R * 0.09, tilt = 58 + ((i * 7) % 20), turn = -55 + ((i * 41) % 110);
        return (
          <div key={i} style={{ ...P3, ...far, transform: `rotateZ(${turn}deg) rotateX(${tilt}deg)` }}>
            <svg viewBox={`${-rad - 2} ${-rad - 2} ${rad * 2 + 4} ${rad * 2 + 4}`} style={{ ...at(0, 0, rad * 2 + 4), animation: `ssSpin ${34 + i * 9}s linear infinite${i % 2 ? " reverse" : ""}` }} aria-hidden="true">
              <circle r={rad} fill="none" stroke={hexA(outer, 0.62 - i * 0.05)} strokeWidth="1.2" strokeDasharray={i % 2 ? "2 6" : "24 6 4 6"} />
            </svg>
          </div>
        );
      })}
      <div style={{ ...P3, ...far, transform: "rotateZ(-10deg) rotateX(64deg)" }}>
        <svg viewBox="-150 -150 300 300" style={{ ...at(0, 0, 300), animation: "ssSpin 120s linear infinite reverse" }} aria-hidden="true">
          <defs><path id="ssRing" d={`M ${-rr},0 a ${rr},${rr} 0 1,1 ${2 * rr},0 a ${rr},${rr} 0 1,1 ${-2 * rr},0`} /></defs>
          <text fill={hexA(outer, 0.62)} fontSize="11" letterSpacing="2.6" fontFamily={F.mono}><textPath href="#ssRing">{band}</textPath></text>
        </svg>
      </div>
      <Sphere inner={inner} outer={outer} d={R * 2} turning />
      <Orbits memories={ch.memories} outer={outer} sel={sel} onPick={onPick} active={active} far={far} />
    </div>
  );
}

/** "Both" (Toni, 2026-11-17): faint ghost suns gauge the Class steps. A Divine Aspect holder's are real cores (canon). */
function GhostSuns({ n, inner, outer, real }) {
  return Array.from({ length: n }, (_, i) => {
    const a = ((200 + ((i + 0.5) * 140) / n) * Math.PI) / 180, rad = 420 + (i % 2) * 80;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad, r = real ? 34 : 20;
    return (
      <div key={i} style={{ opacity: real ? 1 : 0.38 }}>
        <div style={{ ...at(x, y, r * 6), borderRadius: "50%", background: `radial-gradient(circle, ${hexA(outer, 0.45)} 0%, ${hexA(outer, 0.12)} 35%, transparent 65%)`, animation: `ssBreath ${7 + i}s ease-in-out ${-i * 1.3}s infinite` }} />
        <div style={{ position: "absolute", left: x, top: y }}><Sphere inner={inner} outer={outer} d={r * 2} /></div>
      </div>
    );
  });
}

/** Memories as stars on tilted orbits; each star is turned back to face the viewer, so it stays round while it circles. */
function Orbits({ memories, outer, sel, onPick, active, far }) {
  const [hover, setHover] = useState(null);
  const rings = [[], [], []];
  memories.forEach((m) => rings[ringOf(m.rank)].push(m));
  const play = { animationPlayState: hover ? "paused" : "running" };
  return ORBITS.map((rad, ri) => {
    const [tilt, turn] = ORBIT_TILT[ri], dur = ORBIT_S[ri], dir = ri % 2 ? " reverse" : "", back = ri % 2 ? "" : " reverse";
    return (
      <div key={ri} style={{ ...P3, ...far, pointerEvents: active ? "auto" : "none", transform: `rotateZ(${turn}deg) rotateX(${tilt}deg)` }}>
        {rings[ri].length > 0 && <div style={{ ...at(0, 0, rad * 2), borderRadius: "50%", pointerEvents: "none", transition: "border-color .4s",
          border: `1px solid ${hexA(outer, rings[ri].some((m) => m.id === sel || m.id === hover) ? 0.16 : 0.05)}` }} />}
        <div style={{ ...P3, animation: `ssSpin ${dur}s linear infinite${dir}`, ...play }}>
          {rings[ri].map((m, k) => {
            const a = (k / rings[ri].length) * Math.PI * 2 + ri * 0.9;
            const on = sel === m.id, hot = hover === m.id;
            return (
              <div key={m.id} style={{ ...P3, left: Math.cos(a) * rad, top: Math.sin(a) * rad }}>
                <div style={{ ...P3, animation: `ssSpin ${dur}s linear infinite${back}`, ...play }}>
                  <div style={{ ...P3, transform: `rotateX(${-tilt}deg) rotateZ(${-turn}deg)` }}>
                    <button aria-label={m.name || "Memory"} onClick={() => onPick(m.id)}
                      onMouseEnter={() => setHover(m.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(m.id)} onBlur={() => setHover(null)}
                      style={{ position: "absolute", left: -17, top: -17, width: 34, height: 34, padding: 0, border: "none", background: "transparent",
                        cursor: "pointer", transform: hot ? "scale(1.35)" : "none", transition: "transform .25s" }}>
                      <StarIcon rank={m.rank} size={34} active={on} />
                    </button>
                    {active && (on || hot) && (
                      <div style={{ position: "absolute", left: 20, top: -7, whiteSpace: "nowrap", fontFamily: F.mono, fontSize: 9, letterSpacing: 1.2, color: C.ash, textShadow: "0 0 6px #000, 0 0 2px #000", pointerEvents: "none" }}>
                        {m.name}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  });
}

function Scene({ ch, d, tab, cam, sel, onPick }) {
  const { inner, outer } = ch.core;
  const deep = tab === "aspect";
  const far = { visibility: deep ? "hidden" : "visible", transition: `visibility 0s linear ${deep ? 1.6 : 0}s` };
  return (
    <div style={{
      position: "fixed", left: "50%", top: "50%", width: 0, height: 0, transformOrigin: "0 0",
      transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.s})`, visibility: deep ? "hidden" : "visible",
      transition: REDUCED ? "none" : `transform 1.7s cubic-bezier(.66,0,.24,1), visibility 0s linear ${deep ? 2.2 : 0}s`,
    }}>
      <div style={far}><Sea inner={inner} outer={outer} /></div>
      <div style={far}><GhostSuns n={d.ci} inner={inner} outer={outer} real={ch.aspectRank === "Divine"} /></div>
      <Core3D ch={ch} ci={d.ci} far={far} sel={sel} onPick={onPick} active={tab === "memories"} />
    </div>
  );
}

/** Four layers of stars; three twinkle as whole layers (cheap GPU fades instead of one animation per star). */
function Starfield({ hidden }) {
  const layers = useMemo(() => [0, 1, 2, 3].map((g) => Array.from({ length: 28 }, (_, i) => {
    const n = g * 97 + i;
    return { x: hash(n + 1) * 100, y: hash(n + 501) * 100, s: hash(n + 901) < 0.85 ? 1 : 2 };
  })), []);
  if (hidden) return null;
  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0 }}>
      {layers.map((stars, g) => (
        <div key={g} style={{ position: "absolute", inset: 0, opacity: 0.5, animation: g && !REDUCED ? `ssTwinkle ${3 + g * 1.6}s ease-in-out ${-g * 1.3}s infinite` : undefined }}>
          {stars.map((s, i) => <span key={i} style={{ position: "absolute", left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, borderRadius: "50%", background: "#cfd8e6" }} />)}
        </div>
      ))}
    </div>
  );
}

function CoreInterior({ show, inner, outer }) {
  const motes = useMemo(() => [0, 1, 2].map((g) => Array.from({ length: 14 }, (_, i) => {
    const n = g * 50 + i;
    return { x: hash(n + 3) * 100, y: 30 + hash(n + 300) * 80, s: 1 + hash(n + 600) * 2.5 };
  })), []);
  const runes = useMemo(() => Array.from({ length: 220 }, (_, i) => RUNES[Math.floor(hash(i * 5.7) * RUNES.length)]).join(""), []);
  if (!show) return null; // nothing inside the core runs while you are outside it
  // the rune rings seen from inside the core: [radius, seconds per turn, direction, alpha]
  const rings = [[300, 120, "", 0.22], [215, 90, " reverse", 0.16], [140, 70, "", 0.1]];
  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", animation: REDUCED ? undefined : "ssFade 1.3s ease .8s both" }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 40%, ${hexA(mix(inner, outer, 0.3), 0.62)} 0%, ${hexA(outer, 0.4)} 38%, rgba(3,4,7,.94) 100%), rgba(3,4,7,.6)` }} />
      <div style={{ position: "absolute", inset: "-60%", animation: REDUCED ? undefined : "ssSpin 120s linear infinite",
        background: `conic-gradient(from 0deg, transparent 0 6%, ${hexA(outer, 0.16)} 14%, transparent 24%, ${hexA(inner, 0.12)} 38%, transparent 52%, ${hexA(outer, 0.18)} 66%, transparent 80%, ${hexA(inner, 0.1)} 90%, transparent)` }} />
      {rings.map(([r, dur, dir, a], i) => {
        const s = (2 * r + 20) / 6.4; // in vmax: the size the rings had on the old full-screen 640-unit canvas
        return (
          <svg key={i} viewBox={`${-r - 10} ${-r - 10} ${2 * r + 20} ${2 * r + 20}`} style={{ position: "absolute", width: `${s}vmax`, height: `${s}vmax`, left: `calc(50% - ${s / 2}vmax)`, top: `calc(50% - ${s / 2}vmax)`, animation: REDUCED ? undefined : `ssSpin ${dur}s linear infinite${dir}` }}>
            <path id={`ssIn${i}`} d={`M ${-r},0 a ${r},${r} 0 1,1 ${2 * r},0 a ${r},${r} 0 1,1 ${-2 * r},0`} fill="none" stroke={hexA(outer, a * 0.6)} strokeWidth="0.5" />
            <text fill={hexA(outer, a)} fontSize={10 + i * -1.5} letterSpacing="4" fontFamily={F.mono}><textPath href={`#ssIn${i}`}>{runes}</textPath></text>
          </svg>
        );
      })}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 45%, rgba(3,4,7,.35) 0%, rgba(3,4,7,.8) 80%)" }} />
      {motes.map((set, g) => (
        <div key={g} style={{ position: "absolute", inset: 0, animation: REDUCED ? undefined : `ssRise ${14 + g * 5}s linear ${-g * 4.5}s infinite` }}>
          {set.map((m, i) => <span key={i} style={{ position: "absolute", left: `${m.x}%`, top: `${m.y}%`, width: m.s, height: m.s, borderRadius: "50%", background: i % 3 ? outer : inner, boxShadow: `0 0 6px ${outer}` }} />)}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Opening: black screen, the Spell speaks                            */
/* ------------------------------------------------------------------ */
function Intro({ who, onDone }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const ts = [setTimeout(() => setStep(1), 500), setTimeout(() => setStep(2), 1900), setTimeout(() => setStep(3), 3600), setTimeout(onDone, 6200)];
    return () => ts.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const l1 = who ? `${who.title} ${who.name}.` : "Aspirant!";
  const l2 = who ? "Welcome back to the Nightmare Spell." : "Welcome to the Nightmare Spell.";
  return (
    <div role="button" tabIndex={0} onClick={onDone} onKeyDown={onDone} aria-label="Continue"
      style={{ position: "fixed", inset: 0, background: "#000", display: "grid", placeItems: "center", cursor: "pointer", outline: "none" }}>
      <div style={{ textAlign: "center", padding: 24 }}>
        <div style={{ minHeight: 52 }}>
          {step >= 1 && <Rune block text={l1} style={{ fontFamily: F.title, fontSize: "clamp(26px, 4vw, 44px)", letterSpacing: 6, color: "#E9F1F7", textShadow: `0 0 24px ${hexA(C.cyan, 0.5)}` }} />}
        </div>
        <div style={{ height: 1, width: "min(420px, 70vw)", margin: "22px auto", background: `linear-gradient(90deg, transparent, ${C.cyan}, transparent)`,
          transformOrigin: "center", animation: step >= 2 && !REDUCED ? "ssLine 1.4s ease both" : undefined, opacity: step >= 2 ? 1 : 0 }} />
        <div style={{ minHeight: 30 }}>
          {step >= 2 && <Rune block text={l2} style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "clamp(17px, 2vw, 22px)", letterSpacing: 1, color: C.ash }} />}
        </div>
        <div style={{ ...label, fontSize: 9, color: C.faint, marginTop: 40, opacity: step >= 3 ? 1 : 0, transition: "opacity 1s" }}>click to continue</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  First visit: choose who you are (remembered on this device)        */
/* ------------------------------------------------------------------ */
function SelectScreen({ roster, activeId, onBind, onImport }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const readFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const raw = JSON.parse(r.result);
        if (!raw || typeof raw !== "object" || typeof raw.name !== "string" || !raw.name.trim()) throw new Error("no name");
        onBind(onImport(raw));
      } catch {
        setErr("The Spell cannot read this file. Use a .ss.json exported from the character sheet.");
      }
    };
    r.readAsText(f);
  };
  const create = () => { const n = name.trim(); if (n) onBind(onImport({ name: n })); };
  return (
    <div style={{ position: "fixed", inset: 0, overflowY: "auto", display: "grid", placeItems: "center", padding: "48px 16px" }}>
      <Starfield />
      <div style={{ position: "relative", width: "min(760px, 100%)", textAlign: "center" }}>
        <div style={{ ...label, letterSpacing: 4 }}>▏ <Rune text="Nightmare Spell" /> ▏</div>
        <Rune block text="Identify yourself, Aspirant." delay={200} style={{ fontFamily: F.title, fontSize: "clamp(26px, 4vw, 38px)", letterSpacing: 3, color: "#E9F1F7", margin: "16px 0 8px", textShadow: `0 0 20px ${hexA(C.cyan, 0.35)}` }} />
        <Rune block text="Choose the soul you carry. The Spell will remember it." delay={500} style={{ fontFamily: F.body, fontStyle: "italic", color: C.dim, fontSize: 17 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, margin: "36px 0 26px", textAlign: "left" }}>
          {roster.map((c, i) => {
            const d = derive(c);
            return (
              <button key={c.id} onClick={() => onBind(c.id)} style={{
                display: "flex", gap: 14, alignItems: "center", padding: "16px 16px", cursor: "pointer", textAlign: "left",
                background: "rgba(6,9,14,0.8)", border: `1px solid ${hexA(c.core.outer, c.id === activeId ? 0.8 : 0.3)}`, borderRadius: 2,
                animation: REDUCED ? undefined : `ssFadeIn .8s ease ${0.6 + i * 0.12}s both`,
              }}>
                <MiniSun inner={c.core.inner} outer={c.core.outer} size={44} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: F.title, fontSize: 18, color: C.ash, letterSpacing: 1 }}><Rune text={c.name} delay={600 + i * 120} /></span>
                  <span style={{ display: "block", ...label, fontSize: 9, marginTop: 4 }}>{d.rank.title} · {d.cls.name}{c.id === activeId ? " · bound" : ""}</span>
                  {c.aspectName && <span style={{ display: "block", fontFamily: F.body, fontSize: 14, color: C.dim, marginTop: 4 }}>[{c.aspectName}]</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", alignItems: "center" }}>
          <button style={btn()} onClick={() => fileRef.current?.click()}>Import a sheet (.json)</button>
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={readFile} style={{ display: "none" }} />
          <span style={{ color: C.faint, fontFamily: F.mono, fontSize: 11 }}>or</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="New Aspirant's name" aria-label="New Aspirant's name" style={{ ...inputStyle, width: 220 }} />
          <button style={btn(C.gold)} onClick={create} disabled={!name.trim()}>Awaken</button>
        </div>
        {err && <div role="alert" style={{ color: C.danger, fontFamily: F.mono, fontSize: 12, marginTop: 14 }}>{err}</div>}
        <div style={{ ...label, fontSize: 9, color: C.faint, marginTop: 30 }}>Remembered on this device · change it later with ⇄</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Header, color picker                                               */
/* ------------------------------------------------------------------ */
const TABS = [["status", "Status"], ["memories", "Memories"], ["aspect", "Aspect"]];

function Header({ ch, d, tab, setTab, onPicker, onSwap, onExport, wide, warn }) {
  return (
    <header style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 6, display: "flex", flexWrap: "wrap", alignItems: "center",
      justifyContent: "space-between", gap: 10, padding: wide ? "16px 28px 30px" : "10px 14px 18px",
      background: "linear-gradient(to bottom, rgba(3,4,7,.92), rgba(3,4,7,0))", pointerEvents: "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, pointerEvents: "auto" }}>
        <MiniSun inner={ch.core.inner} outer={ch.core.outer} size={26} />
        <div>
          <div style={{ fontFamily: F.title, fontSize: 17, letterSpacing: 2, color: "#E9F1F7" }}><Rune text={ch.name} /></div>
          <div style={{ ...label, fontSize: 9 }}>{d.rank.title} · {d.cls.name}{warn ? " · not saved on this device" : ""}</div>
        </div>
      </div>
      <nav style={{ display: "flex", gap: wide ? 34 : 18, justifyContent: "center", order: wide ? 0 : 3, width: wide ? "auto" : "100%", pointerEvents: "auto" }}>
        {TABS.map(([id, text]) => (
          <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} style={{
            background: "none", border: "none", cursor: "pointer", padding: "6px 2px", fontFamily: F.mono, fontSize: 12, letterSpacing: 4,
            textTransform: "uppercase", color: tab === id ? C.cyan : C.dim, borderBottom: `1px solid ${tab === id ? C.cyan : "transparent"}`,
            textShadow: tab === id ? `0 0 12px ${hexA(C.cyan, 0.7)}` : "none", transition: "color .3s",
          }}><Rune text={text} /></button>
        ))}
      </nav>
      <div style={{ display: "flex", gap: 8, pointerEvents: "auto" }}>
        <IconBtn onClick={onPicker} title="Soul Core colors">◐</IconBtn>
        <IconBtn onClick={onExport} title="Export sheet (.json)">⤓</IconBtn>
        <IconBtn onClick={onSwap} title="Change Aspirant">⇄</IconBtn>
      </div>
    </header>
  );
}

function CorePicker({ core, onChange, onClose }) {
  return (
    <div style={{ position: "fixed", top: 70, right: 18, zIndex: 8, width: "min(320px, calc(100vw - 36px))" }}>
      <Panel title="Soul Core" delay={0}>
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer" }}>×</button>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {PRESETS.map((p) => (
            <button key={p.name} onClick={() => onChange({ inner: p.inner, outer: p.outer })} style={{ background: "none", border: "none", cursor: "pointer", display: "grid", justifyItems: "center", gap: 6 }}>
              <MiniSun inner={p.inner} outer={p.outer} size={34} />
              <span style={{ fontFamily: F.mono, fontSize: 8.5, color: C.dim, letterSpacing: 0.5 }}>{p.name}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
          {[["inner", "Inner"], ["outer", "Outer"]].map(([k, t]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, ...label, fontSize: 9, color: C.ash }}>
              <input type="color" value={core[k]} onChange={(e) => onChange({ ...core, [k]: e.target.value })}
                style={{ width: 34, height: 26, border: `1px solid ${hexA(C.cyan, 0.3)}`, background: "none", padding: 0, cursor: "pointer" }} />
              {t}
            </label>
          ))}
          <button style={{ ...btn(), padding: "6px 10px", fontSize: 9 }} onClick={() => onChange({ inner: core.outer, outer: core.inner })}>Swap ⇄</button>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Status (the runic Status Page, canon order, Lore 07)          */
/* ------------------------------------------------------------------ */
const SKILLS = {
  STR: ["Athletics"], DEX: ["Acrobatics", "Stealth", "Finesse"], CON: [],
  INT: ["Knowledge", "Tactics", "Investigation", "Deception"], WIS: ["Perception", "Insight", "Survival", "Persuasion"],
  SOUL: ["Resonance", "Willpower", "Intimidation"],
};
const clampScore = (n) => Math.max(1, Math.min(50, n));
const editSel = { ...inputStyle, padding: "4px 8px", fontSize: 15, cursor: "pointer" };
const stepBtn = { width: 26, height: 26, borderRadius: "50%", border: `1px solid ${hexA(C.cyan, 0.4)}`, background: "rgba(3,4,7,.6)", color: C.cyan, cursor: "pointer", fontFamily: F.mono, fontSize: 14, lineHeight: 1, padding: 0 };

/** Training level as three diamonds; clickable when editing. */
function Pips({ level, name, onSet, color = C.cyan, hint = "Training: reroll up to this many dice" }) {
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
      {[1, 2, 3].map((n) => {
        const on = level >= n, next = level === n ? n - 1 : n;
        const s = { width: 9, height: 9, padding: 0, transform: "rotate(45deg)", display: "inline-block", border: `1px solid ${hexA(color, on ? 0.9 : 0.35)}`,
          background: on ? color : "transparent", boxShadow: on ? `0 0 6px ${hexA(color, 0.7)}` : "none" };
        return onSet
          ? <button key={n} onClick={() => onSet(next)} aria-label={`${name}: set training ${next}`} title={hint} style={{ ...s, cursor: "pointer" }} />
          : <span key={n} style={s} />;
      })}
    </span>
  );
}

const CONDITIONS = ["Staggered", "Bleeding", "Prone", "Disarmed", "Exposed", "Rooted", "Dazed"];
const chip = (color, on) => ({
  background: on ? hexA(color, 0.18) : "transparent", border: `1px solid ${hexA(color, on ? 0.8 : 0.3)}`, color: on ? color : C.dim,
  borderRadius: 20, padding: "4px 11px", cursor: "pointer", fontFamily: F.mono, fontSize: 10.5, letterSpacing: 1, boxShadow: on ? `0 0 10px ${hexA(color, 0.35)}` : "none",
});
const level = (v, max) => Math.max(0, Math.min(max, Number.isFinite(v) ? v : max)); // never set yet = full
const rollLink = { background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", textAlign: "left", textDecoration: "underline dotted", textUnderlineOffset: 3 };

function Meter({ name, value, max, color, steps, extra = [], onSet }) {
  const set = (n) => onSet(Math.max(0, Math.min(max, n)));
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ ...label, color }}><Rune text={name} /></span>
        <span style={{ fontFamily: F.title, fontSize: 24, color: C.ash }}>{value}<span style={{ color: C.faint, fontSize: 14 }}> / {max}</span></span>
      </div>
      <div style={{ height: 6, margin: "6px 0 9px", background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
        <div style={{ height: "100%", background: `linear-gradient(90deg, ${hexA(color, 0.45)}, ${color})`, boxShadow: `0 0 10px ${hexA(color, 0.7)}`, transformOrigin: "left", transform: `scaleX(${max ? value / max : 0})`, transition: "transform .4s ease" }} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {steps.map((st) => <button key={st} onClick={() => set(value + st)} aria-label={`${name} ${st > 0 ? "plus" : "minus"} ${Math.abs(st)}`} style={chip(color)}>{st > 0 ? `+${st}` : `−${-st}`}</button>)}
        {extra.map(([t, v]) => <button key={t} onClick={() => set(v)} style={chip(color)}>{t}</button>)}
      </div>
    </div>
  );
}

/** The result of a roll; trained skills let you tap dice to reroll them. */
function RollPanel({ roll, onReroll, onAgain, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const s = scoreRoll(roll);
  const tone = (d) => (!d.kept ? C.faint : d.v === 10 ? C.goldHi : d.v === 1 ? C.danger : d.v + d.keen >= 6 ? C.cyan : C.dim);
  return (
    <div role="dialog" aria-label={`Roll: ${roll.title}`} style={{ position: "fixed", left: "50%", bottom: 18, transform: "translateX(-50%)", zIndex: 9, width: "min(560px, 94vw)" }}>
      <Panel title={roll.title} delay={0} style={{ background: "rgba(6,9,14,0.96)" }}>
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer" }}>×</button>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.dim, marginBottom: 12 }}>
          {poolText(roll.pool)}{roll.training ? ` · Training ${roll.training}: ${roll.rerolls ? `tap up to ${roll.rerolls} ${roll.rerolls === 1 ? "die" : "dice"} to reroll (keeps the better)` : "rerolls used"}` : ""}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {roll.dice.map((d, i) => {
            const c = tone(d), can = roll.rerolls > 0 && d.kept && !d.rr;
            return (
              <button key={`${roll.n}-${i}-${d.rr ? 1 : 0}`} disabled={!can} onClick={() => onReroll(i)} title={d.keen ? `keen die ${fmt(d.keen)}` : d.rr ? "rerolled" : undefined}
                style={{ position: "relative", width: 42, height: 42, display: "grid", placeItems: "center", cursor: can ? "pointer" : "default", opacity: 1,
                  fontFamily: F.title, fontSize: 19, color: c, background: hexA(c, d.kept ? 0.1 : 0.03), borderRadius: 4,
                  border: `1px ${d.keen ? "dashed" : "solid"} ${hexA(d.keen ? C.goldHi : c, 0.7)}`, textDecoration: d.kept ? "none" : "line-through",
                  boxShadow: can ? `0 0 0 1px ${hexA(C.cyan, 0.35)}, 0 0 12px ${hexA(c, 0.35)}` : d.kept && c !== C.dim ? `0 0 12px ${hexA(c, 0.35)}` : "none" }}>
                <Rune text={String(d.v)} delay={i * 40} />
                {d.keen ? <span style={{ position: "absolute", top: 1, right: 3, fontFamily: F.mono, fontSize: 8.5, color: C.goldHi }}>{fmt(d.keen)}</span> : null}
                {d.rr && <span style={{ position: "absolute", bottom: 1, right: 3, fontFamily: F.mono, fontSize: 8, color: C.cyan }}>↻</span>}
              </button>
            );
          })}
          {roll.auto > 0 && <span style={{ fontFamily: F.mono, fontSize: 12, color: C.cyan }}>+{roll.auto} auto</span>}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginTop: 16 }}>
          <span style={{ fontFamily: F.title, fontSize: 40, lineHeight: 1, color: s.successes ? C.cyan : C.dim, textShadow: s.successes ? `0 0 18px ${hexA(C.cyan, 0.6)}` : "none" }}>
            <Rune key={`${roll.n}-${roll.rerolls}`} text={String(s.successes)} delay={roll.dice.length * 40} />
          </span>
          <span style={{ ...label, color: C.ash }}>{s.successes === 1 ? "success" : "successes"}</span>
          {s.gifted > 0 && <span style={{ fontFamily: F.mono, fontSize: 11, color: C.danger }}>{s.gifted} gifted to the opponent</span>}
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint }}>dice sum {s.sum} (breaks ties)</span>
          <button onClick={onAgain} style={{ ...btn(), marginLeft: "auto", padding: "6px 12px" }}>⚄ Roll again</button>
        </div>
      </Panel>
    </div>
  );
}

function StatusView({ ch, d, go, wide, onChange, onRoll }) {
  const [open, setOpen] = useState(null);
  const [edit, setEdit] = useState(!!PREVIEW?.edit);
  const flaw = splitFlaw(ch.flaw);
  const attr = ch.statusAttributes.find((a) => a.id === open);
  const mems = ch.memories;
  const train = ch.training || {};
  const setScore = (k, n) => onChange({ attributes: { ...ch.attributes, [k]: clampScore(n) } });
  const vit = level(ch.vitalityNow, d.vitality), ess = level(ch.essenceNow, d.essence);
  const pos = wide ? { left: "4vw", top: 96, bottom: 20, width: "min(620px, 48vw)" } : { left: 12, right: 12, top: "46vh", bottom: 10 };
  return (
    <div style={{ position: "absolute", ...pos, overflowY: "auto", pointerEvents: "auto", display: "grid", gap: 28, alignContent: "start", padding: "12px 8px 16px 2px" }}>
      <Panel title="Vitals" delay={0.35}>
        <Meter name="Soul Vitality" value={vit} max={d.vitality} color={C.danger} steps={[-5, -1, 1, 5]} extra={[["Full", d.vitality]]} onSet={(n) => onChange({ vitalityNow: n })} />
        <Meter name="Soul Essence" value={ess} max={d.essence} color={C.cyan} steps={[-3, -1, 1, 3]}
          extra={[["Half rest", Math.min(d.essence, ess + Math.floor(d.essence / 2))], ["Full rest", d.essence]]} onSet={(n) => onChange({ essenceNow: n })} />
        <div style={{ ...label, fontSize: 9, color: C.goldHi, margin: "2px 0 8px" }}><Rune text="Conditions" /></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CONDITIONS.map((c) => {
            const on = ch.conditions.includes(c);
            return <button key={c} aria-pressed={on} onClick={() => onChange({ conditions: on ? ch.conditions.filter((x) => x !== c) : [...ch.conditions, c] })} style={chip(C.goldHi, on)}>{c}</button>;
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <span style={{ ...label, fontSize: 9, color: C.danger }}><Rune text="Serious Wounds" /></span>
          <Pips level={ch.wounds} name="Serious Wounds" color={C.danger} hint="Serious Wounds: the third one kills" onSet={(v) => onChange({ wounds: v })} />
          <button aria-pressed={!!ch.down} onClick={() => onChange({ down: !ch.down })} style={chip(C.danger, !!ch.down)}>Down</button>
          {ch.wounds >= 3 && <span style={{ fontStyle: "italic", fontSize: 14, color: C.danger }}>The third Serious Wound kills.</span>}
        </div>
      </Panel>

      <Panel title="Status" delay={0.45}>
        <button onClick={() => setEdit(!edit)} aria-pressed={edit} style={{ ...btn(edit ? C.gold : C.cyan), position: "absolute", top: 10, right: 12, padding: "5px 10px", fontSize: 9 }}>
          {edit ? "✓ Done" : "✎ Edit stats"}
        </button>
        <Line k="Name" delay={0}><Rune text={`${ch.name}.`} delay={60} /></Line>
        <Line k="True Name" delay={70}>{ch.trueName ? <Rune text={`${ch.trueName}.`} delay={130} /> : <span style={{ color: C.faint }}>—</span>}</Line>
        <Line k="Rank" delay={140}>
          {edit ? (
            <select value={ch.soulRank} onChange={(e) => onChange({ soulRank: e.target.value })} aria-label="Soul Rank" style={editSel}>
              {Object.keys(RANKS).map((r) => <option key={r} value={r} style={{ background: "#0B0E13" }}>{r}</option>)}
            </select>
          ) : <>
            <Rune text={`${ch.soulRank}.`} delay={200} />
            {d.rank.title !== ch.soulRank && <span style={{ color: C.dim, fontSize: 14 }}> · {d.rank.title}</span>}
          </>}
        </Line>
        <Line k="Class" delay={210}>
          {edit ? (
            <select value={d.cls.name} onChange={(e) => onChange({ soulClass: e.target.value })} aria-label="Soul Core Class" style={editSel}>
              {CLASSES.map((c) => <option key={c.name} value={c.name} style={{ background: "#0B0E13" }}>{c.tier} · {c.name}</option>)}
            </select>
          ) : <Rune text={`${d.cls.name}.`} delay={270} />}
          <span style={{ ...label, fontSize: 9, marginLeft: 10 }}>Tier {d.cls.tier} · pool {fmt(d.cls.bonus)}</span>
        </Line>
        <Line k="Soul Shards" delay={280}>
          {edit ? (
            <input type="number" min="0" value={ch.soulShards || 0} aria-label="Soul Shards"
              onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) onChange({ soulShards: Math.max(0, n) }); }}
              style={{ ...inputStyle, width: 110, padding: "4px 8px" }} />
          ) : <Rune text={`[${ch.soulShards || 0}/${d.cls.next ?? "—"}]`} delay={340} />}
        </Line>
        <Line k="Memories" delay={350}>
          {mems.length ? <>
            {mems.slice(0, 4).map((m, i) => <Tag key={m.id} text={m.name} delay={410 + i * 60} onClick={() => go("memories", m.id)} />)}
            {mems.length > 4 && <span style={{ color: C.dim }}>…and {mems.length - 4} more.</span>}
          </> : <span style={{ color: C.faint }}>—</span>}
        </Line>
        <Line k="Echoes" delay={420}>{ch.echoes.length ? ch.echoes.map((e, i) => <Tag key={e.id || i} text={e.name} delay={480} />) : <span style={{ color: C.faint }}>—</span>}</Line>
        <Line k="Attributes" delay={490}>
          {ch.statusAttributes.length ? ch.statusAttributes.map((a, i) => (
            <Tag key={a.id || i} text={a.name} delay={550 + i * 60} active={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)} />
          )) : <span style={{ color: C.faint }}>—</span>}
          {attr && (
            <div style={{ margin: "10px 0 4px", padding: "12px 14px", borderLeft: `2px solid ${C.cyan}`, background: hexA(C.cyan, 0.05), animation: "ssFadeIn .4s ease both" }}>
              {attr.flavor && <Rune block text={attr.flavor} style={{ fontStyle: "italic", color: C.ash, fontSize: 15.5 }} />}
              {attr.effect && <Rune block text={attr.effect} delay={150} style={{ fontFamily: F.mono, fontSize: 12, color: C.cyan, marginTop: 8, lineHeight: 1.6 }} />}
            </div>
          )}
        </Line>
        <Line k="Aspect" delay={560}>
          {ch.aspectName ? <Tag text={ch.aspectName} color={C.goldHi} delay={620} onClick={() => go("aspect")} /> : <span style={{ color: C.faint }}>—</span>}
          <span style={{ ...label, fontSize: 9, color: C.dim }}>Aspect Rank: </span><Rune text={ch.aspectRank} delay={680} style={{ color: C.goldHi }} />
        </Line>
        <Line k="Flaw" delay={630} accent={hexA(C.danger, 0.9)}>
          {flaw.name ? <Tag text={flaw.name} color={C.danger} delay={690} /> : <span style={{ color: C.faint }}>—</span>}
          {flaw.desc && <Rune block text={flaw.desc} delay={750} style={{ fontSize: 15, color: C.dim, fontStyle: "italic" }} />}
        </Line>
      </Panel>

      <Panel title="The Vessel · Attributes & Skills" delay={0.7}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(172px, 1fr))", gap: 10 }}>
          {d.attrs.map((a, i) => (
            <div key={a.key} style={{ border: `1px solid ${hexA(a.over ? C.danger : C.cyan, a.over ? 0.6 : 0.16)}`, background: "rgba(3,4,7,0.5)", padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ ...label, fontSize: 9, color: C.dim }}><Rune text={a.name} delay={i * 60} /></span>
                <span style={{ fontFamily: F.mono, fontSize: 9, color: C.faint }}>{a.key}</span>
              </div>
              {edit ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "6px 0 4px" }}>
                  <button style={stepBtn} onClick={() => setScore(a.key, a.score - 1)} aria-label={`Lower ${a.name}`}>−</button>
                  <input type="number" min="1" max="50" value={a.score} aria-label={`${a.name} score`}
                    onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) setScore(a.key, n); }}
                    style={{ ...inputStyle, width: 54, padding: "3px 4px", textAlign: "center", fontFamily: F.title, fontSize: 19 }} />
                  <button style={stepBtn} onClick={() => setScore(a.key, a.score + 1)} aria-label={`Raise ${a.name}`}>+</button>
                  <span style={{ fontFamily: F.mono, fontSize: 12, color: C.goldHi }}>{fmt(a.mod)}</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                  <span style={{ fontFamily: F.title, fontSize: 26, color: a.over ? C.danger : C.ash }}>{a.score}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 12, color: C.goldHi }}>{fmt(a.mod)}</span>
                </div>
              )}
              {edit ? <div style={{ fontFamily: F.mono, fontSize: 11, color: C.cyan }}>{poolText(a.pool)}</div>
                : <button onClick={() => onRoll(a.name, a.pool)} title={`Roll ${a.name}`} style={{ ...rollLink, fontFamily: F.mono, fontSize: 11, color: C.cyan }}>⚄ {poolText(a.pool)}</button>}
              {a.over && <div style={{ fontFamily: F.mono, fontSize: 9, color: C.danger, marginTop: 2 }}>over the {ch.soulRank} cap ({d.rank.cap})</div>}
              <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${hexA(C.cyan, 0.1)}` }}>
                {SKILLS[a.key].length ? SKILLS[a.key].map((s) => (
                  <div key={s} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 14.5 }}>
                    {edit ? <span style={{ color: train[s] ? C.ash : C.dim }}><Rune text={s} delay={i * 60 + 80} /></span>
                      : <button onClick={() => onRoll(`${s} · ${a.name}`, a.pool, train[s] || 0)} title={`Roll ${s}`} style={{ ...rollLink, color: train[s] ? C.ash : C.dim, textDecorationColor: hexA(C.cyan, 0.3) }}><Rune text={s} delay={i * 60 + 80} /></button>}
                    <Pips level={train[s] || 0} name={s} onSet={edit ? (v) => onChange({ training: { ...train, [s]: v } }) : undefined} />
                  </div>
                )) : <div style={{ fontStyle: "italic", fontSize: 13, color: C.faint }}>No skills: always a bare roll.</div>}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint, margin: "10px 2px 0" }}>⚄ Click a pool or a skill to roll it · ◆ Training: reroll up to that many dice on the skill's roll (never on attacks or reactions).</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 14 }}>
          <Stat k="Soul Vitality" v={d.vitality} sub="CON × 2 + Rank" />
          <Stat k="Action Points" v={d.ap} sub="3 + DEX step" />
          <Stat k="Soul Essence" v={d.essence} sub="pool" />
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Memories (stars around the core + an easy list)              */
/* ------------------------------------------------------------------ */
function MemoryCard({ m }) {
  return (
    <Panel title="Memory" accent={C.gold} delay={0.2}>
      {m.image && <img src={m.image} alt="" style={{ width: "100%", maxHeight: 230, objectFit: "cover", display: "block", margin: "-6px 0 14px",
        WebkitMaskImage: "linear-gradient(to bottom, #000 55%, transparent)", maskImage: "linear-gradient(to bottom, #000 55%, transparent)" }} />}
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <StarIcon rank={m.rank} size={44} />
        <div style={{ minWidth: 0 }}>
          <Rune block text={m.name} style={{ fontFamily: F.title, fontSize: 21, color: C.goldHi, lineHeight: 1.25 }} />
          <div style={{ ...label, fontSize: 9, color: C.dim, marginTop: 4 }}>{[m.type, m.rank, m.tier && `Tier ${m.tier}`].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      {m.form && <Rune block text={m.form} delay={120} style={{ fontStyle: "italic", color: C.ash, fontSize: 15.5, lineHeight: 1.6, margin: "14px 0 4px" }} />}
      {m.enchantments.length > 0 && <div style={{ ...label, fontSize: 9, margin: "18px 0 4px" }}><Rune text="Enchantments" /></div>}
      {m.enchantments.map((e, i) => (
        <div key={e.id || i} style={{ padding: "12px 0", borderTop: `1px solid ${hexA(C.gold, 0.15)}` }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: F.body, fontSize: 16.5, color: C.goldHi }}>[<Rune text={e.name} delay={200 + i * 100} />]</span>
            {e.kind && <Badge color={e.kind === "Passive" ? C.dim : C.cyan}>{e.kind}</Badge>}
            {e.cost && <span style={{ fontFamily: F.mono, fontSize: 11, color: C.cyan }}>{e.cost}</span>}
          </div>
          {e.desc && <Rune block text={e.desc} delay={260 + i * 100} style={{ color: C.ash, fontSize: 15, lineHeight: 1.6, marginTop: 6 }} />}
        </div>
      ))}
    </Panel>
  );
}

function MemoryList({ ms, sel, setSel }) {
  const [q, setQ] = useState("");
  const shown = ms.filter((m) => `${m.name} ${m.type} ${m.rank}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Panel title="Memories" delay={0.45}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memories…" aria-label="Search memories" style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />
      {shown.map((m, i) => (
        <button key={m.id} onClick={() => setSel(m.id)} style={{
          display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", cursor: "pointer", padding: "8px 6px",
          background: sel === m.id ? hexA(C.cyan, 0.08) : "transparent", border: "none", borderBottom: `1px solid ${hexA(C.cyan, 0.08)}`,
        }}>
          <StarIcon rank={m.rank} size={26} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: F.body, fontSize: 15.5, color: sel === m.id ? C.goldHi : C.ash }}><Rune text={m.name} delay={i * 60} /></span>
            <span style={{ display: "block", ...label, fontSize: 8.5, color: C.dim }}>{[m.type, m.rank, m.tier && `Tier ${m.tier}`].filter(Boolean).join(" · ")}</span>
          </span>
        </button>
      ))}
      {!ms.length && <Rune block text="No Memories rest in your Soul Sea yet." style={{ fontStyle: "italic", color: C.dim }} />}
      {ms.length > 0 && !shown.length && <div style={{ fontStyle: "italic", color: C.dim }}>Nothing answers to that name.</div>}
      <div style={{ ...label, fontSize: 8.5, color: C.faint, margin: "16px 0 6px" }}>A star's light = its Memory Rank</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
        {RANK_ORDER.map((r) => (
          <span key={r} title={r} style={{ display: "flex", alignItems: "center", gap: 2, fontFamily: F.mono, fontSize: 8.5, color: C.dim }}>
            <StarIcon rank={r} size={18} />{r.slice(0, 4)}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function MemoriesView({ ch, sel, setSel, wide }) {
  const m = ch.memories.find((x) => x.id === sel);
  if (wide) {
    return (
      <>
        <div style={{ position: "absolute", left: "3vw", top: 96, bottom: 20, width: 300, overflowY: "auto", pointerEvents: "auto", padding: "12px 6px 12px 2px" }}>
          <MemoryList ms={ch.memories} sel={sel} setSel={setSel} />
        </div>
        {m && (
          <div key={m.id} style={{ position: "absolute", right: "3vw", top: 96, bottom: 20, width: "min(420px, 30vw)", overflowY: "auto", pointerEvents: "auto", padding: "12px 6px 12px 2px" }}>
            <MemoryCard m={m} />
          </div>
        )}
      </>
    );
  }
  return (
    <div style={{ position: "absolute", left: 12, right: 12, top: "54vh", bottom: 10, overflowY: "auto", pointerEvents: "auto", display: "grid", gap: 26, alignContent: "start", padding: "12px 4px" }}>
      {m && <MemoryCard key={m.id} m={m} />}
      <MemoryList ms={ch.memories} sel={sel} setSel={setSel} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Aspect (inside the core)                                      */
/* ------------------------------------------------------------------ */
const SLOTS = [
  { rank: "Dormant", nature: "Affinity", ess: 0, gained: "the First Nightmare" },
  { rank: "Awakened", nature: "Application", ess: 3, gained: "reaching a Gateway" },
  { rank: "Ascended", nature: "Manipulation", ess: 8, gained: "the Second Nightmare" },
  { rank: "Transcendent", nature: "Transformation", ess: 15, gained: "the Third Nightmare" },
  { rank: "Supreme", nature: "Domain", ess: 24, gained: "the Fourth Nightmare" },
];
// Not shown since 2026-11-20 (Toni: the rules return to the Aspect tab in a new form). Summary of 01 Rules/Creating-Aspect-Abilities.md (§1–§10) and Master Reference §7.1. LOCKED rules only.
const ASPECT_RULES = [
  { h: "The truth never changes", p: [
    "Your Aspect is the single strange truth the Spell drew out of you in your First Nightmare. It never changes; each Aspect Ability is one concrete expression of it.",
    "The fiction comes first: an ability must follow from the Aspect's truth, and the Voice of the Spell (the Master) is the final judge. Damage is only one thing an ability can do, and often the least clever.",
  ] },
  { h: "One ability per Soul Rank", slots: true, p: [
    "Your newest ability is your signature: strongest and costliest. Your oldest is effortless. Every ability you hold grows each time you ascend, while staying a step below the newer ones.",
  ] },
  { h: "Casting an ability", p: [
    "Pay the slot's Soul Essence: 0 / 3 / 8 / 15 / 24, fixed forever. Essence does not recover in combat; a full rest restores all of it, a half rest half.",
    "Spend the AP the Master set when the ability was made: as a guide, 2 AP for an attack, 1 AP for anything else, 0 for a passive. Pour in +1 or +2 extra AP to push a damage ability for more dice.",
    "Endure-type: it lands. Your one Soul roll is the difficulty, and a target who Endures for equal or more takes half. Attack-type: you roll your Soul pool; a target who Avoids takes nothing.",
    "Flat or dice is chosen once, when the ability is created: flat deals the printed average without a roll.",
  ] },
  { h: "Reshaping it every time", p: [
    "The tables are a guide, not a cage. The same ability can be a bolt one turn and a blast the next: one target or an area, more range or more dice, a condition or none, traded at the tables' rates.",
    "What stays fixed: the slot, the Essence cost, the ability's nature (what your Aspect does) and whether it rolls dice or deals a flat amount.",
    "The Master judges whether a shape follows from your Aspect's truth. The limit of an Aspect ability is the player's creativity.",
  ] },
  { h: "Duration", p: [
    "Instant: resolves and ends. Lasting: up to 1 + your current Rank number in rounds.",
    "Sustained: a whole scene, paying half the slot's Essence (rounded up) each round, one at a time. Transformations are usually Sustained.",
    "Concentration: lasts while you concentrate; it breaks if you go Down, are Dazed, take a Serious Wound or start another.",
  ] },
  { h: "Requirements", p: [
    "Bind an ability to something that must be true to make it stronger or cheaper. If it isn't true, the ability cannot be used.",
    "Easy: +1 damage die. Hard: +2 dice, or one slot-band less Essence. Extreme: +4 dice, or use one slot above your Rank.",
  ] },
  { h: "Growth and evolution", p: [
    "Aspect Rank measures versatility, not power: how cleverly your First Nightmare defied its fate.",
    "An Aspect rises in Rank only when the Master rules the story has earned it, as Kai's did. Your abilities keep their slots; they change or gain something, never become a different ability. The Spell may rename the Aspect.",
    "Aspect Rank rewards: Transcendent, one bonus ordinary Attribute. Supreme, two bonus Spell Attributes. Sacred or Divine, one bonus Spell Attribute and one Innate Ability.",
  ] },
];

const goldText = { background: `linear-gradient(180deg, #FFF4D2 0%, ${C.goldHi} 48%, #9C7E45 100%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", WebkitTextFillColor: "transparent" };
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** A Spell sigil: a turning rune ring around a star polygon. More points = a higher rank. */
function Sigil({ points = 5, size = 60, color = C.goldHi, spin, dashed, broken }) {
  const id = "sg" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const n = Math.max(3, points), k = n >= 7 ? 3 : n >= 5 ? 2 : 1, g = gcd(n, k);
  const vert = (j) => { const a = (j / n) * Math.PI * 2 - Math.PI / 2; return `${(Math.cos(a) * 27).toFixed(2)},${(Math.sin(a) * 27).toFixed(2)}`; };
  const stars = Array.from({ length: g }, (_, s) => Array.from({ length: n / g + 1 }, (_, i) => vert(s + i * k)).join(" "));
  const text = useMemo(() => Array.from({ length: 64 }, (_, i) => RUNES[Math.floor(hash(i * 2.3 + n) * RUNES.length)]).join(""), [n]);
  return (
    <div aria-hidden="true" style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox="-50 -50 100 100" style={{ position: "absolute", inset: 0, overflow: "visible", animation: spin && !REDUCED ? "ssSpin 70s linear infinite" : undefined }}>
        <path id={id} d="M -38.5,0 a 38.5,38.5 0 1,1 77,0 a 38.5,38.5 0 1,1 -77,0" fill="none" />
        <text fill={color} fillOpacity="0.6" fontSize="6.4" letterSpacing="1.5" fontFamily={F.mono}><textPath href={`#${id}`}>{text}</textPath></text>
      </svg>
      <svg width={size} height={size} viewBox="-50 -50 100 100" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <circle r="47" fill="none" stroke={color} strokeOpacity="0.75" strokeWidth="1" strokeDasharray={broken ? "38 5 14 8 52 4 22 6" : dashed ? "3 4" : undefined} />
        <circle r="44" fill="none" stroke={color} strokeOpacity="0.3" strokeWidth="0.5" />
        <circle r="32" fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="0.7" />
        {stars.map((p, i) => <polyline key={i} points={p} fill={color} fillOpacity="0.07" stroke={color} strokeWidth="1" strokeLinejoin="round" />)}
        <circle r="3.2" fill={color} />
      </svg>
    </div>
  );
}

function Ornament({ color = C.goldHi, width = 220, left }) {
  return (
    <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 8, width, maxWidth: "100%", margin: left ? "10px 0" : "10px auto" }}>
      <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${color})` }} />
      <svg width="16" height="16" viewBox="-8 -8 16 16"><path d="M0,-6.5 L4.5,0 L0,6.5 L-4.5,0Z" fill="none" stroke={color} strokeWidth="1" /><circle r="1.5" fill={color} /></svg>
      <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${color}, transparent)` }} />
    </div>
  );
}

function Corners({ color }) {
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y], i) => (
    <span key={i} style={{
      position: "absolute", width: 9, height: 9, [y ? "bottom" : "top"]: -1, [x ? "right" : "left"]: -1,
      [y ? "borderBottom" : "borderTop"]: `2px solid ${color}`, [x ? "borderRight" : "borderLeft"]: `2px solid ${color}`,
    }} />
  ));
}

const cardBg = (rgb) => ({ position: "relative", padding: "16px 20px 18px", borderRadius: 2, background: `linear-gradient(135deg, rgba(${rgb},.6), rgba(6,9,14,.92) 58%)` });

function AbilityCard({ a, tag, ess, delay = 0, onCast, canCast, onRoll }) {
  return (
    <article style={{ ...cardBg("40,30,12"), border: `1px solid ${hexA(C.gold, 0.4)}` }}>
      <Corners color={C.goldHi} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <span style={{ ...label, color: C.goldHi }}>{tag}</span>
        {ess != null && <span style={{ fontFamily: F.mono, fontSize: 10, color: C.dim }}>{ess} Essence</span>}
      </div>
      <h3 style={{ margin: "8px 0 0", fontFamily: F.title, fontWeight: 700, fontSize: 25, letterSpacing: 1.5, lineHeight: 1.2, filter: `drop-shadow(0 0 10px ${hexA(C.gold, 0.45)})` }}>
        <span style={goldText}><Rune text={a.name} delay={delay} /></span>
      </h3>
      <Ornament width={170} left />
      {(a.type || a.cost) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {a.type && <Badge color={C.goldHi}>{a.type}</Badge>}
          {a.cost && <Badge>{a.cost}</Badge>}
        </div>
      )}
      {a.desc && <Rune block text={a.desc} delay={delay + 80} style={{ color: C.ash, fontSize: 15.5, lineHeight: 1.7 }} />}
      {a.effect && (
        <div style={{ position: "relative", marginTop: 18, padding: "14px 14px 12px", border: `1px solid ${hexA(C.cyan, 0.28)}`, background: `linear-gradient(180deg, ${hexA(C.cyan, 0.08)}, ${hexA(C.cyan, 0.02)})` }}>
          <span style={{ ...label, fontSize: 8.5, position: "absolute", top: -7, left: 10, padding: "0 6px", background: "#0A1218" }}>Rules</span>
          <Rune block text={a.effect} delay={delay + 160} style={{ fontFamily: F.mono, fontSize: 12, color: C.cyan, lineHeight: 1.65 }} />
        </div>
      )}
      {(onCast || onRoll) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
          {onCast && <button onClick={onCast} disabled={!canCast} style={{ ...btn(C.goldHi), padding: "7px 12px" }}>✦ Cast · {ess} Essence</button>}
          {onRoll && <button onClick={onRoll} style={{ ...btn(), padding: "7px 12px" }}>⚄ Roll Soul</button>}
          {onCast && !canCast && <span style={{ fontStyle: "italic", fontSize: 13, color: C.faint }}>Not enough Soul Essence.</span>}
        </div>
      )}
    </article>
  );
}

function AspectView({ ch, d, onChange, onRoll }) {
  const flaw = splitFlaw(ch.flaw);
  const ess = level(ch.essenceNow, d.essence), soul = d.attrs.find((x) => x.key === "SOUL").pool;
  const reached = RANK_ORDER.indexOf(ch.soulRank);
  const slotRanks = SLOTS.map((s) => s.rank);
  const other = ch.abilities.filter((a) => !slotRanks.includes(a.rank));
  const glow = hexA(ch.core.outer, 0.75);
  const fade = (s) => (REDUCED ? undefined : `ssFadeIn .9s ease ${s}s both`);
  const node = (child) => <div style={{ borderRadius: "50%", background: "radial-gradient(circle, rgba(3,4,7,.92) 52%, transparent 70%)" }}>{child}</div>;
  return (
    <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: 84, bottom: 0, width: "min(880px, 94vw)", overflowY: "auto", pointerEvents: "auto", padding: "6px 8px 60px" }}>
      {/* The seal and the name */}
      <div style={{ position: "relative", display: "grid", placeItems: "center", minHeight: 340, textAlign: "center", animation: fade(0.6) }}>
        <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", opacity: 0.55 }}>
          <Sigil points={rankIdx(ch.aspectRank) + 3} size={330} color={C.goldHi} spin />
        </div>
        <div style={{ position: "relative", padding: "0 12px" }}>
          <div style={{ ...label, letterSpacing: 6, color: C.goldHi }}>▏ <Rune text="Aspect" /> ▏</div>
          <h1 style={{ margin: "12px 0 2px", fontFamily: F.title, fontWeight: 700, fontSize: "clamp(32px, 5.4vw, 58px)", letterSpacing: 3, lineHeight: 1.1, filter: `drop-shadow(0 0 18px ${glow}) drop-shadow(0 2px 2px rgba(0,0,0,.9))` }}>
            <span style={goldText}><Rune text={ch.aspectName || "Unnamed Aspect"} delay={100} /></span>
          </h1>
          <Ornament width={280} />
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Badge color={C.goldHi}>{ch.aspectRank} Aspect</Badge>
            {ch.aspectType && <Badge>{ch.aspectType}</Badge>}
            <Badge>Soul Essence {ess} / {d.essence}</Badge>
          </div>
        </div>
      </div>
      {ch.aspectDescription && (
        <div style={{ position: "relative", maxWidth: 700, margin: "0 auto 56px", padding: "6px 38px", textAlign: "center", animation: fade(0.8) }}>
          <span aria-hidden="true" style={{ position: "absolute", left: 0, top: -14, fontFamily: F.title, fontSize: 66, lineHeight: 1, color: hexA(C.gold, 0.4) }}>“</span>
          <Rune block text={ch.aspectDescription} delay={300} style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "clamp(16px, 1.6vw, 19px)", lineHeight: 1.8, color: "#DCE3EA" }} />
          <span aria-hidden="true" style={{ position: "absolute", right: 0, bottom: -40, fontFamily: F.title, fontSize: 66, lineHeight: 1, color: hexA(C.gold, 0.4) }}>”</span>
        </div>
      )}

      {/* The path of ascension: one ability slot per Soul Rank */}
      <div style={{ ...label, textAlign: "center", color: C.goldHi, letterSpacing: 5 }}>▏ <Rune text="Aspect Abilities" /> ▏</div>
      <Ornament width={200} />
      <div style={{ position: "relative", display: "grid", gap: 18, marginTop: 18 }}>
        <div aria-hidden="true" style={{ position: "absolute", left: 31, top: 30, bottom: 30, width: 1, background: `linear-gradient(${C.goldHi}, ${hexA(C.gold, 0.1)})` }} />
        {SLOTS.map((s, i) => {
          const abs = ch.abilities.filter((a) => a.rank === s.rank);
          const sealed = i > reached;
          const dim = sealed && !abs.length;
          return (
            <div key={s.rank} style={{ display: "grid", gridTemplateColumns: "62px 1fr", gap: 14, alignItems: "start", animation: fade(0.9 + i * 0.1) }}>
              {node(<Sigil points={i + 3} size={62} color={dim ? C.faint : C.goldHi} spin={!dim} dashed={dim} />)}
              {abs.length ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {abs.map((a, j) => <AbilityCard key={a.id || j} a={a} tag={`${s.rank} ability · ${s.nature}`} ess={s.ess} delay={i * 80}
                    onCast={() => onChange({ essenceNow: ess - s.ess })} canCast={ess >= s.ess} onRoll={() => onRoll(`${a.name} · Soul`, soul)} />)}
                </div>
              ) : (
                <div style={{ padding: "16px 20px", border: `1px dashed ${hexA(C.dim, 0.35)}`, background: "rgba(6,9,14,.55)", display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ ...label, color: C.dim }}>{s.rank} ability · {s.nature}</span>
                  <span style={{ fontStyle: "italic", fontSize: 15, color: C.faint }}>{sealed ? `Sealed. Granted at ${s.gained}.` : "Granted, but not yet written down."}</span>
                </div>
              )}
            </div>
          );
        })}
        {other.map((a, j) => (
          <div key={a.id || j} style={{ display: "grid", gridTemplateColumns: "62px 1fr", gap: 14, alignItems: "start" }}>
            {node(<Sigil points={rankIdx(a.rank) + 3} size={62} spin />)}
            <AbilityCard a={a} tag={`${a.rank || "Other"} ability`} onRoll={() => onRoll(`${a.name} · Soul`, soul)} />
          </div>
        ))}
        {(ch.innateAbility || ch.aspectLegacy) && (
          <div style={{ display: "grid", gridTemplateColumns: "62px 1fr", gap: 14, alignItems: "start" }}>
            {node(<Sigil points={9} size={62} color={C.cyan} spin />)}
            <article style={{ ...cardBg("10,30,38"), border: `1px solid ${hexA(C.cyan, 0.4)}` }}>
              <Corners color={C.cyan} />
              {ch.innateAbility && <>
                <span style={label}>Innate Ability</span>
                <Rune block text={ch.innateAbility} style={{ color: C.ash, fontSize: 15.5, lineHeight: 1.7, margin: "6px 0 10px" }} />
              </>}
              {ch.aspectLegacy && <>
                <span style={label}>Aspect Legacy</span>
                <div style={{ fontFamily: F.title, fontSize: 19, color: C.ash, marginTop: 6 }}><Rune text={ch.aspectLegacy} />{ch.legacyRelic && <span style={{ fontFamily: F.body, fontSize: 14, color: C.dim }}> · Relic: {ch.legacyRelic}</span>}</div>
              </>}
            </article>
          </div>
        )}
      </div>

      {/* The Flaw: the price of the power */}
      <div style={{ display: "grid", gridTemplateColumns: "62px 1fr", gap: 14, alignItems: "start", marginTop: 40, animation: fade(1.4) }}>
        {node(<Sigil points={3} size={62} color={C.danger} broken />)}
        <article style={{ ...cardBg("70,12,16"), border: `1px solid ${hexA(C.danger, 0.45)}` }}>
          <Corners color={C.danger} />
          <span style={{ ...label, color: C.danger }}>Flaw · the price of the Aspect</span>
          <h3 style={{ margin: "8px 0 6px", fontFamily: F.title, fontWeight: 700, fontSize: 24, letterSpacing: 1.5, color: "#F4BDBD", textShadow: `0 0 16px ${hexA(C.danger, 0.55)}` }}><Rune text={flaw.name || "—"} /></h3>
          {flaw.desc && <Rune block text={flaw.desc} delay={150} style={{ fontStyle: "italic", color: C.ash, fontSize: 16 }} />}
        </article>
      </div>

    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Spectral:ital,wght@0,400;0,500;1,400&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+Runic&display=swap');
html,body{margin:0;background:${C.void};}
*{box-sizing:border-box}
button{font:inherit;color:inherit}
button:disabled{opacity:.4;cursor:default}
button:focus-visible,input:focus-visible,[role=button]:focus-visible{outline:1px solid ${C.cyan};outline-offset:2px}
input::placeholder{color:${C.faint}}
::selection{background:${hexA(C.cyan, 0.3)}}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:${hexA(C.cyan, 0.25)};border-radius:3px}::-webkit-scrollbar-track{background:transparent}
@keyframes ssSpin{to{transform:rotate(360deg)}}
@keyframes ssSlide{to{transform:translateX(-50%)}}
@keyframes ssFade{from{opacity:0}to{opacity:1}}
@keyframes ssBreath{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.07);opacity:1}}
@keyframes ssPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
@keyframes ssTwinkle{0%,100%{opacity:.12}50%{opacity:.85}}
@keyframes ssShimmer{0%,100%{opacity:.08}50%{opacity:.7}}
@keyframes ssFadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes ssRise{0%{transform:translateY(0);opacity:0}15%{opacity:.8}100%{transform:translateY(-55vh);opacity:0}}
@keyframes ssLine{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

function useViewport() {
  const get = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [v, setV] = useState(get);
  useEffect(() => {
    const on = () => setV(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}

export default function ShadowSlaveSite() {
  const vp = useViewport();
  const [store, setStore] = useState(() => {
    const s = loadStore();
    if (PREVIEW?.patch) s.roster = [normalize({ ...RANULFO, ...PREVIEW.patch, memories: [...RANULFO.memories, ...(PREVIEW.patch.addMemories || [])] })];
    if (PREVIEW?.phase === "site") s.activeId = s.roster[0].id;
    return s;
  });
  const active = store.roster.find((c) => c.id === store.activeId) || null;
  const [phase, setPhase] = useState(PREVIEW?.phase || "intro");
  const [tab, setTab] = useState(PREVIEW?.tab || "status");
  const [born, setBorn] = useState(!!PREVIEW);
  const [sel, setSel] = useState(PREVIEW?.mem ? active?.memories[0]?.id : null);
  const [picker, setPicker] = useState(false);
  const [warn, setWarn] = useState(false);
  const [roll, setRoll] = useState(null);
  const [greeting] = useState(() => (active ? { name: active.name, title: (RANKS[active.soulRank] || RANKS.Dormant).title } : null));

  useEffect(() => {
    if (PREVIEW) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); setWarn(false); } catch { setWarn(true); } // full or blocked storage
  }, [store]);
  useEffect(() => {
    if (phase !== "site" || born) return undefined;
    const t = setTimeout(() => setBorn(true), 120); // let the core appear as a point, then grow into the Soul Sea
    return () => clearTimeout(t);
  }, [phase, born]);

  const bind = (id) => { setStore((s) => ({ ...s, activeId: id })); setRoll(null); setBorn(false); setTab("status"); setSel(null); setPhase("site"); };
  /** Add an imported/new character; a sheet with the same name replaces the old one (keeps its colors). */
  const importChar = (raw) => {
    const same = store.roster.find((c) => c.name.trim().toLowerCase() === String(raw.name).trim().toLowerCase());
    const c = normalize({ ...raw, id: same?.id || raw.id, core: raw.core || same?.core });
    setStore((s) => ({ ...s, roster: same ? s.roster.map((x) => (x.id === same.id ? c : x)) : [...s.roster, c] }));
    return c.id;
  };
  const update = (patch) => setStore((s) => ({ ...s, roster: s.roster.map((c) => (c.id === s.activeId ? { ...c, ...patch } : c)) }));
  const setCore = (core) => update({ core });
  /** Download the active character as a sheet, so edits made here are never only in this browser. */
  const exportSheet = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(active, null, 2)], { type: "application/json" }));
    a.download = `${(active.name || "sleeper").replace(/[^\w-]+/g, "_")}.ss.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const doRoll = (title, pool, training = 0) => { const r = rollPool(pool); setRoll((prev) => ({ n: (prev?.n || 0) + 1, title, pool, training, rerolls: training, ...r })); };
  const reroll = (i) => { const v = d10(); setRoll((r) => (r && r.rerolls > 0 ? { ...r, rerolls: r.rerolls - 1, dice: r.dice.map((x, j) => (j === i ? { ...x, v: Math.max(x.v, v), rr: true } : x)) } : r)); };
  const go = (t, memId) => { setTab(t); if (memId) setSel(memId); };

  let body;
  if (phase === "intro") {
    body = <Intro who={greeting} onDone={() => setPhase(active ? "site" : "select")} />;
  } else if (phase === "select" || !active) {
    body = <SelectScreen roster={store.roster} activeId={store.activeId} onBind={bind} onImport={importChar} />;
  } else {
    const d = derive(active);
    const wide = vp.w >= 980;
    const { inner, outer } = active.core;
    body = (
      <>
        <div aria-hidden="true" style={{ position: "fixed", inset: 0, background: `radial-gradient(ellipse at 60% 30%, ${hexA(outer, 0.1)}, transparent 60%), ${C.void}`, transition: "background 1s" }} />
        <Starfield hidden={tab === "aspect"} />
        <Scene ch={active} d={d} tab={tab} cam={camera(born ? tab : "birth", vp.w, vp.h)} sel={sel} onPick={setSel} />
        <CoreInterior show={tab === "aspect"} inner={inner} outer={outer} />
        <Header ch={active} d={d} tab={tab} setTab={setTab} wide={wide} warn={warn} onPicker={() => setPicker((p) => !p)} onSwap={() => { setPicker(false); setPhase("select"); }} onExport={exportSheet} />
        <main key={tab} style={{ position: "fixed", inset: 0, zIndex: 3, pointerEvents: "none" }}>
          <DelayCtx.Provider value={tab === "aspect" ? 900 : 450}>
            {tab === "status" && <StatusView ch={active} d={d} go={go} wide={wide} onChange={update} onRoll={doRoll} />}
            {tab === "memories" && <MemoriesView ch={active} sel={sel} setSel={setSel} wide={wide} />}
            {tab === "aspect" && <AspectView ch={active} d={d} onChange={update} onRoll={doRoll} />}
          </DelayCtx.Provider>
        </main>
        {picker && <CorePicker core={active.core} onChange={setCore} onClose={() => setPicker(false)} />}
        {roll && <RollPanel roll={roll} onReroll={reroll} onAgain={() => doRoll(roll.title, roll.pool, roll.training)} onClose={() => setRoll(null)} />}
      </>
    );
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: C.void, color: C.ash, fontFamily: F.body, overflow: "hidden" }}>
      <style>{CSS}</style>
      <StarDefs />
      {body}
    </div>
  );
}

/* Self-check (runs once): rules engine and the decode's end state. */
console.assert(poolText(dicePool(1, 3)) === "2d10", "pool: +3 = one die");
console.assert(poolText(dicePool(1, 2)) === "1d10 · keen +2", "pool: keen die");
console.assert(dicePool(1, -3).keepLowest === 2 && dicePool(1, -6).keepLowest === 3, "pool: keep lowest");
console.assert(dicePool(18, 30).pool === 20 && dicePool(18, 30).auto === 4, "pool: 20-dice cap");
console.assert(derive(normalize(RANULFO)).essence === 8 && derive(normalize(RANULFO)).ap === 3, "derive: Ranulfo");
console.assert(decodeSegments("Aspirant!", 1, 0).map((s) => s.t).join("") === "Aspirant!", "decode: ends in English");
console.assert(splitFlaw(RANULFO.flaw).name === "Keeper of Truths", "flaw split");
console.assert(gcd(6, 2) === 2 && gcd(7, 3) === 1 && gcd(9, 3) === 3, "sigil: star polygons");
console.assert(clampScore(0) === 1 && clampScore(99) === 50, "score clamp");
const die = (v, keen = 0, kept = true) => ({ v, keen, kept });
console.assert(scoreRoll({ dice: [die(10), die(1), die(6), die(5, 1)], auto: 0 }).successes === 3, "roll: 10 counts 2, a 1 cancels one, keen 5+1 succeeds");
console.assert(scoreRoll({ dice: [die(1), die(1), die(3)], auto: 0 }).gifted === 2, "roll: spare 1s are gifted");
console.assert(scoreRoll({ dice: [die(9, 0, false), die(4, 2)], auto: 0 }).successes === 1, "roll: keep lowest, keen applies to the kept die");
console.assert(scoreRoll({ dice: [die(3)], auto: 4 }).successes === 4, "roll: auto successes");
console.assert(rollPool(dicePool(18, 30)).dice.length === 20 && rollPool(dicePool(1, -6)).dice.filter((x) => x.kept).length === 1, "roll: pool sizes");
