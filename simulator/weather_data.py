"""
Aurora v3 — Real Antarctic Weather Data Layer
Downloads and caches ERA5 reanalysis data from Open-Meteo.
Provides replay of historical weather sequences for the digital twin.

Data provenance:
  - Source: Open-Meteo Historical Weather API
  - Dataset: ERA5 reanalysis (ECMWF)
  - Resolution: Hourly
  - Coverage: 1940–present
  - Type: REANALYSIS (not direct station sensor measurements)

Station coordinates: from station_config.json (single source of truth).
"""

import json
import logging
import time
from datetime import datetime, timedelta, timezone

import requests

import station_config
from config import WEATHER_CACHE_DIR as CACHE_DIR
from units import cache_wind_unit, wind_factor_to_kmh

log = logging.getLogger("aurora.weather")


def sim_hours_per_real_minute(speed_factor: float) -> float:
    """Replay speed: `speed_factor` simulated seconds per real second,
    i.e. speed_factor / 60 simulated hours per real minute (120x -> 2.0 h)."""
    return speed_factor / 60.0

# ── Station coordinates — from station_config.json (single source of truth) ──
STATION_COORDS = {sid: station_config.coords(sid) for sid in station_config.station_ids()}

CACHE_DIR.mkdir(exist_ok=True)

OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL   = "https://api.open-meteo.com/v1/forecast"


class WeatherDataLayer:
    """
    Downloads, caches, and replays real ERA5 reanalysis weather data.
    Never queries the API every tick — downloads once, replays from cache.
    """

    def __init__(self, station_id: str, mode="historical", date=None,
                 speed_factor=1.0):
        """
        Args:
            station_id: 'maitri' or 'bharati'
            mode: 'historical' (replay a date range) or 'forecast' (next 7 days)
            date: Start date for historical replay (YYYY-MM-DD string)
                  Defaults to 30 days ago if not specified.
            speed_factor: Acceleration factor (e.g., 6.0 = 6x speed)
        """
        self.station_id = station_id
        self.coords = STATION_COORDS[station_id]
        self.mode = mode
        self.speed_factor = speed_factor
        self.data = None       # Cached hourly data
        self.units = {}        # Open-Meteo hourly_units of the cached data
        self._wind_to_kmh = 1.0  # set from hourly_units when data loads
        self.start_time = None # Real wall-clock time when replay started
        self.data_start = None # The datetime of the first data point
        self._last_loop = 0    # How many times the replay window has wrapped

        if date:
            self.target_date = date
        else:
            # Default: 30 days ago (safe window for ERA5 availability)
            self.target_date = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")

    def fetch_and_cache(self):
        """Download weather data and save to local cache file."""
        start_date = self.target_date
        # Fetch 7 days for historical replay
        end_dt = datetime.strptime(start_date, "%Y-%m-%d") + timedelta(days=7)
        end_date = end_dt.strftime("%Y-%m-%d")

        cache_file = CACHE_DIR / f"{self.station_id}_{start_date}_{end_date}.json"

        if cache_file.exists():
            log.info(f"[{self.station_id}] Weather cache hit: {cache_file.name}")
            with open(cache_file) as f:
                cached = json.load(f)
            self.data = cached["hourly"]
            self.units = cached.get("hourly_units") or {}
            self._wind_to_kmh = wind_factor_to_kmh(cache_wind_unit(cached))
            self.data_start = datetime.strptime(
                self.data["time"][0], "%Y-%m-%dT%H:%M"
            )
            self.start_time = time.time()
            return True

        params = {
            "latitude": self.coords["lat"],
            "longitude": self.coords["lon"],
            "start_date": start_date,
            "end_date": end_date,
            "hourly": ",".join([
                "temperature_2m",
                "wind_speed_10m",
                "wind_direction_10m",
                "surface_pressure",
                "relative_humidity_2m",
                "shortwave_radiation",
            ]),
            # Explicit units: wind in m/s (converted to km/h for the physics model on read)
            "wind_speed_unit": "ms",
            "timezone": "auto",
        }

        log.info(f"[{self.station_id}] Downloading ERA5 weather: {start_date} → {end_date}...")
        try:
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=15)
            resp.raise_for_status()
            raw = resp.json()

            # Save with provenance metadata
            cached = {
                "provenance": {
                    "source": "Open-Meteo",
                    "dataset": "ERA5 reanalysis (ECMWF)",
                    "sourceType": "reanalysis",
                    "stationId": self.station_id,
                    "coordinates": self.coords,
                    "fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "dateRange": f"{start_date} to {end_date}",
                    "note": "ERA5 reanalysis values, NOT direct station sensor measurements",
                },
                "hourly": raw.get("hourly", {}),
                "hourly_units": raw.get("hourly_units", {}),
            }

            with open(cache_file, "w") as f:
                json.dump(cached, f, indent=2)

            self.data = cached["hourly"]
            self.units = cached.get("hourly_units") or {}
            self._wind_to_kmh = wind_factor_to_kmh(cache_wind_unit(cached))
            self.data_start = datetime.strptime(
                self.data["time"][0], "%Y-%m-%dT%H:%M"
            )
            self.start_time = time.time()

            n_points = len(self.data["time"])
            log.info(f"[{self.station_id}] Cached {n_points} hourly data points")
            return True

        except Exception as e:
            log.warning(f"[{self.station_id}] Weather fetch failed: {e}")
            return False

    @property
    def wind_to_kmh(self) -> float:
        """Multiplier converting the cached wind values to km/h (physics input unit)."""
        return self._wind_to_kmh

    def get_current_weather(self) -> dict:
        """
        Get the interpolated weather at the current replay time (wall clock ×
        speed_factor). Loops the cached window instead of freezing (B19).

        Returns dict with env_temp (°C), env_wind (km/h), env_pressure (hPa),
        env_humidity (%), wind_direction, solar_radiation, provenance metadata.
        """
        if self.data is None or self.start_time is None:
            return None

        wall_elapsed = time.time() - self.start_time
        sim_elapsed_hours = (wall_elapsed * self.speed_factor) / 3600.0
        weather = self.sample_at(sim_elapsed_hours)
        loop = weather["replay_loop"]
        if loop > self._last_loop:
            self._last_loop = loop
            log.info("[%s] Replay window %s → %s finished; looping to start (loop %d)",
                     self.station_id, self.data["time"][0], self.data["time"][-1], loop)
        return weather

    def span_hours(self) -> int:
        """Length of the cached window in hours (last index)."""
        return max(len(self.data["time"]) - 1, 1)

    def sample_at(self, sim_elapsed_hours: float) -> dict:
        """Pure: weather `sim_elapsed_hours` into the replay (looping). The live
        replay AND anomaly training/evaluation both use this, so they share the
        exact same interpolation and unit conversion (env_wind in km/h)."""
        max_index = len(self.data["time"]) - 1
        span = max(max_index, 1)
        loop = int(sim_elapsed_hours // span)
        index_f = sim_elapsed_hours - loop * span
        idx_lo = int(index_f)
        idx_hi = min(idx_lo + 1, max_index)
        frac = index_f - idx_lo

        def interp(key):
            vals = self.data.get(key, [])
            if not vals or idx_lo >= len(vals):
                return None
            lo = vals[idx_lo]
            hi = vals[idx_hi] if idx_hi < len(vals) else lo
            if lo is None or hi is None:
                return lo if lo is not None else hi
            return lo + (hi - lo) * frac

        temp = interp("temperature_2m")
        wind = interp("wind_speed_10m")
        if wind is not None:
            wind *= self._wind_to_kmh  # physics model expects km/h
        pressure = interp("surface_pressure")
        humidity = interp("relative_humidity_2m")
        wind_dir = interp("wind_direction_10m")
        solar = interp("shortwave_radiation")

        if self.data_start:
            sim_time = self.data_start + timedelta(hours=index_f)
        else:
            sim_time = datetime.now(timezone.utc)

        return {
            "env_temp": round(temp, 1) if temp is not None else None,
            "env_wind": round(wind, 1) if wind is not None else None,
            "env_pressure": round(pressure, 1) if pressure is not None else None,
            "env_humidity": round(humidity, 1) if humidity is not None else None,
            "wind_direction": round(wind_dir, 0) if wind_dir is not None else None,
            "solar_radiation": round(solar, 1) if solar is not None else None,
            "simulated_time": sim_time.strftime("%Y-%m-%dT%H:%M:%S"),
            "data_index": idx_lo,
            "data_total": len(self.data["time"]),
            "replay_loop": loop,
            "provenance": {
                "sourceType": "reanalysis",
                "source": "Open-Meteo",
                "dataset": "ERA5",
                "coordinates": self.coords,
            },
        }

    def get_replay_progress(self) -> dict:
        """Returns progress info for UI display."""
        if not self.data or not self.start_time:
            return {"progress": 0, "mode": self.mode}

        wall_elapsed = time.time() - self.start_time
        sim_elapsed_hours = (wall_elapsed * self.speed_factor) / 3600.0
        total_hours = len(self.data["time"])
        span = max(total_hours - 1, 1)
        loop = int(sim_elapsed_hours // span)
        within = sim_elapsed_hours - loop * span
        progress = within / span

        return {
            "mode": self.mode,
            "progress": round(progress, 3),
            "simulated_hours": round(within, 1),
            "total_hours": total_hours,
            "replay_loop": loop,
            "speed_factor": self.speed_factor,
            "date_range": f"{self.data['time'][0]} to {self.data['time'][-1]}",
        }
