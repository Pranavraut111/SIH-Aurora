"""
Aurora — station configuration loader (single source of truth).

Reads simulator/station_config.json once, validates it, and exposes helpers.
Every Python consumer (unified backend, cascade, decision engine, physics
metadata, weather/forecast coordinates, NCPOR ingestor, alert engine) reads
station facts from here. The frontend imports the same JSON at build time.

Metadata values are stored as {"value", "source", "confidence",
"needsNcporConfirmation"[, "note"]}; use meta_value() to get the plain value.
"""

import json
import logging
from functools import lru_cache

import config as app_config

log = logging.getLogger("aurora.station_config")

LEVELS = ("warning", "critical")
DIRECTIONS = ("low", "high")


class StationConfigError(ValueError):
    pass


def _validate(cfg: dict) -> None:
    stations = cfg.get("stations")
    if not isinstance(stations, dict) or not stations:
        raise StationConfigError("station_config.json: 'stations' must be a non-empty object")
    for sid, st in stations.items():
        ids = [b["id"] for b in st.get("buildings", [])]
        if len(ids) != len(set(ids)) or not ids:
            raise StationConfigError(f"{sid}: building ids must be unique and non-empty")
        for e in st.get("dependencyGraph", {}).get("edges", []):
            if e["source"] not in ids or e["target"] not in ids:
                raise StationConfigError(f"{sid}: edge {e} references an unknown building")
        for sensor, s in st.get("sensors", {}).items():
            if s["building"] not in ids:
                raise StationConfigError(f"{sid}: sensor {sensor} references unknown building {s['building']}")
            if not any(d in s for d in DIRECTIONS):
                raise StationConfigError(f"{sid}: sensor {sensor} has no thresholds")
            lo, hi = s["thresholdRange"]
            for d in DIRECTIONS:
                if d not in s:
                    continue
                w, c = s[d]["warning"], s[d]["critical"]
                if not (lo <= w <= hi and lo <= c <= hi):
                    raise StationConfigError(f"{sid}: {sensor}.{d} outside thresholdRange")
                if (d == "high" and not w < c) or (d == "low" and not w > c):
                    raise StationConfigError(f"{sid}: {sensor}.{d} warning/critical order is wrong")
        meta = st.get("metadata", {})
        for key in ("name", "fullName", "latitude", "longitude", "elevation_m", "commissionedYear"):
            if not isinstance(meta.get(key), dict) or "value" not in meta[key]:
                raise StationConfigError(f"{sid}: metadata.{key} must be a {{value, source, confidence}} object")


@lru_cache(maxsize=1)
def load() -> dict:
    with open(app_config.STATION_CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    _validate(cfg)
    log.debug("Loaded station config (%d stations) from %s", len(cfg["stations"]), app_config.STATION_CONFIG_PATH)
    return cfg


def station_ids() -> tuple:
    return tuple(load()["stations"].keys())


def station(sid: str) -> dict:
    return load()["stations"][sid]


def meta_value(sid: str, key: str):
    m = station(sid)["metadata"].get(key)
    return m.get("value") if isinstance(m, dict) else m


def metadata_values(sid: str) -> dict:
    """Plain {key: value} view of a station's metadata."""
    return {k: (v.get("value") if isinstance(v, dict) and "value" in v else v)
            for k, v in station(sid)["metadata"].items()}


def coords(sid: str) -> dict:
    return {"lat": meta_value(sid, "latitude"), "lon": meta_value(sid, "longitude"),
            "alt_m": meta_value(sid, "elevation_m"), "name": meta_value(sid, "name"),
            "region": meta_value(sid, "region")}


def buildings(sid: str) -> list:
    return station(sid)["buildings"]


def building_names(sid: str) -> dict:
    return {b["id"]: b["name"] for b in buildings(sid)}


def dependency_graph(sid: str) -> dict:
    """{building: {"dependents": [...], "depends_on": [...]}} built from the edge list."""
    graph = {b["id"]: {"dependents": [], "depends_on": []} for b in buildings(sid)}
    for e in station(sid)["dependencyGraph"]["edges"]:
        graph[e["source"]]["dependents"].append(e["target"])
        graph[e["target"]]["depends_on"].append(e["source"])
    return graph


def sensors(sid: str) -> dict:
    return station(sid)["sensors"]


def default_thresholds(sid: str) -> dict:
    """{sensor: {"low": {...}, "high": {...}}} with only the directions that exist."""
    return {name: {d: dict(s[d]) for d in DIRECTIONS if d in s} for name, s in sensors(sid).items()}


def decision_causal_graph() -> dict:
    return {k: v for k, v in load()["decisionCausalGraph"].items() if not k.startswith("_")}


def remote_command_catalog() -> dict:
    return {k: list(v) for k, v in load()["remoteCommands"].items() if not k.startswith("_")}
