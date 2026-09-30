"""
Aurora — unit helpers (single place for wind-speed conversions).

Conventions (see CLAUDE.md "Units"):
- SQLite `observations.wind_speed` is stored in **m/s** for every dataset.
- The physics model (`StationPhysicsModel.compute`) takes `env_wind` in **km/h**,
  and telemetry `lab.env_wind` is reported in **km/h**.
- Open-Meteo cache files record units in `hourly_units`. Files without a recorded
  wind unit were fetched with Open-Meteo's default, which is km/h.
"""

KMH_PER_MS = 3.6
OPEN_METEO_DEFAULT_WIND_UNIT = "km/h"

# Factor that converts a value in <unit> to km/h.
_TO_KMH = {
    "km/h": 1.0,
    "kmh": 1.0,
    "m/s": KMH_PER_MS,
    "ms": KMH_PER_MS,
    "mp/h": 1.609344,
    "mph": 1.609344,
    "kn": 1.852,
    "kt": 1.852,
}


def _normalise(unit) -> str:
    return (unit or OPEN_METEO_DEFAULT_WIND_UNIT).strip().lower()


def wind_factor_to_kmh(unit) -> float:
    """Multiplier from <unit> to km/h. Missing unit → Open-Meteo default (km/h)."""
    key = _normalise(unit)
    if key not in _TO_KMH:
        raise ValueError(f"Unknown wind speed unit: {unit!r}")
    return _TO_KMH[key]


def wind_factor_to_ms(unit) -> float:
    """Multiplier from <unit> to m/s."""
    return wind_factor_to_kmh(unit) / KMH_PER_MS


def ms_to_kmh(value):
    return None if value is None else value * KMH_PER_MS


def kmh_to_ms(value):
    return None if value is None else value / KMH_PER_MS


def cache_wind_unit(cache: dict):
    """Wind unit recorded in an Open-Meteo cache dict (None if not recorded)."""
    return (cache.get("hourly_units") or {}).get("wind_speed_10m")
