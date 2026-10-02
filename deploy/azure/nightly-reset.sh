#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Aurora — nightly reset for unattended judging (03:00 IST).
#  Ends any running demo scenario, drops expired visitor sandboxes, and restores the
#  shared thresholds and logistics ledger to the recorded baseline
#  (simulator/judge_baseline.json), inside the backend container. One log line per run.
#
#  Install (once, as the deploy user; the VM clock is UTC, so 03:00 IST = 21:30 UTC):
#      ( crontab -l 2>/dev/null; echo '30 21 * * * /opt/aurora/deploy/azure/nightly-reset.sh' ) | crontab -
#  Log: /opt/aurora/logs/nightly-reset.log
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
cd "$ROOT"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.prod.yml:docker-compose.https.yml}"
mkdir -p "$ROOT/logs"
LOG="$ROOT/logs/nightly-reset.log"
if out="$(docker compose exec -T backend python nightly_reset.py 2>&1)"; then
  echo "$(date -u +%FT%TZ) ok $(echo "$out" | tail -1)" >> "$LOG"
else
  echo "$(date -u +%FT%TZ) FAILED $(echo "$out" | tail -3 | tr '\n' ' ')" >> "$LOG"
  exit 1
fi
