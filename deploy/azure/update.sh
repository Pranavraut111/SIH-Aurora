#!/usr/bin/env bash
# Aurora — pull the latest code and published images, then restart (docs/AZURE.md).
# Idempotent: with nothing new it changes nothing. The version comes from AURORA_TAG in
# .env (`latest` tracks main; set sha-<commit> to pin or roll back). Volumes are kept.
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
cd "$ROOT"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.prod.yml:docker-compose.https.yml}"
HISTORY="$ROOT/deploy-history.log"

record() {
  echo "== $(date -Is) $1 (git $(git rev-parse --short HEAD))" >> "$HISTORY"
  docker compose images --format json 2>/dev/null \
    | python3 -c 'import json,sys
for i in json.load(sys.stdin): print("  ", i.get("Repository"), i.get("Tag"), i.get("ID","")[:19])' >> "$HISTORY" || true
}

record "before update"
git pull --ff-only
docker compose pull
docker compose up -d --remove-orphans

echo "Waiting for the stack to report healthy..."
for _ in $(seq 1 60); do
  states="$(docker compose ps --format '{{.Service}}={{.State}}/{{.Health}}')"
  if ! grep -qvE '=running/(healthy|)$' <<<"$states"; then
    echo "$states"
    record "after update"
    docker image prune -f
    exit 0
  fi
  sleep 3
done
echo "Stack did not become healthy within 3 minutes:" >&2
docker compose ps >&2
exit 1
