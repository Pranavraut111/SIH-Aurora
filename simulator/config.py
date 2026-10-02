"""
Aurora — central configuration for the Python services (P1-1).

Single source of truth: the ROOT `.env` file (repo root), loaded with
python-dotenv. Real environment variables always win over `.env` values.
`simulator/.env` is NOT read any more; if it still exists, a startup warning
asks you to move its values (e.g. GROQ_API_KEY) to the root `.env`.

This is the ONLY module in simulator/ that may read os.environ.
All file paths are resolved relative to this file, never the cwd.
"""

import logging
import os
import re
from pathlib import Path

from dotenv import load_dotenv

# ── Paths (module-relative) ───────────────────────────────────
SIM_DIR = Path(__file__).resolve().parent
REPO_ROOT = SIM_DIR.parent

_ROOT_ENV = REPO_ROOT / ".env"
_LEGACY_ENV = SIM_DIR / ".env"

# The root .env is the only env file. (simulator/.env is ignored — see warning below.)
load_dotenv(_ROOT_ENV, override=False)
_legacy_env_present = _LEGACY_ENV.exists()


def _get(name: str, default=None):
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def _get_int(name: str, default: int) -> int:
    raw = _get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        logging.getLogger("aurora.config").warning("%s=%r is not an integer; using %s", name, raw, default)
        return default


def _get_float(name: str, default: float) -> float:
    raw = _get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        logging.getLogger("aurora.config").warning("%s=%r is not a number; using %s", name, raw, default)
        return default


def _resolve_path(raw, default: Path) -> Path:
    """Relative paths in env vars are resolved against simulator/, not the cwd."""
    if raw is None:
        return default
    p = Path(raw).expanduser()
    return p if p.is_absolute() else (SIM_DIR / p).resolve()


# ── Logging ───────────────────────────────────────────────────
LOG_LEVEL = (_get("LOG_LEVEL", "INFO") or "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("aurora.config")
if _legacy_env_present:
    log.warning(
        "%s exists but is no longer read. Move its variables (e.g. GROQ_API_KEY) to the root .env (%s) "
        "and delete it.", _LEGACY_ENV, _ROOT_ENV,
    )

# ── Network ───────────────────────────────────────────────────
HOST = _get("HOST", "127.0.0.1")               # Docker sets 0.0.0.0
API_PORT = _get_int("API_PORT", 8080)          # unified_backend.py
SIM_PORT = _get_int("SIM_PORT", 8001)          # simulator.py (internal)
BACKEND_URL = (_get("BACKEND_URL", f"http://localhost:{API_PORT}")).rstrip("/")
SIMULATOR_URL = (_get("SIMULATOR_URL", f"http://localhost:{SIM_PORT}")).rstrip("/")

DEFAULT_ALLOWED_ORIGINS = "http://localhost:5173"


def parse_allowed_origins(raw) -> list:
    """Comma-separated origins. Wildcards are dropped: we never allow '*'."""
    origins = [o.strip().rstrip("/") for o in (raw or DEFAULT_ALLOWED_ORIGINS).split(",") if o.strip()]
    if "*" in origins:
        log.warning("ALLOWED_ORIGINS contains '*'; wildcard origins are not allowed and were ignored")
        origins = [o for o in origins if o != "*"]
    if not origins:
        log.warning("ALLOWED_ORIGINS is empty; falling back to %s", DEFAULT_ALLOWED_ORIGINS)
        origins = [DEFAULT_ALLOWED_ORIGINS]
    return origins


ALLOWED_ORIGINS = parse_allowed_origins(_get("ALLOWED_ORIGINS"))

# ── Data files (module-relative) ──────────────────────────────
DATA_DIR = SIM_DIR / "data_store"
DB_PATH = _resolve_path(_get("DB_PATH"), DATA_DIR / "antarctic_observations.db")
WEATHER_CACHE_DIR = SIM_DIR / "weather_cache"
BASELINE_DATA_PATH = SIM_DIR / "baseline_data.json"
STATION_CONFIG_PATH = SIM_DIR / "station_config.json"   # single source of station facts
FORECAST_ARENA_REPORT_PATH = SIM_DIR / "forecast_arena_results.md"


def forecast_cache_path(station_id: str) -> Path:
    return WEATHER_CACHE_DIR / f"{station_id}_forecast.json"


def anomaly_model_path(station_id: str) -> Path:
    return SIM_DIR / f"anomaly_model_{station_id}.pkl"


# ── Simulation ────────────────────────────────────────────────
_CACHE_RE = re.compile(r"^(?P<station>[a-z]+)_(?P<start>\d{4}-\d{2}-\d{2})_(?P<end>\d{4}-\d{2}-\d{2})\.json$")


def latest_cached_weather_date(stations=("maitri", "bharati")):
    """Latest replay start date for which EVERY station has an ERA5 cache file,
    so startup never needs the network. None if no common date exists."""
    dates_by_station = {s: set() for s in stations}
    if WEATHER_CACHE_DIR.is_dir():
        for f in WEATHER_CACHE_DIR.iterdir():
            m = _CACHE_RE.match(f.name)
            if m and m.group("station") in dates_by_station:
                dates_by_station[m.group("station")].add(m.group("start"))
    common = set.intersection(*dates_by_station.values()) if dates_by_station else set()
    return max(common) if common else None


AURORA_MODE = _get("AURORA_MODE", "reanalysis")    # "reanalysis" | "simulation"
AURORA_SPEED = _get_float("AURORA_SPEED", 120.0)
_explicit_date = _get("AURORA_DATE")
AURORA_DATE = _explicit_date or latest_cached_weather_date()
AURORA_DATE_SOURCE = "env" if _explicit_date else ("weather_cache" if AURORA_DATE else "none")
if AURORA_DATE is None:
    log.warning("No common ERA5 cache found in %s; weather layer will try to download", WEATHER_CACHE_DIR)

# ── Unified backend runtime ───────────────────────────────────
APP_VERSION = "3.1.0"
# A simulator batch newer than this (seconds) makes the simulator the telemetry source.
SIM_BATCH_FRESH_S = _get_float("SIM_BATCH_FRESH_S", 10.0)
# Rolling in-memory history per sensor (points). 900 × 2 s ticks = 30 min, the window the
# UI charts and the 15-min rolling fuel-burn average need (served by GET /api/history).
HISTORY_MAX_POINTS = _get_int("HISTORY_MAX_POINTS", 900)
# Background tick interval (seconds). The tick is the ONLY code that advances physics state.
TICK_INTERVAL_S = _get_float("TICK_INTERVAL_S", 2.0)
# Simulated remote commands move queued → acknowledged (simulated) after this many seconds.
REMOTE_ACK_DELAY_S = _get_float("REMOTE_ACK_DELAY_S", 5.0)
# An alert auto-resolves after this many consecutive normal ticks (hysteresis; also the
# number of lower-level ticks before a critical alert de-escalates to warning).
ALERT_RESOLVE_TICKS = _get_int("ALERT_RESOLVE_TICKS", 3)

# ── LLM (Groq) — server-side only ─────────────────────────────
GROQ_API_KEY = _get("GROQ_API_KEY", "")
GROQ_MODEL = _get("GROQ_MODEL", "openai/gpt-oss-120b")
# Cap on outbound Groq calls per rolling hour, across the whole process. Past the cap the
# explain routes return the offline summary instead — honest, and it bounds the bill.
GROQ_MAX_CALLS_PER_HOUR = _get_int("GROQ_MAX_CALLS_PER_HOUR", 60)

# ── Write protection ─────────────────────────────────────────
# When set, every state-changing route requires `X-Admin-Token: <ADMIN_TOKEN>`.
# Reads and the WebSocket stay public, so a demo deployment is viewable by anyone while
# nobody can change thresholds, the inventory ledger or the simulator.
# Unset means no protection: fine locally, never on a public host (see APP_ENV below).
ADMIN_TOKEN = _get("ADMIN_TOKEN", "")

# ── Deployment mode ──────────────────────────────────────────
# "production" turns the soft warnings below into a refusal to start, so a public
# deployment cannot come up with localhost origins or no write protection.
APP_ENV = (_get("APP_ENV", "development") or "development").lower()


def production_config_errors() -> list[str]:
    """Settings that must not be left at their development values in production."""
    errors = []
    if not ADMIN_TOKEN:
        errors.append(
            "ADMIN_TOKEN is empty: every write endpoint would be open to the internet. "
            "Generate one with `openssl rand -hex 32` and set it in .env."
        )
    local = [o for o in ALLOWED_ORIGINS if "localhost" in o or "127.0.0.1" in o]
    if local:
        errors.append(
            f"ALLOWED_ORIGINS still contains development origins ({', '.join(local)}). "
            "Set it to the origin the browser actually uses, e.g. https://your.domain."
        )
    return errors


def check_production_config() -> None:
    """In production, refuse to start on a development-grade configuration. Outside
    production the same problems are logged as warnings so local dev is unaffected."""
    errors = production_config_errors()
    if not errors:
        if APP_ENV == "production":
            log.info("APP_ENV=production: configuration checks passed")
        return
    if APP_ENV == "production":
        raise SystemExit(
            "Refusing to start with APP_ENV=production:\n"
            + "\n".join(f"  - {e}" for e in errors)
            + "\n\nSee docs/DEPLOYMENT.md for the required variables."
        )
    for e in errors:
        log.warning("Insecure for a public deployment (APP_ENV=%s): %s", APP_ENV, e)


def summary() -> dict:
    """Non-secret view of the effective config (for startup logs)."""
    return {
        "HOST": HOST, "API_PORT": API_PORT, "SIM_PORT": SIM_PORT,
        "BACKEND_URL": BACKEND_URL, "SIMULATOR_URL": SIMULATOR_URL,
        "ALLOWED_ORIGINS": ALLOWED_ORIGINS, "DB_PATH": str(DB_PATH),
        "AURORA_MODE": AURORA_MODE, "AURORA_SPEED": AURORA_SPEED,
        "AURORA_DATE": AURORA_DATE, "AURORA_DATE_SOURCE": AURORA_DATE_SOURCE,
        "GROQ_API_KEY": "set" if GROQ_API_KEY else "not set", "GROQ_MODEL": GROQ_MODEL,
        "GROQ_MAX_CALLS_PER_HOUR": GROQ_MAX_CALLS_PER_HOUR,
        "APP_ENV": APP_ENV, "ADMIN_TOKEN": "set" if ADMIN_TOKEN else "not set",
        "LOG_LEVEL": LOG_LEVEL,
        "APP_VERSION": APP_VERSION, "SIM_BATCH_FRESH_S": SIM_BATCH_FRESH_S,
        "HISTORY_MAX_POINTS": HISTORY_MAX_POINTS, "TICK_INTERVAL_S": TICK_INTERVAL_S,
    }
