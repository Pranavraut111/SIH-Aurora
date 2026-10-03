#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Aurora — nightly reset for unattended judging (03:00 IST).
#  Ends any running demo scenario, drops expired visitor sandboxes, and restores the
#  shared thresholds and logistics ledger to the recorded baseline
#  (simulator/judge_baseline.json), inside the backend container. One log line per run.
#
#  Install (once; the VM's clock is Asia/Kolkata, see `timedatectl`, so 03:00 means IST,
#  half an hour after the 02:30 backup):
#      echo '0 3 * * * azureuser /opt/aurora/deploy/azure/nightly-reset.sh' | sudo tee /etc/cron.d/aurora-nightly-reset
#  Run it by hand: /opt/aurora/deploy/azure/nightly-reset.sh && tail -1 /opt/aurora/logs/nightly-reset.log
#  Log: /opt/aurora/logs/nightly-reset.log (one line per run)
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
cd "$ROOT"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.prod.yml:docker-compose.https.yml}"
mkdir -p "$ROOT/logs"
LOG="$ROOT/logs/nightly-reset.log"
if out="$(docker compose exec -T backend python nightly_reset.py 2>&1)"; then
  echo "$(date -Is) ok $(echo "$out" | tail -1)" >> "$LOG"
else
  echo "$(date -Is) FAILED $(echo "$out" | tail -3 | tr '\n' ' ')" >> "$LOG"
  exit 1
fi
