# CLAUDE.md — Working rules for Aurora (SIH PS 26060)

## Source of truth
- `PROJECT_CONTEXT.md` is the audit of this codebase. Refer to its issue IDs
  (**B1–B24** = broken items, **P0-x / P1-x / P2-x / P3-x** = action plan) in
  plans, code comments where relevant, and commit messages.

## Architecture decision (binding)
- **`simulator/unified_backend.py` (FastAPI) is the single backend on :8080.**
  The frontend talks **only** to it (REST + `/ws/station`).
- `simulator/simulator.py` (:8001) is an **internal** service (physics tick loop,
  anomaly/forecast/decision/Chronos/Groq). The browser must not call it directly;
  expose what the UI needs through the unified backend.
- `legacy/backend/` (Java Spring Boot) and `legacy/ai-service/` are **legacy** (see `legacy/README.md`).
  Not started by scripts. Do not extend them.
- Telemetry: `simulator.py` POSTs `/api/sensors/batch`; the unified backend's background tick is the
  **only** code that advances physics state (`advance_fallback`). All GET/WS reads return the last
  published snapshot (`dataSource`: `simulator` | `physics-fallback`, plus `provenance`). Never call
  `StationPhysicsModel.compute()` from a request handler.
- Station ids are validated by one dependency (`station_param` / `require_station`): unknown → 404.
- **Station facts live in ONE file: `simulator/station_config.json`** (metadata with source/confidence,
  buildings, dependency graph, default alert thresholds for every sensor, remote-command catalogue).
  Python reads it via `simulator/station_config.py`; the frontend imports it via `src/data/stationConfig.js`;
  it is served at `GET /api/config/stations`. Never hardcode coordinates, names, graphs or thresholds elsewhere.
  Physics parameters stay in `physics_model.py`.
- **Alerts** come only from `simulator/alert_engine.py` (run by the tick): every sensor vs station_config
  defaults + `alert_threshold_overrides` (SQLite, set in System Admin). Alerts persist in `station_alerts`,
  are acknowledged by id (`POST /api/alerts/{id}/acknowledge` with `acknowledgedBy`), and auto-resolve after
  `ALERT_RESOLVE_TICKS` normal ticks. No client-side alert rules except the labelled browser demo mode.

## Units (one convention everywhere — simulator.py, physics_model.py, unified_backend.py, UI)
- `storage.store_fuel` = **kL**, `store_food` = **days** of food, `store_spares` = **items**.
  All three are model-derived (physics model running state). The logistics inventory table
  (`/api/logistics`) is a separate operator-entered ledger in its own units (L, rations, kits…).
- `commsMast.comms_bandwidth` = **Mbps**.
- Wind: SQLite `observations.wind_speed` and `/api/ncpor/*` are **m/s**; telemetry `lab.env_wind`
  and the physics model input are **km/h**. Convert only via `simulator/units.py`
  (`ms_to_kmh`, `kmh_to_ms`, `wind_factor_to_kmh(unit)`); read Open-Meteo units from `hourly_units`.
- Replay speed: `AURORA_SPEED` = simulated seconds per real second → `speed/60` simulated hours per real minute.
- DB changes go through `simulator/migrations/NNN_*.py` (run by `init_db()`, idempotent, recorded in `schema_migrations`).

## Running locally
- Python venv lives at the repo root: `python3 -m venv .venv && .venv/bin/pip install -r simulator/requirements.txt`
  (`.venv/` is gitignored). Then `npm install` and `./start.sh` (Windows: `start.ps1`), which starts
  backend → waits for `/api/health` → simulator → Vite, and stops all of them on Ctrl-C.
- **Firebase is disabled** (P0-6). It had public read/write rules and duplicated
  persistence. It only initialises with `VITE_ENABLE_FIREBASE=true` + config, and
  `database.rules.json` denies everything. Don't re-enable without adding auth + scoped rules.
- Services read `ALLOWED_ORIGINS` (never `*`) and `HOST` (default `127.0.0.1`) from env.

## Configuration
- **The root `.env` is the single source of configuration.** Copy `.env.example` → `.env`;
  it documents every variable. `simulator/.env` is a deprecated fallback only.
- Python: import from `simulator/config.py` — the ONLY place in `simulator/` that reads
  `os.environ` or contains `localhost`. All file paths resolve relative to that module.
  (In `simulator.py` the module is imported as `app_config`, because `config` is a loop variable there.)
- Frontend: import `API_URL` / `WS_URL` from `src/config.js` (the only file in
  `src/` with `localhost`), and make HTTP calls through `src/services/api.js`
  (`apiGet/apiPost`), which throws `ApiError` and never returns fake data. The browser
  never calls the simulator directly — simulator features are proxied by the backend
  (`/api/ai/*`, `/api/sim/*`, `/api/aurora-explain`).
- Python deps: `simulator/requirements.txt` (runtime, pinned), `simulator/requirements-ml.txt`
  (optional Chronos), `requirements-dev.txt` (pytest/httpx/ruff). `scikit-learn` must stay
  at 1.7.2 to match the pickled models.

## Honesty / provenance
- Never present fabricated or mock data as real.
- Every value shown in the UI carries provenance, one of:
  **REAL**, **REANALYSIS**, **MODEL-DERIVED**, **SIMULATED**, **HARDCODED-DEMO**.
- No "LSTM", "neural", "official NCPOR" etc. labels unless literally true.

## Code rules
- No hardcoded URLs, ports or secrets. Read them from env vars through a config
  module (frontend: `import.meta.env.VITE_*`; Python: `os.environ`).
- Never swallow errors silently (no bare `except: pass`, no empty `catch {}`).
  Log them.
- Keep changes scoped to the current task. **No new features during the cleanup sprint.**
- Do not overwrite model artefacts (`*.pkl`, `simulator/baseline_data.json`,
  `simulator/forecast_arena_results.md`) unless the task explicitly says so.
- Never commit `.env` files or secrets. Only `.env.example` (placeholders) is tracked.
- Setup: copy `.mcp.json.example` to `.mcp.json` and set `cwd` to your local repo path (`.mcp.json` is gitignored).

## After every change
1. Python tests: `cd simulator && python test_physics_invariants.py` (+ any pytest suites added later)
2. `npm run lint`
3. `npm run build`
4. Commit with a conventional commit message (`fix:`, `chore:`, `refactor:`, `docs:` …)
   and `git push`.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
