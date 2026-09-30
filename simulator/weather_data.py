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

Station coordinates:
  - Maitri:  70°45'S, 11°44'E  (Schirmacher Oasis)
  - Bharati: 69°24'S, 76°11'E  (Larsemann Hills)
"""

import os
import json
import time
import math
import requests
from datetime import datetime, timedelta
from pathlib import Path

# ── Station Coordinates (documented, real) ────────────────────
STATION_COORDS = {
    "maitri":  {"lat": -70.77, "lon": 11.73,  "alt_m": 117, "name": "Maitri",  "region": "Schirmacher Oasis"},
    "bharati": {"lat": -69.41, "lon": 76.19,  "alt_m": 50,  "name": "Bharati", "region": "Larsemann Hills"},
}

CACHE_DIR = Path(__file__).parent / "weather_cache"
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
        self.start_time = None # Real wall-clock time when replay started
        self.data_start = None # The datetime of the first data point

        if date:
            self.target_date = date
        else:
            # Default: 30 days ago (safe window for ERA5 availability)
            self.target_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")

    def fetch_and_cache(self):
        """Download weather data and save to local cache file."""
        start_date = self.target_date
        # Fetch 7 days for historical replay
        end_dt = datetime.strptime(start_date, "%Y-%m-%d") + timedelta(days=7)
        end_date = end_dt.strftime("%Y-%m-%d")

        cache_file = CACHE_DIR / f"{self.station_id}_{start_date}_{end_date}.json"

        if cache_file.exists():
            print(f"  [{self.station_id}] Weather cache hit: {cache_file.name}")
            with open(cache_file) as f:
                cached = json.load(f)
            self.data = cached["hourly"]
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
            "timezone": "auto",
        }

        print(f"  [{self.station_id}] Downloading ERA5 weather: {start_date} → {end_date}...")
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
                    "fetchedAt": datetime.utcnow().isoformat() + "Z",
                    "dateRange": f"{start_date} to {end_date}",
                    "note": "ERA5 reanalysis values, NOT direct station sensor measurements",
                },
                "hourly": raw.get("hourly", {}),
                "hourly_units": raw.get("hourly_units", {}),
            }

            with open(cache_file, "w") as f:
                json.dump(cached, f, indent=2)

            self.data = cached["hourly"]
            self.data_start = datetime.strptime(
                self.data["time"][0], "%Y-%m-%dT%H:%M"
            )
            self.start_time = time.time()

            n_points = len(self.data["time"])
            print(f"  [{self.station_id}] ✓ Cached {n_points} hourly data points")
            return True

        except Exception as e:
            print(f"  [{self.station_id}] ✗ Weather fetch failed: {e}")
            return False

    def get_current_weather(self) -> dict:
        """
        Get the interpolated weather at the current replay time.
        Uses linear interpolation between hourly data points.

        Returns dict with:
          env_temp, env_wind, env_pressure, env_humidity,
          wind_direction, solar_radiation,
          provenance metadata
        """
        if self.data is None or self.start_time is None:
            return None

        # How many simulated seconds have elapsed
        wall_elapsed = time.time() - self.start_time
        sim_elapsed_hours = (wall_elapsed * self.speed_factor) / 3600.0

        # Clamp to available data range
        max_index = len(self.data["time"]) - 1
        index_f = min(sim_elapsed_hours, max_index)
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
                return lo or hi
            return lo + (hi - lo) * frac

        temp = interp("temperature_2m")
        wind = interp("wind_speed_10m")
        pressure = interp("surface_pressure")
        humidity = interp("relative_humidity_2m")
        wind_dir = interp("wind_direction_10m")
        solar = interp("shortwave_radiation")

        # Current simulated time
        if self.data_start:
            sim_time = self.data_start + timedelta(hours=sim_elapsed_hours)
        else:
            sim_time = datetime.utcnow()

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
        progress = min(1.0, sim_elapsed_hours / total_hours)

        return {
            "mode": self.mode,
            "progress": round(progress, 3),
            "simulated_hours": round(sim_elapsed_hours, 1),
            "total_hours": total_hours,
            "speed_factor": self.speed_factor,
            "date_range": f"{self.data['time'][0]} to {self.data['time'][-1]}",
        }
