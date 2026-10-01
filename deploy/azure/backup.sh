#!/usr/bin/env bash
# Aurora — nightly SQLite backup (docs/AZURE.md). Safe while the stack is running and safe
# to re-run: it uses SQLite's online backup API inside the backend container (a plain `cp`
# of a WAL database can capture a torn state — docs/DEPLOYMENT.md), checks the copy, and
# keeps the newest 7 days in /opt/aurora/backups.
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
cd "$ROOT"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.prod.yml:docker-compose.https.yml}"
BACKUP_DIR="$ROOT/backups"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date +%F-%H%M)"
OUT="$BACKUP_DIR/aurora-$STAMP.db"
TMP="/tmp/aurora-backup-$STAMP.db"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

docker compose exec -T backend python - "$TMP" <<'PY'
import sqlite3, sys
src = sqlite3.connect('/data/antarctic_observations.db')
dst = sqlite3.connect(sys.argv[1])
src.backup(dst)
dst.close()
src.close()
PY
docker compose cp "backend:$TMP" "$OUT.partial"
docker compose exec -T backend rm -f "$TMP"

if [ "$(sqlite3 "$OUT.partial" 'PRAGMA integrity_check;')" != "ok" ]; then
  echo "$(date -Is) backup FAILED integrity check: $OUT.partial kept for inspection" >&2
  exit 1
fi
mv "$OUT.partial" "$OUT"
chmod 600 "$OUT"

# Keep the newest KEEP_DAYS days of backups.
find "$BACKUP_DIR" -maxdepth 1 -name 'aurora-*.db' -mtime +"$((KEEP_DAYS - 1))" -print -delete

echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
