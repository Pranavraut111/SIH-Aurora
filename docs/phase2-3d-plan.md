# Phase 2 — realistic, data-driven 3D overview (plan)

Status: **2A, research and plan only.** No production code changes on this branch (`phase2-3d`)
yet. Concept renders: [`docs/phase2-concepts/`](phase2-concepts/).

Scope: replace the low-poly scene in `src/components/StationScene.jsx` with:

1. an **Antarctica view**, with Maitri and Bharati at their real coordinates, and a fly-over
   transition when the station changes;
2. **two station scenes** that look different from each other and follow published facts;
3. **restrained realism**: terrain, snow surfaces, sky, low polar light, falling and blowing snow;
4. **data bindings**: wind drives blowing snow, the replay clock drives the sun and polar
   day/night, alert states drive building highlights, and a building click opens the existing
   building panel.

The rest of the app must keep working as it does now.

---

## 1. What exists today (integration audit)

| Concern | Current behaviour | Where |
|---|---|---|
| Mount | `React.lazy(() => import('./components/StationScene'))` inside `ErrorBoundary` + `Suspense`, inside `.overview-stage[data-tour="overview"][data-color-scheme="dark"] > .scene-container` | `src/App.jsx:41`, `:399–414` |
| Props | `activeStation`, `avoidBottom`, `alertStates`, `selectedBuilding`, `onBuildingClick`, `onBuildingHover` | `src/App.jsx:404` |
| `activeStation` | **Passed but ignored.** Both stations render the same scene. | `StationScene.jsx` |
| Buildings | 8 *logical subsystems* (`generator`, `heating`, `heatingB`, `waterTank`, `commsMast`, `livingQuarters`, `storage`, `lab`). The list is identical for both stations in `station_config.json`. Positions and sizes are hard-coded in `BUILDING_LAYOUT` (`src/data/stationData.js:32`). | |
| Alert colours | Old Tailwind hexes (`#4ade80/#fbbf24/#f87171`), **not** the v2 status tokens. Critical pulses forever and the comms beacon blinks, both of which `ui-redesign.md` §1 forbids. | `StationScene.jsx:14` |
| Click | Raycast → `onBuildingClick(id)`. A miss calls `onBuildingClick(null)`. App opens `BuildingDrawer`. | `:652` |
| Overlay fit | `avoidBottom` = height of the HUD card band. The scene fits the station above it with `camera.setViewOffset` and a mild zoom-out, and publishes the on-screen box as `data-model-box` (about 2 Hz). | `:674–704`, `:593–613` |
| 2D fallback | WebGL probe → `StationFallback2D`. If init throws, `onFatal` switches to 2D with the reason. Unit-tested. | `StationScene.test.jsx` |
| Tour | Step 5 targets `[data-tour="overview"]`, the stage around the scene. Its copy says "A 3D model of the station". | `src/tour/steps.js:40` |
| e2e | `.scene-container canvas` visible. | `tests/e2e/smoke.spec.js:156` |
| Cost | `StationScene` chunk is **538 kB raw**, three r128. Snow is updated **on the CPU every frame** (4,500 points), and `scene.traverse` runs every frame. There is no pause when the tab is hidden. | `dist/assets` |
| CSP | `script-src 'self'` (no `'unsafe-eval'`, **no `'wasm-unsafe-eval'`**), `img-src 'self' data: blob:`, `worker-src 'self' blob:`, `connect-src 'self'`. | `docker/nginx-security-headers.conf` |
| Existing helpers | `lib/solar.js` (`solarElevation`, `dayState`, tested at both solstices). `shell/antarctica.js` (Natural Earth 1:110m outline, south-polar stereographic `project()`). | |
| Telemetry | Every snapshot and WS message carries `replay {timeMs, local, speedFactor, loop, utcOffsetSource}` and `lab.env_wind` (km/h). **Wind direction is not in telemetry**, although the ERA5/Open-Meteo cache has `wind_direction_10m` (`weather_data.py:123`). | |

---

## 2. Research findings per station

Rule for the UI: anything in the **Assumed** column is drawn, but labelled
**"Schematic layout — positions approximate"** in the scene corner and in the accessible
description. Footprints and orientations move from *assumed* to *known* only when they are traced
from openly licensed imagery (§3.3), never from Google Earth or press photos.

### 2.1 Bharati — Larsemann Hills (69.41° S, 76.19° E; 35 m)

| | Known (source) | Assumed (to verify) |
|---|---|---|
| Site | Grovnes promontory, Larsemann Hills, Prydz Bay coast, East Antarctica [CEE; Wikipedia]. Ice-free gneiss knolls with snow patches. Sea and sea ice to the north. Larsemann Hills is ASMA No. 6, shared with Progress (RU) and Zhongshan (CN). | Exact knoll shapes until REMA is processed. Sea-ice extent by season. |
| Main building | **One integrated building**, elevated on columns, made of **134 shipping containers** (128 per bof) that are both the rooms and the structure [bof; e-architect; New Atlas]. Containers are offset-stacked and wrapped in an **aerodynamic, climate-optimised metal skin**: steel-sandwich and high-insulation aluminium panels. The form was developed in a **wind tunnel** to limit snow drift [bof; dbz; New Atlas]. | Overall length × width × height. The concept uses ≈54 × 20 × 10 m on ≈2.6 m columns, derived from 2,162–2,500 m² floor area over two main levels. Finish colour: the concept uses neutral aluminium; check against photos. |
| Facade rhythm | Panels in standard lengths of **two container axes = 4.90 m** [dbz]. | — |
| Glazing | About 5 % of the facade. **Large inclined (15°) triple-glazed fronts at the north (lounge, sea view) and south (cafeteria, land view) ends** [dbz]. | Exact glazed area shape. |
| Levels | Lower level: labs, storage, technical plant, **energy centre**, garage and workshop. Upper level: 24 single and double rooms, kitchen, dining, library, gym, offices, lounge, operating theatre. Roof level: terrace and plant [bof; New Atlas; e-architect]. | Which end the energy centre is at. |
| Energy | Three CHP units on kerosene [New Atlas; CEE]. | — |
| Outbuildings | Kerosene tanks, pipelines, helipad (built 2010/11) [e-architect]. Fuel farm and station, **sea-water pump**, summer camp [Wikipedia, citing COMNAP]. **Heliport at 69°24′24″ S 76°11′36″ E**, about 155 m N and 239 m E of the station reference point [Wikipedia]. | Tank count and position. Summer-camp position. |

### 2.2 Maitri — Schirmacher Oasis (70.77° S, 11.73° E)

| | Known (source) | Assumed (to verify) |
|---|---|---|
| Site | **Schirmacher Oasis**, an ice-free rocky plateau about 100 km inland in Dronning Maud Land, with many freshwater lakes. The continental ice sheet rises to the south, and the Wohlthat massif is beyond it [NCPOR; Wikipedia]. **Lake Priyadarshini** supplies the station's water. **Novolazarevskaya (RU) is about 5 km away**, and the Novo blue-ice runway about 10 km [Wikipedia]. | Lake outline and bearing from the station (the concept places it arbitrarily). |
| Main building | **One main building, long and U-shaped, tan-coloured, on steel stilts / adjustable telescopic legs**, built 1989 [NCPOR; Lonely Planet via search; Wikipedia]. 25 people in winter, about 40–45 in summer [NCPOR; Wikipedia]. | Arm and spine lengths (the concept uses a 56 m spine and 26 m arms, single storey, 1.6 m legs). Roof form. |
| Outbuildings | **Fuel farm, fuel station, lake-water pump house, summer camp, several containerised modules**, plus containerised lab space [NCPOR]. | All positions. Container count and colours. |
| Context | Maitri-II redevelopment competition (2024) [CGI Sydney / NCPOR]. The current station will eventually be replaced. | — |
| **Data discrepancy** | NCPOR's page says the station is at **about 50 m** elevation. `station_config.json` says 117 m (medium confidence, `needsNcporConfirmation: true`, agreeing with Wikipedia). | The scene takes its height from the terrain model, not from config. Raised with the owner of `station_config.json`, not changed here. |

### 2.3 Mapping logical subsystems to physical things

The 8 subsystem ids stay as they are: the API, alert engine and building panel are keyed on them.
Each station gets a `scene` block in **`station_config.json`**, the single source of station
facts. It maps each subsystem to a *pickable zone*, with `source` and `confidence` like every
other fact in that file:

| Subsystem | Bharati | Maitri |
|---|---|---|
| generator | Energy centre: a lower-level band of the main building | Generator/power module (position assumed) |
| heating / heatingB | Upper and lower heating zones of the main building (CHP heat) | Spine / arms of the U |
| waterTank | Water treatment inside, plus the sea-water pump house | Lake-water pump house |
| commsMast | Antenna mast or radome (assumed) | Antenna mast (assumed) |
| livingQuarters | Upper level | Spine of the U |
| storage | Kerosene tank farm + garage/store | Fuel farm + containerised stores |
| lab | Lower-level labs | Containerised lab modules |

On a single integrated building (Bharati), a subsystem highlights **its zone**, a band of facade
panels. This is honest about the fact that "Heating Zone A" is not a separate building.

---

## 3. Terrain and coastline data

### 3.1 Sources and licences

| Use | Dataset | Licence / terms | Notes |
|---|---|---|---|
| Continent outline (now) | **Natural Earth 1:110m land** | Public domain | Already in `shell/antarctica.js`. Too coarse for the 3D coast. |
| Continent and local coastline | **SCAR Antarctic Digital Database (ADD) v7.x** coastline, medium and high resolution, with land / ice-shelf / rumple attributes | **CC BY 4.0**, attribution to SCAR ADD / BAS | Separates ice shelves from grounded ice, which lets the continent read correctly. |
| Elevation (continent and stations) | **REMA v2 mosaic** (PGC / Byrd), 1 km for the continent, 32 m / 10 m for 6 × 6 km station tiles | Free use. **Citation and NSF acknowledgement required** (PGC policy) | Surface elevation is what we want to render. Downloadable without login. |
| Optional ice / bed context | **BedMachine Antarctica v3** (NSIDC-0756) | Open, citation required (EOSDIS policy). Needs an Earthdata login to download. | Only if we show ice thickness or a cutaway. **Not needed for 2B–2D.** |
| Optional sea floor | IBCSO v2 | CC BY 4.0 | Cut first. |
| Footprint tracing | **Copernicus Sentinel-2** (10 m) / **Landsat 8–9** (15 m pan) | Sentinel: free, attribution "contains modified Copernicus Sentinel data [year]". Landsat: public domain. | To trace lake outlines, building orientation and outbuilding positions. **Never** Google/Bing/Maxar imagery (their terms forbid tracing). |

### 3.2 Processing pipeline (offline, committed outputs)

`scripts/terrain/` (Python, run by hand; its own `requirements-assets.txt`, not installed by
`make setup`):

1. **Continent:** REMA 1 km → reproject to the same south-polar stereographic projection as
   `shell/antarctica.js` (0° up, 90° E right), so a lat/lon maps to one position in every view.
   Resample to **512 × 512**, clip with the ADD land and ice-shelf polygon, quantise to int16
   metres, write `continent-512.bin`. Coastline: ADD medium, simplified (Douglas–Peucker) to
   about 3k vertices, written as a flat Float32 array.
2. **Stations:** a 6 × 6 km REMA tile centred on each station's config coordinates →
   **257 × 257** (≈23 m/px) for the far ring plus a **129 × 129** 2 km inner tile (≈16 m/px).
   The inner tile gets a hand-authored **levelled pad** mask under the buildings, because REMA
   has the buildings and snow drifts baked in. Write int16 `.bin` files.
3. **Surface classes:** from Sentinel-2 (NDSI threshold for snow/ice versus rock, NDWI for lake
   ice), downsampled to 256² and stored as one 8-bit WebP splat (R snow, G rock, B lake ice).
   This makes the oasis look like the oasis rather than procedural noise.
4. A `manifest.json` per asset (source, licence, citation, processing parameters, sha256) feeds
   the licence register (§9).

Why int16 `.bin` and not PNG/KTX2: browser canvases decode images to 8 bits per channel with
colour management. Raw int16 is exact, needs no decoder, and compresses well over the wire.
nginx `gzip_types` needs `application/octet-stream` added: one line, done in 2B.

### 3.3 Known versus assumed, in the pipeline

The `scene` block in `station_config.json` records, per object, `source`
(`"Sentinel-2 L2A 2024-01-12, traced"` / `"published description"` / `"assumed"`) and
`confidence`. The scene's "Schematic layout" label disappears **only** for a station whose
objects are all traced or documented.

---

## 4. Technical approach

### 4.1 Recommendation: stay on vanilla three.js, upgrade r128 → current (r18x). Not R3F.

| | Vanilla three (upgraded) | React Three Fiber + drei |
|---|---|---|
| Fit with the code | The current scene is imperative. Props drive state through refs, and a small React shell stays. | Full rewrite into JSX scene graph. |
| Bundle | three only. Tree-shaken core + `examples/jsm` pieces we import. | +R3F (about 45 kB gz) + drei (pulls in many helpers; tree-shaking is uneven) + zustand etc. |
| Peer constraints | none | R3F 9.x needs React `>=19 <19.4` (we are on 19.2.8: fine now, but it pins our React upgrades). |
| Testing | Pure modules (camera path, sun vector, alert mapping, quality tier) unit-test without WebGL. | Same logic ends up inside hooks; harder to test without a canvas. |
| Render on demand | Easy: we own the loop. | `frameloop="demand"`; fine, but it's another abstraction. |
| What R3F would buy us | Declarative scene graph and drei goodies (`<Sky>`, `<Environment>`, `<Html>`). | We need few of them, and those we need are small to write. |

Two scenes, about ten object types and one camera rig is not enough scene to justify a second
reconciler. **Upgrade three in 2B** (r128 is four years old). Changes needed: `outputEncoding` →
`outputColorSpace`, physically correct light units (intensities need retuning), `Geometry`
already absent, and `OrbitControls` import path unchanged. Gains: WebGL2-first, proper colour
management, `BatchedMesh` / `InstancedMesh` improvements.

### 4.2 Buildings: procedural from a layout spec, not modelled glTF

- A small **parametric builder** per building type: container-block-with-skin (Bharati),
  U-on-legs (Maitri), tank, container module, mast, pad. It takes dimensions from the
  `station_config.json` `scene` block.
- **Why:** geometry is a few kB of code instead of hundreds of kB of glTF. Assumed dimensions
  stay **data**, editable and labelled, not baked into a model. Zones (§2.3) are just ranges of
  the same parametric mesh. Licensing is trivial, because it's all original.
- glTF is kept as an **escape hatch** for one or two complex props (e.g. a radome), with
  `KHR_mesh_quantization` and **no Draco or meshopt** (see 4.3), loaded by `GLTFLoader`.

### 4.3 Assets and the CSP

- **Draco, meshopt and Basis/KTX2 decoders are WebAssembly.** With `script-src 'self'` and no
  `'wasm-unsafe-eval'`, the browser refuses to compile them. Adding `'wasm-unsafe-eval'` is narrow
  (it allows Wasm compilation, not JS `eval`), but it is a **CSP decision for the owner**, and
  this plan doesn't need it:
  - geometry: procedural, or quantised glTF that needs no decoder;
  - heightmaps: raw int16 + gzip;
  - textures: **WebP** (native browser decode), at most 1024², mostly 256–512 tileable detail
    maps (snow sparkle normal, rock albedo/normal), all original or CC0 and recorded.
  - KTX2 remains a later option if GPU-memory pressure shows up on phones and the CSP change is
    approved.
- Everything is self-hosted under `src/scene/assets/` and imported with `?url`, so Vite hashes it
  and it gets long-cache headers. No CDN, no runtime fetch outside `'self'`. Shaders are GLSL
  strings compiled by WebGL, not JS eval: allowed.

### 4.4 Module layout (proposed)

```
src/components/StationScene.jsx   (kept: WebGL probe, 2D fallback, onFatal; lazy entry, path unchanged)
src/scene/
  SceneRoot.js        renderer, loop (render-on-demand + visibility pause), resize/avoidBottom fit
  quality.js          tier detection + runtime downgrade
  camera/rig.js       orbit limits per view; camera/flyover.js  path + easing; crossfade
  world/continent.js  heightmap mesh, ADD coastline, graticule, pins
  world/terrain.js    station tiles, pad, splat material
  world/sky.js        analytic sky from the sun vector; stars under polar night
  world/snow.js       GPU falling snow + ground-hugging drift streaks (vertex-shader animated)
  world/light.js      sun/hemisphere from replay.timeMs via lib/solar.js
  stations/builders.js  parametric building types; stations/zones.js  subsystem → zone meshes
  bind/alerts.js      alert level → token colour/material state
  a11y/SceneControls.jsx  station switch, view toggle, building list, live description (DOM)
  assets/             *.bin, *.webp, manifest.json
```

---

## 5. Data bindings

| Input | Source | Mapping | Provenance shown |
|---|---|---|---|
| Sun position, polar day/night | `replay.timeMs` (wall clock if absent) + station lat/lon → `solarElevation` and a new `solarAzimuth` in `lib/solar.js` (same algorithm, tested at the solstices) | Directional light vector and colour (warm below 10°, neutral above), sky model, exposure. Below −6°: stars, and building windows lit. | MODEL-DERIVED (already the mini-card's label) |
| Blowing snow | `lab.env_wind` km/h | < 15 km/h: none. 15–30: faint drift streaks near the ground. 30–55: denser streaks, up to 3 m. > 55 (blizzard): low visibility via fog density. Smoothed over about 10 s, so the 2 s ticks don't flicker. | Same as the wind figure (REANALYSIS while replaying) |
| Wind direction | **Not in telemetry.** Option (2D, cuttable): add `lab.env_wind_dir` from the ERA5 cache to the snapshot (REANALYSIS). Fallback: the station's prevailing direction, labelled "assumed". | Streak direction | |
| Falling snow | No precipitation field. Light constant flurry, or none, decided at review. Never claimed as data. | — | Decorative: kept faint |
| Building highlight | `alertStates[id]` | normal: no tint. warning / critical: a **steady** tint of the zone plus a flat ground ring in the **status token** colour (`theme/tokens.js` `status.*.main`, dark set). A text label always accompanies the colour (list and description). Selected: accent `#7FB2E5` outline. **No infinite pulse, no blinking beacon** (ui-redesign §1). | — |
| Click | Raycast on zone meshes → `onBuildingClick(id)`; a miss → `onBuildingClick(null)` | Unchanged contract | — |

---

## 6. Views, camera and transitions

- **Station view** (default): orbit around the station, with polar angle and distance limits per
  station. Fitted above the HUD band with the existing `avoidBottom` → `setViewOffset` logic, which
  is kept, and `data-model-box` keeps being published.
- **Antarctica view:** reached with a scene-corner button "Antarctica" (and `A`). Shows the
  continent, the graticule, both pins and the fly path. Clicking or pressing Enter on the other
  pin switches station through a **new optional prop `onStationChange`**, wired to the existing
  `handleStationChange` (`App.jsx:205`), so URL state, analytics and data loading behave exactly as
  with the top-bar switch.
- **Fly-over:** whenever `activeStation` changes (from any control): station A orbit → rise to
  continent altitude → glide along the great-circle arc → descend to B. **About 4 s**, one easing
  (`cubic-bezier(0.2,0,0,1)`). Any input cancels it to the destination.
- **`prefers-reduced-motion: reduce`:** no camera flight. A **200 ms crossfade** between the two
  rendered views (two-frame composite), snow streaks frozen at low density, and orbit damping off.
  `data-transition="crossfade|flyover"` on the container makes it testable.

---

## 7. Performance budgets

| Budget | Target | How it's enforced |
|---|---|---|
| Startup JS | **< 500 kB raw** (now 465). The 3D chunk is **never** in startup JS. | Already lazy. A CI check (2B) fails the build if any `three` module is in the entry graph. |
| 3D JS chunk | **≤ 650 kB raw / ≤ 170 kB gzip** (three r18x core + our code; now 538 kB raw) | Build-size check in CI |
| Assets, continent view | **≤ 350 kB** transferred (512² int16 heightmap ≈ 160 kB gz + coastline + one detail texture) | Size check over `manifest.json` |
| Assets per station | **≤ 600 kB** transferred (2 tiles + splat + 2–3 WebP detail maps), loaded only for the station being shown | Same |
| Total 3D assets | **≤ 1.6 MB** | Same |
| GPU memory | ≤ 96 MB high tier, ≤ 48 MB low tier | Measured in 2D |
| Frame rate, high tier | **60 fps** on a mid-range laptop (reference: Intel Iris Xe / Apple M1 at 1440×900, DPR ≤ 2): ≤ 120 draw calls, ≤ 400k triangles, one 2048 shadow map | Perf HUD in dev (`?perf=1`) plus a scripted 10 s orbit in Playwright on hardware (manual) |
| Frame rate, low tier (phones, coarse pointer, `deviceMemory ≤ 4`, or > 22 ms frame time over 2 s) | 30 fps or better: DPR 1, 1024 shadow (or baked contact shadows), 129² terrain, ¼ snow, no drift streaks, no fly-over (crossfade) | `quality.js`, with automatic downgrade at runtime |
| Idle | **Render on demand:** no frames when nothing changes (snow and transitions request frames). Pause when the tab is hidden or the canvas is off-screen (IntersectionObserver). | Unit-tested loop |
| No-WebGL | 2D fallback kept as is (`StationFallback2D`), with the same reason messages. Its tests are unchanged. | Existing tests |

---

## 8. Integration contract (must not change)

- **Default export and path** `src/components/StationScene.jsx`, lazy-loaded from `App.jsx`.
  Props unchanged, plus optional `onStationChange` and `replay` / `sensors` (wind, clock).
- **Alert colours:** v2 status tokens only, read from `theme/tokens.js`. No new colours. Status is
  never shown by colour alone.
- **Click events:** `onBuildingClick(id | null)` and `onBuildingHover(id | null)`, with the same
  ids. `BuildingDrawer` is untouched.
- **Tour:** `[data-tour="overview"]` stays on the stage. The step text is updated to say the scene
  is schematic and that the Antarctica view exists. A new `data-tour="scene-controls"` target goes
  on the view toggle and building list.
- **Overlay fit:** `avoidBottom` honoured in both views. `data-model-box` published (now for the
  station or the two pins). Layout check at 1280×720 … 1920×1200: no card overlaps the model.
- **Theme:** the overview stays dark in both colour schemes (decision 6). Scene lighting comes from
  the replay clock, not the UI theme. Scene DOM controls use the dark tokens inside
  `[data-color-scheme="dark"]`.
- **CSP:** no eval, no Wasm (unless the owner adds `'wasm-unsafe-eval'`), no external origins. All
  assets self-hosted. Verified through nginx in the e2e job, as now.
- **2D fallback**, `ErrorBoundary`, `onFatal` behaviour and the unit tests in
  `StationScene.test.jsx` stay green unchanged. WebGL context loss → restore, or fall back with a
  reason.

## 9. Accessibility

- **Scene controls are DOM, not canvas:** a compact toolbar in the scene corner with
  *Station view / Antarctica* (toggle buttons), and a **"Buildings" list button** that opens a
  list of the 8 subsystems with their alert level as text ("Fuel farm — Critical"). Each item is
  a button that calls `onBuildingClick(id)`, and the list is reachable by Tab. The canvas itself
  is `aria-hidden`.
- **Keyboard:** `A` toggles the Antarctica view. `[` / `]` switch station (through the existing
  shortcut system, listed in the shortcuts dialog). Arrow keys orbit when the canvas wrapper has
  focus (`tabIndex=0`, visible focus ring). Esc cancels a fly-over.
- **Screen-reader description:** a visually hidden `aria-live="polite"` region, updated only when
  the summary changes (debounced). Example: "Maitri station, schematic layout. Polar twilight, sun
  3° below the horizon (replay 3 Sep, 14:20 local). Wind 46 km/h, blowing snow. 1 subsystem
  critical: Fuel farm. 7 normal." During a flight: "Flying to Bharati."
- **Contrast:** status rings use the token colours, which already clear 3:1 against the dark scene
  ground. The labels carry the meaning.

## 10. Licensing

- Code, procedural geometry and shaders: original.
- Data: Natural Earth (PD), SCAR ADD (CC BY 4.0), REMA (citation + NSF acknowledgement), optional
  BedMachine (citation), Sentinel-2 (Copernicus attribution) / Landsat (PD).
- Textures: original (generated from noise or photographed by the team), or CC0 only (e.g.
  ambientCG / Poly Haven are CC0). Every file is listed.
- **Register:** `src/scene/assets/ASSETS.md` (file, source URL, licence, citation, processing,
  sha256), generated from the `manifest.json` files. An **About this view** link in the scene
  controls shows the required attributions (CC BY / REMA acknowledgement). A CI check fails if an
  asset under `src/scene/assets/` is missing from the register.
- No press photos, architect renderings or Google Earth imagery as textures or tracing sources.
  They are reference only, and they are cited.

---

## 11. Build checkpoints

Each checkpoint: `make test`, `make lint`, `npm run build`, budgets checked, screenshots under
`docs/phase2/<checkpoint>/` (dark desktop 1440×900, phone 390×844, reduced-motion still where it
applies), then commit and review.

| | Scope | Screenshots | Effort |
|---|---|---|---|
| **2B — Antarctica view + fly-over** | three r128 → r18x upgrade with the current scene ported (no visual change). Render-on-demand loop, visibility pause. `quality.js`. Continent pipeline (REMA 1 km + ADD) → `continent-512.bin`. Continent mesh, graticule, pins. View toggle. `onStationChange` wiring. Fly-over plus reduced-motion crossfade. Scene controls DOM skeleton. gzip type. Bundle checks in CI. Asset register scaffold. | continent view; mid-flight frame; reduced-motion crossfade; phone | **4–5 days** |
| **2C — station models + terrain** | Station tile pipeline (REMA 32/10 m, pad masks), Sentinel-2 tracing of lakes, footprints and orientation; surface-class splat. Parametric builders (container block with skin, U on legs, tanks, modules, mast, pad). `scene` block in `station_config.json` with source/confidence. Zones and picking. Alert tint and rings with tokens. Building list. "Schematic layout" label. Overlay fit and `data-model-box` per station. | Bharati and Maitri, each with one warning and one critical; building list open; layout check grid | **6–8 days** |
| **2D — atmosphere + data bindings + polish** | Sky model, sun from the replay clock, polar night (stars, lit windows). GPU snow and wind-driven drift. Optional `env_wind_dir`. Live SR description. Keyboard shortcuts. Low-tier tuning on a real phone. Perf pass against budgets. Context-loss handling. Tour copy. e2e: building list → drawer, station switch, reduced motion, model-box vs cards. Docs (`ui-redesign.md` §16). | polar day / twilight / polar night per station; calm vs 50 km/h wind; low tier on phone | **4–5 days** |

Total **≈ 14–18 working days** for one developer, plus review rounds.

---

## 12. Risks, and what to cut first

| Risk | Mitigation |
|---|---|
| **Building geometry is mostly unpublished** (dimensions, outbuilding positions) | Parametric and data-driven, labelled "Schematic layout". Sentinel-2 tracing upgrades individual objects to *known*. Ask NCPOR for a site plan; it would replace the assumptions directly. |
| REMA has buildings and drifts baked in at 10 m | Levelled pad masks, plus a 32 m far ring. |
| r128 → r18x upgrade changes lighting and colour | Done first, in 2B, as a no-visual-change port with before/after screenshots. |
| Software-GL CI (SwiftShader) is slow | e2e checks behaviour and DOM (list, drawer, `data-transition`, model-box), not fps. Perf is checked by hand on hardware. |
| Phone GPUs / memory | Low tier from first launch, plus a runtime downgrade. Crossfade instead of a flight. |
| CSP and Wasm | Avoided by design. KTX2/Draco only after an explicit CSP decision. |
| Fly-over feels flashy | One easing, about 4 s, cancellable, no lens effects. Reduced motion gives a crossfade. |
| Scope creep (vehicles, people, aurora…) | Out of scope. The aurora is **removed**: it wasn't data-driven, and no aurora is visible in polar day. |

**Cut order** if time runs short:

1. optional wind direction (use the labelled prevailing direction);
2. Sentinel-2 surface splat (fall back to slope- and altitude-based snow/rock);
3. fly-over path (keep the Antarctica view, and always use the crossfade);
4. polar-night stars and lit windows;
5. continent relief (flat ADD outline, extruded with a bevel).

**Never cut:** the 2D fallback, alert tokens, click and list accessibility, the schematic label,
the licence register, the budgets.

---

## 13. Concept renders (approval of visual direction)

Rendered with a throwaway prototype (three r128 in headless Chromium with SwiftShader, 1440×900).
Not production code; it isn't in the repo. Card placeholders show where the existing HUD sits.

| File | What it shows |
|---|---|
| [`concept-a-antarctica-flyover.png`](phase2-concepts/concept-a-antarctica-flyover.png) | Antarctica view: Natural Earth outline with a **placeholder** dome (production: REMA), graticule, Maitri selected (accent), Bharati neutral, dashed fly-over path, legend. |
| [`concept-b-bharati-larsemann.png`](phase2-concepts/concept-b-bharati-larsemann.png) | Bharati: rocky Larsemann knolls, sea and sea ice to the north, low sun. Container-block massing in a metal skin on columns with 4.9 m panel rhythm and inclined glazed ends. Kerosene tanks. A warning ring on the generator zone. |
| [`concept-c-maitri-schirmacher.png`](phase2-concepts/concept-c-maitri-schirmacher.png) | Maitri: twilight in the oasis, lake ice, tan U-shaped building on legs, container modules, fuel farm with a critical ring, a normal ring on one arm, faint katabatic drift. |

Known gaps in the concepts, all addressed by the plan: placeholder relief, untextured rock,
arbitrary outbuilding and lake positions, square snow points, and stepped coast walls from the
1:110m raster.

---

## 14. Sources

Stations:

- NCPOR — Maitri: https://www.ncpor.res.in/antarcticas/display/376-maitri-
- Wikipedia — Maitri (research station): https://en.wikipedia.org/wiki/Maitri_(research_station)
- Wikipedia — Bharati (research station): https://en.wikipedia.org/wiki/Bharati_(research_station)
  (cites the COMNAP Antarctic Station Catalogue, 2017)
- Lonely Planet — Maitri Station ("long, U-shaped, tan-coloured building… on adjustable
  telescopic legs", seen in a search-result excerpt; the page body didn't render for us):
  https://www.lonelyplanet.com/points-of-interest/maitri-station/1568042
- bof architekten — Bharati: https://www.bof-architekten.de/projekte/sonderbauten/bharati.html
- DBZ — "Fassadenbau unter Extrembedingungen: Bharati Forschungsstation":
  https://www.dbz.de/artikel/dbz_Fassadenbau_unter_Extrembedingungen_Bharati_Forschungsstation_in_der-1475520.html
- e-architect — Bharati Research Station: https://www.e-architect.com/antarctica/bharati-research-station
- New Atlas — Bharathi research base: https://newatlas.com/bharathi-research-base/28498/
- Bharati Comprehensive Environmental Evaluation (NCAOR), as listed by the Antarctic Treaty
  Secretariat library: https://atslib.omeka.net/items/show/7087
- Maitri-II Global Design Competition notice (2024):
  https://cgisydney.gov.in/public_files/assets/pdf/Maitri-II_Global_Design_Competition_30_july_24.pdf

Data:

- Natural Earth: https://www.naturalearthdata.com/ (public domain)
- SCAR Antarctic Digital Database coastline (CC BY 4.0):
  https://data-search.nerc.ac.uk/geonetwork/srv/api/records/GB_NERC_BAS_PDC_01636
- REMA, Howat et al. 2019, https://doi.org/10.5194/tc-13-665-2019; PGC acknowledgement policy:
  https://www.pgc.umn.edu/guides/user-services/acknowledgement-policy/
- BedMachine Antarctica v3, Morlighem 2022, https://doi.org/10.5067/FPSU0V1MWUB6
  (https://nsidc.org/data/nsidc-0756/versions/3)

---

## 15. Demo-first build (2026-10-02) — what shipped, what is deferred

Built on `phase2-3d` in one pass, in the priority order of the brief. Checkpoint screenshots:
[`docs/phase2/checkpoint/`](phase2/checkpoint/); final: [`docs/phase2/final/`](phase2/final/).

**Shipped**

- **Two distinct station scenes** (`src/scene/stations/`): Bharati's container-block building in a
  chamfered aluminium skin on columns, 4.90 m panel rhythm, 15° inclined glazed ends, roof plant,
  kerosene tank farm, sea-water pump house and pipeline, mast, helipad at the Wikipedia heliport
  offset; rocky Larsemann knolls with September fast ice to the north. Maitri's tan U on telescopic
  legs with the flag on the entrance face, power module, containerised labs and camp, fuel farm,
  lake pump house; rocky Schirmacher Oasis with frozen lakes and the ice sheet rising to the south.
- **Procedural terrain + materials**: seeded noise heightfields (inner 900 m fine grid + 7 km
  outer grid), levelled pads, a terrain shader that splits rock and snow by slope and noise with
  sastrugi normals and sparse sun glints; generated canvas textures only (no image files).
- **Zones** (`station_config.json` → `scene.zones`, validated in Python): the 8 subsystems map to
  pickable zones with a physical description, source and confidence. Alerts: steady tint + ground
  ring in the v2 status tokens; selection in the accent; no pulse or blink.
- **Antarctica view + fly-over** (`continent.js`, `flyover.js`): extruded Natural Earth outline,
  graticule, both stations pinned at their coordinates; ≈ 4 s fly-over (rise → glide along the arc
  → descend), cancellable (pointer, wheel, Esc); 200 ms crossfade under reduced motion and on the
  low tier. Pins are DOM buttons; `onStationChange` → App's `handleStationChange`.
- **Data-driven atmosphere**: sun position and day/twilight/night from the replay clock
  (`solarPosition` in `lib/solar.js`); blowing snow from live wind speed (none < 15 km/h, haze toward
  ≈ 300 m visibility above 55 km/h), smoothed; direction from the **ERA5 10 m wind direction of the
  replay instant**, added to the telemetry replay clock as `replay.windFromDeg` (REANALYSIS; falls
  back to an "assumed" prevailing direction). Night: deep-blue sky, stars, a cool moonlight fill
  from behind the viewer, lit windows on the occupied buildings. Decorative snowfall is labelled as
  such in "About this view".
- **Accessibility**: Station / Antarctica toggle, Buildings list with the level as text, pin
  buttons, `A` / `[` / `]` / `Esc`, a polite live summary and a non-live environment description;
  axe 0 violations (station, list, about, Antarctica; desktop and phone).
- **Performance**: render on demand (30 fps cap when only snow moves), paused when hidden or
  off-screen, high/low tier with automatic downgrade; the other station and the continent are built
  in idle time.

**Budgets (measured on the production build)**: startup JS **488 kB** raw (< 500; nothing new on
the startup path); 3D chunk **600 kB** raw / 157 kB gzip (≤ 650); assets: none (all generated).

**Deferred (scope cuts for the demo)**

- three.js upgrade (stays on r128).
- REMA / SCAR ADD / Sentinel-2 pipelines and the licence register: terrain is procedural, the
  continent is a uniform extrusion of the Natural Earth outline.
- CSP unchanged; no Wasm decoders, no external assets.
- ~~Wind direction is linearly interpolated between ERA5 hours~~ — fixed: `weather_data.py`
  interpolates `wind_direction_10m` on the shortest arc (`interp_angle_deg`), so 350° → 10° passes
  through north, not south (tested both ways).
- Screenshots were rendered with SwiftShader; desktop shots may show the low tier after the
  automatic downgrade. Day/twilight/night and calm shots pin the scene's clock and wind through a
  development-only hook (`setDebugEnvironment`, reachable only in dev builds); the blizzard,
  alert and `live-like-*` shots use real telemetry (fault injection / the current replay time).

**Live verification (2026-10-02, after `update.sh`)** on a real GPU (headless Chromium, Metal),
against https://aurora-sih.centralindia.cloudapp.azure.com under the production CSP: high tier,
scene renders, canvas click and Buildings list open the building panel, the fly-over runs
(`docs/phase2/final/live-deployed-midflight.png`) and lands in Bharati, the Antarctica pin flies
back; no CSP violations, console errors or failed requests. Full e2e smoke against live: 13 passed,
2 skipped (state-changing tests are skipped on a remote deployment by design).
