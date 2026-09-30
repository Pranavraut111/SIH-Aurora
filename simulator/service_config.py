"""
Aurora — shared network/security settings for the Python services
(unified_backend.py, simulator.py).

All values come from environment variables so nothing is hardcoded:
  ALLOWED_ORIGINS  comma-separated list of browser origins allowed by CORS
                   (default: http://localhost:5173). "*" is rejected.
  HOST             interface to bind to (default: 127.0.0.1; Docker sets 0.0.0.0)
"""

import logging
import os

log = logging.getLogger("aurora.config")

DEFAULT_ALLOWED_ORIGINS = "http://localhost:5173"
DEFAULT_HOST = "127.0.0.1"


def get_allowed_origins() -> list:
    """Parse ALLOWED_ORIGINS. Wildcards are dropped: we never allow '*'."""
    raw = os.environ.get("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    if "*" in origins:
        log.warning("ALLOWED_ORIGINS contains '*'; wildcard origins are not allowed and were ignored")
        origins = [o for o in origins if o != "*"]
    if not origins:
        log.warning("ALLOWED_ORIGINS is empty; falling back to %s", DEFAULT_ALLOWED_ORIGINS)
        origins = [DEFAULT_ALLOWED_ORIGINS]
    return origins


def get_host() -> str:
    return os.environ.get("HOST", DEFAULT_HOST)


ALLOWED_ORIGINS = get_allowed_origins()
HOST = get_host()
