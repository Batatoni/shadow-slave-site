# TTRPG Site: The Soul Sea

*Started 2026-11-17. Step 1 of the player website that replaces the sheet-only app. Status: DRAFT (design pass).*

> **Fan project.** A non-commercial companion for a tabletop RPG adaptation of *Shadow Slave* by Guiltythree. Not affiliated with the author or publisher; *Shadow Slave* and its world belong to their owners.

## Files

| File | What it is |
|---|---|
| `index.html` | The site, built into one file. Double-click to open in any browser; GitHub Pages serves it as the home page. |
| `shadow-slave-site.jsx` | The source (one React component, default export). Edit this, then rebuild. |
| `build.mjs`, `package.json` | The build: `npm install`, then `npm run build` writes `index.html`. |

## What it does

1. **Opening.** A black screen. The Spell speaks in runes that translate into English: *"Aspirant! Welcome to the Nightmare Spell."* A returning player is greeted by rank and name instead (*"Dreamer Ranulfo."*). Click to skip.
2. **Choosing who you are.** On the first visit the Spell asks *"Identify yourself, Aspirant."* Pick a character card, import a sheet (`.ss.json` from the Character Sheet App), or type a name to awaken a new one. The choice is saved in the browser and skipped on later visits. The ⇄ button changes it.
3. **The Soul Sea.** The background is the player's own Soul Sea, and every tab is a camera move on it:
   - **Status**: zoomed out over the whole sea. The runic Status Page in canon order (Lore 07): Name, True Name, Rank, Class, Soul Shards, Memories, Echoes, Attributes, Aspect, Flaw. Below it, *The Vessel*: each of the six attributes with its dice pool and its skills (all 15, with Training diamonds; Constitution has none), then Soul Vitality, AP and Soul Essence, computed by the current engine (keen die, 20-dice cap, AP at DEX 21+, Beast start, Essence pool formula).
   - **Vitals** (2026-11-20, top of Status): Soul Vitality and Soul Essence bars with −/+ buttons (Essence also has Half rest = +50% and Full rest), condition chips (Staggered, Bleeding, Prone, Disarmed, Exposed, Rooted, Dazed), the Serious Wounds track (the third kills) and Down. Saved with the character.
   - **Rolling** (2026-11-20): click a pool (⚄) or a skill name to roll it on the v2 engine: 6+ succeeds, the keen die carries the ±1/±2 (dashed gold), a natural 10 counts 2, each natural 1 cancels a success or is gifted to the opponent, keep-lowest and the 20-die cap with auto successes, plus the dice sum for ties. A trained skill lets you tap up to Training-level dice to reroll, keeping the better result. Dice arrive as runes. Esc closes.
   - **✎ Edit stats** (2026-11-20): Rank, Class and Soul Shards become editable; attributes get −/+ steppers (1–50, red when over the Rank cap); clicking a skill's diamonds sets its Training 0–3. Everything recalculates live and saves in the browser. **⤓** in the header downloads the character as `.ss.json`, so edits are never only in one browser.
   - **Memories**: zoomed on the Soul Core. Each Memory orbits it as a star; a star's look grows with its Memory Rank (Dormant a plain point → Divine a pulsing twelve-ray star with rings). Higher ranks sit on wider orbits. Click a star, or use the searchable list, to open the Memory's card (image, form, enchantments).
   - **Aspect**: the camera dives inside the core. A turning sigil sits behind the Aspect's name (more star points = higher Aspect Rank: Dormant 3 … Divine 9), in gold lettering; the description as a quotation; the abilities on a vertical *path of ascension*, one sigil node per Soul Rank slot (filled cards in gold, sealed ones dashed), each with **✦ Cast** (spends the slot's Essence: 0 / 3 / 8 / 15 / 24) and **⚄ Roll Soul**; Innate Ability and Legacy when set; the Flaw under a broken red seal. *(The "How an Aspect works" rules summary was removed 2026-11-20; Toni will bring the rules back in a different form. The text is kept in the source as `ASPECT_RULES`.)*
   - **3D core** (2026-11-20): the sun, its Class rings, the rune band and the Memory orbits share one CSS 3D space. Rings and orbits are tilted in perspective and pass behind the sphere; the sphere is shaded and its surface turns; stars always face the viewer.
4. **Runes on every tab switch.** All text arrives as the Spell's runes and resolves into English.
5. **Soul Core colors.** The ◐ button: eight presets (Spell Cyan, Pale Star, Black Sun, Gold Dawn, Verdant, Crimson, Violet, Ember) or any inner/outer color, with a swap. Saved per character.

## Performance (2026-11-20)

Every moving part is a GPU-only animation (move, turn, fade): no blur behind panels, no repainted sea lines or surfaces, stars and glints twinkle in a few whole layers, the inside of the core only runs while you are in it, and the outside scene stops drawing once the camera is inside. About 25–40 animated layers per tab (was 250+). Orbit lines are barely visible; the orbit of the selected or hovered Memory glows a little.

## Canon behind the design

- The Soul Core is seen from inside as **a star or sun above the Soul Sea**; every Soul Sea looks different (Lore 02).
- **Memories as orbiting lights** comes from Rain's Soul Sea (Lore 02).
- **Class display, "Both"** (Toni, 2026-11-17): one sun that grows brighter and gains one ring per Class step, plus faint ghost suns, one per Class step above Beast. *Adaptation:* the ghost suns are a visual gauge only. The one-core rule (Open Issue #3) is unchanged; a Divine Aspect holder's extra suns are drawn as real cores, as in canon.
- The runes are Elder Futhark glyphs standing in for the Spell's dead runic language (Lore 01).

## Data

- Characters use the same JSON as the Character Sheet App, so its exports import directly. Importing a sheet with the same name replaces the old one and keeps its colors.
- Everything is stored in the browser (`localStorage`, key `ss-soul-sea-v1`), per device. The `.ss.json` files stay the master copy.
- Ranulfo is built in as the first character (English text from `03 Characters/Players/Ranulfo.md` and `Tallow-Ember.md`).

## Rebuilding after editing the .jsx

With Node installed, in this folder:

```
npm install
npm run build
```

This writes `index.html`. (Or ask Claude to rebuild it.)

## Hosting

`index.html` is a complete static site. On GitHub, turn on **Pages** for the repository (branch `main`, root folder) and it is served at `https://<user>.github.io/<repo>/`. It also deploys to Vercel or Netlify as-is.

## Not done yet

- **Editing the rest**: stats, Rank, Class, Shards and skills are editable here; names, Aspect text, abilities, Memories and Flaw are still edited in the Character Sheet App and re-imported.
- **Echoes tab** (skipped for now) and the **rulebook-summary tab** (later).
- A **Portuguese** version of the text.
- Fonts (Cinzel, Spectral, IBM Plex Mono, Noto Sans Runic) load from Google Fonts; offline, the browser falls back to system fonts. Runes need a font with the Runic block (Windows has Segoe UI Historic).
