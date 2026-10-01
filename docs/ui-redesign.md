# UI redesign — Phase 1 proposal

Scope: everything except the 3D scene. `StationScene.jsx` (three.js scene, aurora, snow,
mountains) is untouched; only the container around it changes. Evidence for every problem
named here is in [ui-audit/README.md](ui-audit/README.md); the prototype (app shell +
Energy grid) is on branch `ui-redesign`, screenshots in [ui-redesign/](ui-redesign/).

---

## 1. Direction

Aurora should look like an instrument panel that a station engineer reads at 3 a.m.:
calm neutral surfaces, one cold blue accent for interaction, and colour that appears only
when something needs attention. Hierarchy comes from type size, weight and spacing — not
from glow, gradients or a different neon per module. Numbers are the heroes: tabular,
monospaced, always with a unit, a timestamp and a provenance label. Every element earns
its place by carrying information; nothing moves unless state changed.

**Removed:** glassmorphism (`backdrop-filter`, translucent panels), glows and neon
`box-shadow`s, gradient text and gradient fills, the ambient blobs and noise overlay, the
per-module accent colours, emojis used as status or decoration, decorative icons on
headings/cards/tabs, monospace used for labels, uppercase badges next to titles, marketing
copy ("POLAR DIGITAL TWIN MATRIX", "JARVIS MODE"), spring and hover-lift animation,
animated counters, staggered entrances and infinite pulse animations.

---

## 2. Design tokens

Single source: [`src/theme/tokens.js`](../src/theme/tokens.js). Components never contain a
hex value; MUI reads tokens through the theme, Recharts through `useChartTheme()`.

### Palette

| Role | Dark (default) | Light |
|---|---|---|
| App background | `#0F1216` | `#F5F6F8` |
| Surface (cards, bars, nav) | `#161A20` | `#FFFFFF` |
| Raised (hover, wells) | `#1C2129` | `#EEF0F3` |
| Overlay (menus, dialogs, selected nav) | `#232933` | `#FFFFFF` |
| Text primary | `#E7EAEE` | `#171B21` |
| Text secondary | `#AAB2BD` | `#454E5A` |
| Text muted | `#8C95A1` | `#5C6672` |
| Divider / card border | `#323A45` | `#D3D8DE` |
| Control border (inputs, toggles) | `#646E7C` | `#8A939E` |
| **Accent** (interaction only) | `#7FB2E5` | `#1F5E9E` |

Contrast, worst case across the four surfaces of each mode (WCAG AA needs 4.5 : 1 for
text, 3 : 1 for control borders):

| | Dark | Light |
|---|---|---|
| Text primary / secondary / muted | 12.1 / 6.8 / 4.8 | 13.9 / 6.8 / 4.7 |
| Accent as text | 6.6 | 5.4 |
| Text on filled accent button | 8.4 | 6.7 |
| Control border vs surface | 3.1 | 3.1 |

### Status colours — reserved for status

Used only for alert levels, data-source health and "not real" markers; never for
categories, decoration or chart series. Always paired with a text label (never colour
alone). Chips use the colour as text on a 16 % (dark) / 10 % (light) tint.

| Status | Dark | Light | Worst text contrast (on surfaces / on own tint) |
|---|---|---|---|
| Normal | `#5DBB86` | `#17703F` | 6.2 / 5.6 · 4.9 / 5.3 |
| Warning | `#E0A84A` | `#8A5800` | 6.9 / 6.1 · 4.9 / 5.2 |
| Critical | `#F0716A` | `#B3261E` | 5.1 / 4.8 · 5.3 / 5.5 |
| Offline | `#9AA3AE` | `#5C6672` | 5.7 / 5.2 · 4.7 / 5.1 |
| Simulated (not real) | `#A99BE8` | `#5B47B3` | 6.0 / 5.4 · 5.7 / 6.1 |

Chart series and breakdowns use one hue (the accent) in five steps, so a categorical
colour can never be mistaken for a status.

### Typography

- **UI: IBM Plex Sans** (variable weight, `@fontsource-variable/ibm-plex-sans`) — an
  engineering face with open apertures and real italics; distinct from both stock Roboto
  and the Inter look that reads as "generated".
- **Numbers: IBM Plex Mono** 400/500/600 (`@fontsource/ibm-plex-mono`) — tabular by
  design; used for values, times and IDs only, never for labels.
- Both self-hosted (CSP `font-src 'self'`); no third-party request.
- Tabular figures everywhere (`font-feature-settings: "tnum"`).

| Token | Size / line | Weight | Use |
|---|---|---|---|
| caption | 12 / 16 | 500 | timestamps, helper text — **the floor; nothing below 12 px** |
| label / overline | 12 / 16 | 600 | section labels (overline uppercase +0.06em) |
| body-sm | 13 / 18 | 400 | table cells, secondary text |
| body | 14 / 20 | 400 | default |
| title | 16 / 22 | 600 | card titles (h2) |
| page title | 22 / 28 | 600 | one h1 per page |
| kpi | 28 / 34 | 500 mono | headline numbers |

### Spacing, shape, elevation

- **Spacing:** 4-px base (`theme.spacing(n)` = 4n px); steps 4, 8, 12, 16, 24, 32, 48.
  Card padding 16; grid gap 16; page padding 24/32 (desktop), 16 (phone).
- **Radius:** 4 px for controls and chips, 6 px for cards and dialogs. Nothing else.
- **Borders:** 1 px, divider colour; cards are outlined, not raised.
- **Elevation:** none on surfaces. One shadow (`0 8px 24px rgba(0,0,0,.28)`) for floating
  layers only (menus, dialogs, popovers). The dark-mode Paper gradient overlay is off.

### Motion

- 120 ms (hover/press), 180 ms (state change), 200 ms enter / 150 ms exit for overlays;
  one easing, `cubic-bezier(0.2, 0, 0, 1)`.
- Only opacity and transform; only on state change (drawer open, menu, tab indicator).
- No springs, no hover lift, no staggered lists, no animated number counters, no infinite
  animation except a loading indicator.
- `prefers-reduced-motion: reduce` collapses all durations to ~0 (in `MuiCssBaseline`).
- Ripples are disabled globally.

---

## 3. MUI setup

- **Version:** `@mui/material` 9.4 + `@emotion/react` 11.14 / `@emotion/styled` 11.14
  (React 19 is in MUI 9's peer range). No MUI X, no Lab.
- **Theme structure** — `src/theme/`:
  - `tokens.js` — the values above.
  - `theme.js` — `createTheme({ cssVariables: { colorSchemeSelector: 'data-color-scheme',
    cssVarPrefix: 'aur' }, colorSchemes: { dark, light }, defaultColorScheme: 'dark' })`.
    Custom palette groups `palette.status.*` and `palette.aurora.*`; custom typography
    variants `kpi` and `mono`.
  - `AppThemeProvider.jsx` — `ThemeProvider` (`defaultMode="dark"`, mode remembered per
    browser under `aurora-color-scheme`) + `CssBaseline enableColorScheme`.
  - `chartTheme.js` — `useChartTheme()` for Recharts.
- **Component overrides** (all in `theme.js`): CssBaseline (focus ring, reduced motion,
  tnum), Paper/Card (outlined, no gradient), AppBar/Toolbar (flat, bordered, 56 px),
  Button/IconButton/ToggleButton (no uppercase, 4 px radius, 32 px height, no ripple),
  Chip (22 px, 4 px radius), Tooltip (surface-coloured, bordered, non-interactive so it
  never blocks the next click), Drawer/Dialog/Menu/Backdrop, ListItemButton (selected =
  2 px accent inset bar + overlay surface), ListSubheader (section label), Tabs/Tab
  (underline indicator), TableCell (dense 8/12), OutlinedInput, LinearProgress (4 px),
  Alert, Divider, Skeleton (wave).
- **What stops it looking like stock Material:** no shadows, no ripple, no uppercase, no
  Roboto, no 8-px-radius pill buttons, no coloured AppBar, IBM Plex type, flat outlined
  cards, a single desaturated accent, dense tables.
- **Dark/light toggle:** icon button in the app bar (`useColorScheme().setMode`). MUI
  sets `data-color-scheme` on `<html>`. The same attribute on a nested element re-scopes
  the variables — `LegacySurface` pins not-yet-migrated panels to dark inside a light
  shell during the migration.
- **Recharts:** `useChartTheme()` returns resolved hex values for the active scheme
  (Recharts writes SVG presentation attributes, which do not resolve CSS variables
  reliably): series ramp, grid, axis, tick font (Plex Mono 12), tooltip
  `contentStyle`/`labelStyle`, warning/critical reference lines. Animations off
  (`isAnimationActive={false}`). Example: Energy's generator-output chart.
- **Icons:** `@mui/icons-material` **Outlined** set only, imported per icon
  (`import BoltOutlined from '@mui/icons-material/BoltOutlined'`). Google's Material
  icon set as SVG components, tree-shaken to the icons used. Chosen over the Material
  Symbols *font*, which is a multi-MB file per style unless subset (if Symbols' newer
  glyphs are wanted later, `@material-symbols/svg-400` provides the same per-icon SVGs). Icons label
  navigation and actions; they are not placed on headings or cards. `react-icons` is
  removed as panels migrate.
- **Bundle plan:**
  - Every module page, the 3D scene, Recharts, the legacy overlays, the sign-in dialog
    and the phone nav drawer are `React.lazy` chunks.
  - Named imports from `@mui/material` (tree-shaken in production); per-file icon imports.
  - framer-motion and react-icons leave the startup path now and the bundle entirely when
    the last legacy panel is rebuilt.
  - **Measured on the prototype:** entry chunk 302 kB; *all* JavaScript loaded at startup
    497 kB raw / 158 kB gzip (main: 448 / 133). Budget: startup JS < 500 kB raw.
    Phase 2 should come in lower as framer-motion, react-icons and the Space Grotesk /
    Inter / JetBrains Mono fonts go.

---

## 4. Information architecture

```
┌ Aurora · Antarctic station digital twin   [ Maitri | Bharati ]          (theme) (?) (⌘K) ┐  app bar
├ ● Live simulator  ((•)) Link up  (bell) No alerts  ⟲ Events │ (lock) Read-only Sign in   Telemetry 22:31:05 IST · 2 s ago ┤  status strip
├──────────────┬───────────────────────────────────────────────────────────────┤
│ MONITOR      │ MONITOR                                   Updated 22:31:05 IST │
│  Overview    │ Energy grid                       [Generator · Model-derived]  │  page header
│  Weather     │ Diesel generation, fuel burn …    [Fuel stock · Operator-ent.] │
│  Infrastr.   ├───────────────────────────────────────────────────────────────┤
│ ▌Energy grid │  KPI  KPI  KPI  KPI  KPI                                       │
│ OPERATE      │  chart …                      table …                          │
│  Logistics   │                                                                │
│  Remote cmds │                                                                │
│ ANALYSE      │                                                                │
│  What-if     │                                                                │
│  AI diagn.   │                                                                │
│  Reports     │                                                                │
│  Twin insp.  │                                                                │
│ SYSTEM       │                                                                │
│  Admin       │                                                                │
│          «   │                                                                │
└──────────────┴───────────────────────────────────────────────────────────────┘
```

- **Sidebar** — four labelled sections (registry: `src/shell/navigation.js`):
  - **Monitor:** Overview, Weather, Infrastructure, Energy grid
  - **Operate:** Logistics, Remote commands
  - **Analyse:** What-if scenarios, AI diagnostics, Reports, Twin inspector (opens the
    inspector instead of navigating)
  - **System:** Administration

  Plain labels ("Remote commands", not "Remote C&C"). It collapses to 64 px of icons with
  tooltips (sections become dividers) and becomes a temporary drawer below 900 px. The
  current page has `aria-current="page"`. *Proposed for Phase 2:* the module and station
  in the URL (`?module=energy&station=maitri`, History API, no router dependency), so a
  refresh keeps your place and a page can be linked.
- **Station switcher** — a segmented control in the app bar showing both stations at all
  times; the tooltip gives the full name, region and coordinates from
  `station_config.json`. Switching shows a toast ("Showing Bharati") and resets
  station-scoped state.
- **Global status strip** — always visible, same on every page:
  - data source (status dot + label, with the help text in a tooltip)
  - telemetry link (opens the link drawer)
  - active alerts with critical / warning split (opens the alert centre)
  - event log
  - operator access (Read-only → Sign in, or Operator)
  - telemetry time in IST + age

  On phones, low-priority labels collapse to icons and the strip scrolls horizontally.
- **Alert centre** (Phase 2, replaces `AlertFeed`) — a right drawer with tabs **Active ·
  Acknowledged · History**, sorted by severity then age. Each row shows: building, sensor,
  value vs threshold, raised time (IST + relative), Acknowledge (operator only, with
  confirmation and the `acknowledgedBy` name) and a "Show on twin" link that selects the
  building. The strip and the sidebar never disagree on the count; both read `activeAlerts`.
- **Page header** on every module (`src/ui/PageHeader.jsx`): section overline, h1 title,
  one-sentence description, *Updated hh:mm:ss IST · n s ago*, provenance chips, and an
  optional actions slot (e.g. Weather's "Ingest NCPOR data", Reports' export buttons).
  The top-bar "current page" badge goes — the header is the one title.

---

## 5. UX patterns

| Pattern | Rule |
|---|---|
| **KPI card** (`ui/KpiCard`) | Label, one number in Plex Mono 28, unit, one line of context (threshold, share, source). Neutral unless the backend alert engine reports that sensor out of range — then a status chip and coloured progress. Missing value = "—" in muted text. |
| **Data tables** | MUI `Table size="small"`, numbers right-aligned in mono, units in the header, sortable where there are more than ~8 rows (residuals, inventory, alerts, audit logs). Replaces card grids where items are compared (Logistics, AI residuals). |
| **Charts** | Recharts via `useChartTheme()`; axis unit in the subtitle, not on every tick; times in IST; thresholds as dashed reference lines in the matching status colour, labelled "Default …" unless an override is known; no animation; `role="img"` + an `aria-label` summarising the latest value. |
| **Loading** | Skeletons shaped like the content (KPI value, table rows), never a full-page spinner; chunk loads keep the existing `PanelFallback`. |
| **Empty** | One sentence of what is missing and why, plus the action that fixes it, in place of the content — not a 300-px empty frame. |
| **Error** | `Alert severity="warning"` at the top of the affected page: what is unavailable, what still works, **Retry now** (re-runs the poll); automatic back-off continues (`usePolling`). ErrorBoundary card restyled, same behaviour. |
| **Toasts** | Small `Snackbar` queue (no new dependency) for results of actions: "Threshold saved", "Command queued (simulated)", "Signed in as operator". Errors that need action stay inline instead of in a toast. |
| **Confirmation** | One `useConfirm()` + `ConfirmDialog` for every state-changing action: simulate link loss / restore, Demo Control inject and reset, remote command dispatch, threshold save, ledger edit, alert acknowledge, NCPOR sync, simulator mode switch. The dialog names the station, the action and whether it is simulated. |
| **Operator login** | Read-only control in the strip, labelled "Read-only · Sign in". The dialog says what signing in unlocks; the token stays in memory only (unchanged `adminToken.js`). Disabled controls carry a visible "Sign in to …" hint (not only a tooltip). |
| **Provenance** | `ui/Provenance` chip: REAL, REANALYSIS, MODEL-DERIVED, SIMULATED, HARDCODED-DEMO (+ OPERATOR-ENTERED for the ledger). Neutral for measured/modelled data; the *simulated* colour for anything not real. Page-level chips in the header, card-level where a card differs. Tooltips explain each. |
| **Time** | `lib/format.js`: `22:31:05 IST`, `02 Oct 2026, 22:31 IST`, relative `12 s ago`; the ERA5 replay clock is labelled as such. Report exports keep ISO-8601 UTC in data files. |
| **Numbers and units** | `formatNumber` / `formatValue`: fixed decimals per quantity (kW 0, L/h 1, °C 1, rpm 0, % 0), digit grouping, thin no-break space before units, "—" for missing. |
| **Keyboard** | ⌘K / Ctrl+K command palette (MUI `Dialog` + filtered list: modules, station switch, sign in/out, theme, open alerts, start tour); `?` opens help and shortcuts; `g` then a letter jumps to a module; Esc closes overlays; every control reachable by Tab with the visible focus ring; focus moves to the page h1 on navigation. Lazy-loaded. |

---

## 6. Guided product tour

- **Library: driver.js 1.8** (MIT, ~5 kB gzip, no dependencies). It is framework-agnostic —
  it highlights DOM nodes by selector and has no React peer dependency — so React 19
  cannot break it. Built in: Next / Back / Close, a progress label, keyboard navigation
  (← → Esc), scroll-into-view and responsive popovers. Its stylesheet is a static CSS file
  (CSP-safe); positioning uses inline `style` attributes, which `style-src-attr` allows
  (§7). Themed with our tokens via its `popoverClass`.
  - react-joyride 3.2 also declares React 19 support (`react: 16.8 – 19`), but brings 10
    dependencies and renders through React portals. driver.js is smaller and cannot
    conflict with MUI's own portals and focus traps.
- **Behaviour:**
  - Auto-starts on the first visit, after the first telemetry snapshot arrives.
  - Remembered per browser in `localStorage` (`aurora-tour-v1`, wrapped in try/catch).
    Bumping the version re-shows the tour after a big change.
  - Restartable from the Help menu (`?` icon in the app bar) and the `?` shortcut.
  - "Skip tour" on every step. Progress shows "3 of 12".
  - On phones, steps that target the sidebar open the drawer first.
- **Steps** (targets are `data-tour` attributes, several already in the prototype):

| # | Target | Says |
|---|---|---|
| 1 | `station-switcher` | Two stations; everything on screen follows this switch. |
| 2 | `status-strip` (data source) | Where the numbers come from right now — live simulator, physics fallback or browser demo. |
| 3 | `alert-centre` | Active alerts by severity; open the alert centre to acknowledge. |
| 4 | `operator-login` | You can view everything; sign in to change anything. |
| 5 | `overview` | The 3D twin: building colours follow alert state; click a building for its readings. |
| 6 | `nav-monitor` | Weather, infrastructure and energy — live state. |
| 7 | `nav-operate` | Inventory ledger and simulated remote commands. |
| 8 | `nav-analyse` | Scenarios, AI diagnostics, reports. |
| 9 | `nav-ai` | AI diagnostics: physics-residual anomaly detection and the decision engine. |
| 10 | `nav-twinInspector` | Twin inspector: how each number is derived, with its assumptions. |
| 11 | `demo-control` | Demo Control injects synthetic faults to exercise the alert path (operator only). |
| 12 | `nav-system` | Data sources and alert thresholds. Restart this tour any time with ?. |

- **Optional per-module tours** (offered by a "Tour this page" link in the page header):
  Weather (live strip vs stored observations, the analysis tabs), Infrastructure (reading
  the dependency graph), What-if (pick hazard → multiplier → run → read the cascade), and
  Administration → Alert thresholds (defaults vs overrides, what saving does).

---

## 7. Constraints

### Functionality kept (checked in the prototype)
All API calls, polling, WebSocket handling, alert acknowledgement, the ADMIN_TOKEN
operator flow (`adminToken.js` / `useAdminToken` unchanged; same test ids), every
ErrorBoundary, the 2D no-WebGL fallback (StationScene untouched), provenance labels,
lazy loading, analytics hooks. Legacy panels render unchanged inside `LegacySurface`.

### CSP
Current header (`docker/nginx-security-headers.conf`): `script-src 'self'; style-src
'self' 'unsafe-inline'`. Emotion's injected `<style>` tags are therefore **already
allowed** — the prototype needs no CSP change, and `script-src` is untouched.

The redesign is a chance to *tighten* styles without touching scripts:

```
style-src      'self';
style-src-elem 'self' 'nonce-$request_id';
style-src-attr 'unsafe-inline';
```

- nginx: `sub_filter '__CSP_NONCE__' $request_id;` on `index.html` only (already
  `Cache-Control: no-store`), and the same `$request_id` (128-bit random, unique per request)
  in the header. `index.html` gets `<meta name="csp-nonce" content="__CSP_NONCE__">`.
- Emotion: `createCache({ key: 'aur', nonce })` from that meta tag, passed through
  `<CacheProvider>`.
- `style-src-attr 'unsafe-inline'` remains because React `style={}`, Recharts, driver.js
  and three.js set style *attributes*; nonces cannot cover attributes. Injected `<style>`
  elements — the meaningful injection vector — then require the nonce.
- Browsers without CSP3 split directives (Safari < 15.4) fall back to `style-src 'self'`
  and would drop inline styles, so this ships behind a flag after a browser check — or we
  keep the current `style-src` and accept it (decision for you, §9).

### e2e
`tests/e2e/smoke.spec.js` is already updated on the branch and passes (4/4 against the
local stack with write protection on):
- Navigation by `data-testid="nav-<id>"` + `aria-current="page"` instead of sidebar label
  text and `.sidebar-item.active`.
- Station by `data-testid="station-option-<id>"` + `aria-pressed`.
- Every module page is one `data-testid="module-panel"` with `data-module`; the tour
  asserts **exactly one** is mounted — this is what catches audit F1.
- Markers: legacy panels keep their heading markers; migrated modules match their page
  title (`data-testid="page-title"`). Each Phase 2 migration updates one marker.
- Read-only text matched case-insensitively; all existing test ids kept
  (`data-source-badge`, `alerts-pill`, `operator-login`, `operator-token-input`,
  `operator-submit`, `operator-logout`, `alert-drawer`, `error-boundary`,
  `panel-fallback`, `station-2d-fallback`).
- To add in Phase 2: a 390-px project (phone layout, drawer nav), a light-mode run, and
  an axe pass on each migrated page (the prototype's shell + Energy page has **0** axe
  violations in both modes at both widths).

---

## 8. Prototype status (branch `ui-redesign`)

Built: theme + tokens, app bar with station switcher and theme toggle, status strip,
sectioned collapsible sidebar (drawer on phones), page header, provenance/status/KPI/
section primitives, number and time formatting (`lib/format.js`, unit-tested), the
restyled operator login, and **Energy grid** fully rebuilt. Fixed on the way: F1 (module
pages stacking) and F3 (invisible Read-only control). Removed: old TopBar/SidebarNav,
ambient blobs, noise overlay.

Not yet (Phase 2): the other nine modules and the overlays (alert centre, link drawer,
building panel, timeline, Twin Inspector, Demo Control) still render in their legacy
style inside `LegacySurface` (always dark, also in light mode); command palette, tour,
toasts, confirmation dialogs, URL state; F2 (building panel readings) and F4 (old
mobile top bar — gone with the new shell, but legacy overlays are not yet mobile-ready).
At 390 px the status strip scrolls horizontally to reach the last control.

Screenshots: `docs/ui-redesign/{dark,light}-{desktop,mobile}-energy[-full].png`,
`{dark,light}-desktop-overview.png`, `{dark,light}-mobile-nav.png`.

---

## 9. Open questions

1. **Number grouping:** international `1,00,000 → 100,000` (prototype) or Indian
   `1,00,000` (en-IN)? Operators are Indian; scientific convention is international.
2. **CSP:** tighten to the nonce scheme in §7 (drops Safari < 15.4), or keep the current
   `style-src 'self' 'unsafe-inline'`?
3. **URL state:** add `?module=&station=` so pages can be linked and survive refresh?
   (Small, no new dependency, but it is new behaviour.)
4. **F1 on production:** hotfix `main` now (restore single-panel rendering, plus the e2e
   assertion), or wait for the redesign to land?
5. **"JARVIS MODE" and "Voice"** buttons: keep (relabelled "Voice assistant"), or drop?
6. **Light mode for the 3D overview:** the scene stays dark in both modes (out of scope);
   OK, or should the light shell switch to dark on the overview page?
7. **Fonts:** IBM Plex Sans + Plex Mono acceptable, or is there an NCPOR / MoES typeface
   to match?
