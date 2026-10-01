#!/bin/sh
# ═══════════════════════════════════════════════════════════════
#  Aurora — container entrypoint (shared by the backend and the simulator).
#
#  Seeds the two persistent volumes from the demo data baked into the image, then
#  execs the service. Both steps are idempotent and never overwrite live data:
#
#    /data                          SQLite DB. Seeded from the committed demo database
#                                   only when it does not exist yet. Schema migrations
#                                   are not run here — unified_backend.py calls
#                                   init_db() on startup, which applies
#                                   simulator/migrations/NNN_*.py idempotently and
#                                   records them in schema_migrations (see CLAUDE.md).
#    /app/simulator/weather_cache   ERA5 replay caches. Missing files are copied in, so
#                                   an image upgrade adds new caches while the
#                                   forecast files the services rewrite are left alone.
#
#  Set AURORA_SEED=false to skip seeding entirely (e.g. a volume you manage yourself).
# ═══════════════════════════════════════════════════════════════
set -eu

log() { printf '[entrypoint] %s\n' "$*"; }

SEED_DIR=/opt/aurora-seed
CACHE_DIR=/app/simulator/weather_cache

if [ "${AURORA_SEED:-true}" = "true" ]; then
  # ── SQLite database ─────────────────────────────────────────
  DB_TARGET="${DB_PATH:-/data/antarctic_observations.db}"
  DB_TARGET_DIR=$(dirname "$DB_TARGET")
  if [ ! -d "$DB_TARGET_DIR" ]; then
    mkdir -p "$DB_TARGET_DIR" 2>/dev/null \
      || log "WARNING: cannot create $DB_TARGET_DIR; the service will report an unhealthy DB"
  fi
  if [ -f "$DB_TARGET" ]; then
    log "database present at $DB_TARGET ($(wc -c <"$DB_TARGET") bytes); leaving it alone"
  elif [ -f "$SEED_DIR/antarctic_observations.db" ]; then
    if cp "$SEED_DIR/antarctic_observations.db" "$DB_TARGET" 2>/dev/null; then
      log "seeded $DB_TARGET from the committed demo database"
    else
      log "WARNING: could not seed $DB_TARGET (permissions?); init_db() will create an empty one"
    fi
  else
    log "no seed database in the image; init_db() will create the schema from scratch"
  fi

  # ── ERA5 weather caches ─────────────────────────────────────
  if [ -d "$SEED_DIR/weather_cache" ]; then
    mkdir -p "$CACHE_DIR" 2>/dev/null || true
    copied=0
    for f in "$SEED_DIR"/weather_cache/*; do
      [ -f "$f" ] || continue
      target="$CACHE_DIR/$(basename "$f")"
      if [ ! -e "$target" ] && cp "$f" "$target" 2>/dev/null; then
        copied=$((copied + 1))
      fi
    done
    log "weather cache: $copied file(s) seeded into $CACHE_DIR, $(find "$CACHE_DIR" -type f 2>/dev/null | wc -l | tr -d ' ') present"
  fi
else
  log "AURORA_SEED=false — skipping volume seeding"
fi

log "starting: $*"
exec "$@"
