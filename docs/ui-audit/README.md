# UI audit — Phase 1 (everything except the 3D scene)

Captured 2026-10-02 from `main` @ `17274a0`, running locally (backend + simulator + Vite,
throwaway DB, `ADMIN_TOKEN` set so the read-only state is visible). Chromium via
Playwright, software WebGL. Each module was opened on a **fresh page** so the captures
are not polluted by bug F1 below.

| File | What |
|---|---|
| `desktop-NN-<module>.jpg` / `-full.jpg` | 1440 × 900 viewport / full scroll length |
| `mobile-NN-<module>.jpg` / `-full.jpg` | 390 × 844 @2x / full scroll length |
| `desktop-2N-*.jpg`, `mobile-2N-*.jpg` | overlays: station menu, alert drawer, link drawer, operator login, Twin Inspector, event timeline, Demo Control, building panel |
| `bug-panels-stack-after-3-modules.jpg` | bug F1, captured on purpose |

Missing on purpose: `mobile-21…25` — on a phone those controls cannot be clicked at all
(see S2).

Measurements come from axe-core 4.10 (WCAG 2.1 A/AA + best practice, every module), a
computed-style contrast probe for elements axe skips (translucent / blurred backgrounds),
and a static count over `src/**/*.css|jsx`.

---

## Functional defects found while auditing (not cosmetic)

| ID | Defect | Evidence |
|---|---|---|
| **F1** | **Module panels accumulate.** Each module you open is appended below the previous ones instead of replacing them; after visiting all nine, all nine render stacked. Reproduces in production. Regression from `a745600` (removed `mode="wait"` from `AnimatePresence`; exiting children never unmount). The e2e tour does not catch it because it asserts the new heading is *present*, not that the old one is *gone*. | `bug-panels-stack-after-3-modules.jpg`; DOM count 1 → 2 → 3 → 4 panels after 4 clicks, locally and on https://aurora-sih.centralindia.cloudapp.azure.com |
| **F2** | **Building panel "Live readings" is empty** (heading, no rows). `BuildingPanel` gets its sensor list from `getSensorDefs()` in `src/data/stationData.js`, which reads the *browser-demo* simulation state — never initialised while live telemetry flows, so it returns `[]`. | `desktop-27-building-panel.jpg` |
| **F3** | **READ-ONLY pill text is black on near-black: 1.18 : 1.** The operator login entry point is effectively invisible. | contrast probe: `color rgb(0,0,0)` on the top bar |
| **F4** | **Mobile top bar is 655 px wide in a 390 px viewport.** Branding, data-source badge, Twin Inspector, station selector and alert pill render *on top of each other*; link status and event timeline are off-screen and unreachable; the alert pill and Twin Inspector are covered ("subtree intercepts pointer events"). | `mobile-01-overview.jpg`; Playwright click diagnostics |

---

## Cross-cutting problems

### Visual — why it reads as AI-generated

Static count over the stylesheets and components:

| Signal | Count |
|---|---|
| distinct `font-size` values | **45** (17 px sizes from 9 to 36; **61** declarations under 11 px) |
| distinct hex colours | **66**, plus **545** `rgba()` literals and **103** hex literals inside JSX |
| distinct `border-radius` values | **26** |
| distinct `padding` values | **77** |
| `backdrop-filter` (glassmorphism) | **27** |
| glow `box-shadow: 0 0 Npx` | **18** |
| gradient text (`background-clip: text`) | **5**, plus 26 gradients |
| `@keyframes` / infinite animations | **14 / 15** (pulse dots, ambient blobs, noise overlay) |
| `!important` | **47** |
| uppercase + letter-spaced labels | **27** |
| font families | 3 (Space Grotesk display, Inter body, JetBrains Mono) |
| files importing framer-motion / react-icons | 17 / 19 |

What that looks like on screen:

- **V1 Glass, glows and ambient blobs.** Translucent panels with blur over animated gradient
  "blobs" and a noise overlay (`App.jsx` `.ambient-bg`, `.noise-overlay`); drawers blur the
  whole app behind them.
- **V2 A different neon accent per module** (`SidebarNav.jsx`: `#58a6ff`, `#38bdf8`,
  `#a78bfa`, `#fbbf24`, `#34d399`, `#c084fc`, `#f472b6`…) used for icons, active pills,
  badges and borders. Colour carries no meaning, so real status colour has to compete.
- **V3 Status colours used decoratively.** Energy's four KPIs are yellow, cyan, amber and
  green for no reason; amber "LIVE SIMULATOR · MODEL-DERIVED" looks like a warning; green
  rings around every dependency-graph node read as "OK" even when nothing was evaluated.
- **V4 Identical card everywhere.** Icon-in-rounded-square + title + pill + grey sub-text,
  repeated for KPIs, buildings, inventory, scenarios, residuals and sources, at three
  different radii.
- **V5 Decorative icons and emojis.** An icon on every heading, card and tab; emojis as
  status (`🟢 REANALYSIS`, `🟡 MODEL`, `🔵 SIMULATED`, `⚡ Digital Twin Inspector`,
  `📄 📐 ⚙️` in `TwinInspector.jsx`; `⚡` bullets in What-If).
- **V6 Marketing copy and gimmicks.** "POLAR DIGITAL TWIN MATRIX", "JARVIS MODE", "Cascading
  Dependency & AI Risk Topology", "Mission Navigation · LIVE"; a monospace uppercase badge
  next to most titles.
- **V7 Typography soup.** Mono used for labels and pills as decoration (105 `font-mono`
  uses), not just numbers; Space Grotesk for some titles, Inter for others; 9–10 px text
  in pills, sub-labels and the top-bar subtitle.
- **V8 Motion everywhere.** Spring-animated sidebar pill, hover lift-and-scale on cards,
  staggered row entrances, animated counters in the building panel, pulsing dots.

### UX

- **U1 Navigation.** Sections exist but labels are vague ("Remote C&C", "What-If Sim"); the
  sidebar footer card says "Data source: see badge in top bar" — a pointer, not information.
  Collapsed mode loses the section structure. No URL per module (refresh always returns to
  Overview; nothing can be linked or bookmarked).
- **U2 Station switching** is a small dropdown in the top bar; the active station is
  restated inconsistently in each panel title ("Maitri Meteorological…", "Maitri Station
  Logistics…", "Maitri Digital Twin…"). Switching gives no confirmation that the data
  changed.
- **U3 Status is scattered.** Data source, Twin Inspector, alerts, READ-ONLY, ONLINE, a
  link-toggle plug and a timeline clock are seven unrelated pills/buttons crammed into the
  top-right with no grouping; the destructive "simulate link loss" plug sits next to them as
  a bare icon.
- **U4 Alert handling.** Alerts live in a drawer opened from a small pill; the count is
  only colour-coded; no unacknowledged/acknowledged split in the pill; the sidebar badge
  shows the alert count on *Infrastructure* only. "Nominal" in mono looks like a label, not
  a state.
- **U5 Operator login clarity.** Invisible READ-ONLY pill (F3); disabled write controls look
  identical to inactive ones (Demo Control rows at 50 % opacity with no reason shown until
  hover); signing in is a tiny popover with no statement of what it unlocks.
- **U6 Hierarchy.** Every page duplicates its title (top-bar "current page" badge *and* a
  panel header with icon box and badge). KPIs, notes and caveats have equal weight; the
  key number and its provenance are not visually linked.
- **U7 Empty / loading / error states** are inconsistent: Weather shows a 300 px empty chart
  box; Energy says "Waiting for physics model…" as body text; errors say "backend
  unreachable" inline; there is a spinner for chunks but no skeletons for data; no retry
  anywhere except the ErrorBoundary.
- **U8 Density and readability.** Long wrapping sentences inside KPI cards ("Daily: ~378 L •
  Stock (logistics ledger): 68,400 L • Autonomy: 181 days"); 9–10 px secondary text;
  numbers formatted ad hoc (`1494.4` rpm, `437.2` ppm, `14200 rations` vs `68,400 L`).
- **U9 Timestamps.** Mixed: GMT in Reports ("Thu, 01 Oct 2026 18:52:25 GMT"), simulated
  time in Twin Inspector, none on most panels. No "last updated" anywhere.
- **U10 Contrast (WCAG AA).** axe: **43** contrast failures (sidebar section titles
  `#64748b` on `#0a0e17` = 4.05 : 1 at 10 px bold, on every page) — plus F3 (1.18 : 1),
  which axe cannot see. Demo Control's disabled rows inherit 50 % opacity.
- **U11 Semantics / keyboard.** No `<h1>` on 5 modules; heading order skips on 5; two
  `<select>`s and one `<input>` without labels; drawers and Demo Control have no focus trap
  or visible focus ring; no keyboard shortcuts; module switch does not move focus.
- **U12 Mobile.** F4, plus: the sidebar is a full-height block *above* the content (the
  user scrolls past 10 nav items to reach any data); the Demo Control FAB overlaps content;
  header badges wrap into 6-line columns ("LIVE / SIMULATOR · / MODEL- / DERIVED").

---

## Per screen

### Shell (top bar + sidebar) — `desktop-01-overview.jpg`, `mobile-01-overview.jpg`
- Visual: logo + "ANTARCTIC DIGITAL TWIN" tagline in 9 px; seven pills of four different
  shapes and colours; neon per-module icon colour; spring-animated active pill; "LIVE"
  pulse dot in the sidebar header duplicates the data-source badge.
- UX: U1, U2, U3, U5; F3, F4. The current-module badge in the top bar repeats the page
  title. The link-loss toggle is a destructive action with no confirmation.

### Mission Overview — `desktop-01-overview.jpg`
- Visual: station card with "JARVIS MODE" pink outline button; four HUD tiles with coloured
  icon boxes; "8/8 OK" tile in green regardless of what was evaluated; Demo Control gear
  FAB overlaps the last HUD tile.
- UX: the HUD repeats values already in the top bar (alerts) and Weather; "Mean Winter: not
  established" chip is a caveat dressed as a fact chip. (3D scene itself out of scope.)

### Weather Observations — `desktop-02-weather.jpg`
- Visual: glass header + cyan badge "NO OBSERVATIONS LOADED"; blue glowing primary button;
  five pill tabs that wrap onto two rows; icons on each tab.
- UX: the empty chart takes 320 px and its only call to action is in the top-right; tabs
  name methods ("IsoForest / SVM", "ARIMA / Prophet") rather than questions; the live strip
  says ERA5 while the chart says "stored observations (none)" — two sources on one screen
  without a clear split. `<select>` unlabeled.

### Infrastructure — `desktop-03-infrastructure-full.jpg`
- Visual: eight identical building cards with icon boxes and "NORMAL" pills; sensor keys
  printed raw ("Gen Rpm", "Lq Co2"); every value to one decimal (`1494.4` rpm); dependency
  graph nodes are mono 3-letter codes in near-invisible grey inside green rings.
- UX: "Click to open 3D inspection →" on every card opens a side panel, not 3D; the side
  panel's live readings are empty (F2); dependency arrows are tiny and ambiguous.

### Energy Grid — `desktop-04-energy-full.jpg`, `mobile-04-energy-full.jpg`
- Visual: four KPI tiles in four arbitrary colours (V3); amber provenance badge reads as a
  warning; "Single modelled generator · second gen-set not modelled" styled as a status pill.
- UX: caveats ("not modelled") compete with values; load-breakdown colours are decorative;
  autonomy (the number an operator actually wants) is buried mid-sentence; no timestamp; on
  mobile the header wraps into narrow columns.

### Logistics & Supply — `desktop-05-logistics-full.jpg`
- Visual: five inventory cards, each with icon box + pencil button + green progress bar
  (green even at 52.9 days of water).
- UX: no table view to compare items; audit log is a separate card at the bottom; no
  sort/filter; edit is an icon-only pencil.

### Remote C&C — `desktop-06-remote-full.jpg`
- Visual: command cards with coloured icon boxes; amber "Request hot-standby" vs blue
  "Request disable" buttons with no consistent meaning.
- UX: state-changing commands fire with one click — no confirmation dialog; "simulated"
  disclaimers repeated in four places.

### What-If Simulation — `desktop-07-whatif-full.jpg`
- Visual: eight scenario tiles with gradient-tinted icon boxes; purple glowing selected tile
  and purple CTA; `⚡` bullets in results.
- UX: hazard multiplier slider unlabeled (axe `label`); results appear below the fold with
  no scroll or focus cue.

### AI Diagnostics — `desktop-08-ai-full.jpg`
- Visual: pink module accent; ten residual cards that all say `0.0σ` in green pills;
  "PHYSICS-RESIDUAL ISOLATION FOREST + 6σ GATE" badge.
- UX: residual grid would read better as a table sorted by |σ|; Chronos table rows say
  "insufficient context (21/30)" with no explanation of what will fix it; "Voice" button
  styled like the four question buttons.

### Station Reports — `desktop-09-reports-full.jpg`
- Visual: teal glowing "Print / Save as PDF" button; report body is a second dark card
  inside the page card; quality chips wrap onto two lines.
- UX: the on-screen report is dark while the printed one is light — no preview of what
  prints; timestamp in GMT.

### System Admin — `desktop-10-admin-full.jpg`
- Visual: pill tabs with icons; blue "Sync Maitri / Sync Bharati" buttons.
- UX: "Users & Roles" lists demo users (labelled HARDCODED-DEMO in small caption text) while
  the real access model is one shared token — the label is honest but too easy to miss; sync
  buttons disabled while read-only with the reason only in a tooltip.

### Overlays
- **Station menu** (`desktop-20`): glass dropdown, fine content, but no keyboard support.
- **Alert drawer** (`desktop-21`): blurs the whole app; Active/History toggle as two tiny
  stacked buttons inside a KPI tile; empty state good.
- **Link drawer** (`desktop-22`): clear copy; provenance is a mono run-on line; "Simulate link
  loss" has no confirmation.
- **Operator login** (`desktop-23`): popover under an invisible pill; does not say what
  signing in unlocks; Cancel/Sign in buttons nearly identical.
- **Twin Inspector** (`desktop-24`): emoji status, `⚡` in title, `✕` text close button;
  values like "ΔT: 34.2°CLoss: 2.9 kW" run together (missing gap).
- **Event timeline** (`desktop-25`): modal; fine but not reachable on mobile.
- **Demo Control** (`desktop-26`): translucent panel over the 3D view; disabled rows at 50 %
  opacity with no visible reason; "Tick #345" jargon.
- **Building panel** (`desktop-27`): empty readings (F2); module chip uses module accent.
