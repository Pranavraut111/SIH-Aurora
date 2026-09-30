#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Aurora — start all services (macOS / Linux)
#    1. simulator/unified_backend.py  (single public backend, API_PORT, default 8080)
#    2. simulator/simulator.py        (internal control API, SIM_PORT, default 8001)
#    3. Vite dev server               (VITE_PORT, default 5173)
#
#  Ports/host come from simulator/config.py (root .env). Python comes from the
#  repo venv (.venv/) unless AURORA_PYTHON is set. Ctrl-C stops everything.
#  Windows: use start.ps1. Legacy Java/ai-service are NOT started (see legacy/).
#  Written for bash 3.2+ (macOS default).
# ═══════════════════════════════════════════════════════════════
set -eo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${AURORA_PYTHON:-$ROOT/.venv/bin/python}"
VITE_PORT="${VITE_PORT:-5173}"
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-60}"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
info() { printf "${CYAN}[start]${NC} %s\n" "$*"; }
fail() { printf "${RED}[start] ERROR:${NC} %s\n" "$*" >&2; exit 1; }

# ── Preflight ─────────────────────────────────────────────────
if [ ! -x "$PY" ]; then
  fail "Python venv not found at $PY
  Create it from the repo root:
    python3 -m venv .venv
    .venv/bin/pip install -r simulator/requirements.txt
  (optional Chronos extras: .venv/bin/pip install -r simulator/requirements-ml.txt)
  Or point AURORA_PYTHON at an existing interpreter."
fi
"$PY" -c "import fastapi, flask, dotenv, sklearn" 2>/dev/null \
  || fail "Python deps missing in $PY — run: $PY -m pip install -r simulator/requirements.txt"
command -v npm >/dev/null 2>&1 || fail "npm not found (install Node.js 18+)"
[ -d "$ROOT/node_modules" ] || fail "node_modules missing — run: npm install"
command -v curl >/dev/null 2>&1 || fail "curl not found (needed for the health check)"

# Single source of truth for ports/host: config.py (loads the root .env)
read -r API_PORT SIM_PORT BIND_HOST < <(cd "$ROOT/simulator" && "$PY" -c \
  'import config as c; print(c.API_PORT, c.SIM_PORT, c.HOST)' 2>/dev/null) \
  || fail "could not read ports from simulator/config.py"
HEALTH_HOST="$BIND_HOST"
[ "$HEALTH_HOST" = "0.0.0.0" ] && HEALTH_HOST="127.0.0.1"

port_owner() {  # prints "PID command" of the listener, empty if the port is free
  # NB: lsof exits 1 when nothing listens; `|| true` keeps set -e/pipefail from aborting.
  if command -v lsof >/dev/null 2>&1; then
    { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; } | awk 'NR==2{print $2" "$1}'
  elif (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; then
    echo "unknown-process"
  fi
  return 0
}
for p in "$API_PORT" "$SIM_PORT" "$VITE_PORT"; do
  owner="$(port_owner "$p")"
  [ -z "$owner" ] || fail "port $p is already in use (pid/cmd: $owner). Stop it or change the port in .env / VITE_PORT."
done

# ── Process management ────────────────────────────────────────
# Job control: every background job gets its own process group, so Ctrl-C only
# reaches this script, and cleanup can kill each service's whole tree.
set -m
PGIDS=""
cleanup() {
  trap - INT TERM EXIT
  printf "\n"; info "Stopping services..."
  for pg in $PGIDS; do kill -TERM -- "-$pg" 2>/dev/null || true; done
  sleep 1
  for pg in $PGIDS; do kill -KILL -- "-$pg" 2>/dev/null || true; done
  wait 2>/dev/null || true
  info "All services stopped."
}
trap cleanup INT TERM EXIT

start_service() {  # name, workdir, command...
  local name="$1" dir="$2"; shift 2
  (cd "$dir" && exec "$@") 2>&1 | sed -u "s/^/[$name] /" &
  local pgid
  pgid="$(ps -o pgid= -p $! | tr -d ' ')"
  PGIDS="$PGIDS $pgid"
  eval "${name}_PID=$!"
}

# ── Start ─────────────────────────────────────────────────────
info "1/3 unified backend on $BIND_HOST:$API_PORT"
start_service backend "$ROOT/simulator" "$PY" unified_backend.py

info "waiting for http://$HEALTH_HOST:$API_PORT/api/health (timeout ${HEALTH_TIMEOUT_S}s)..."
elapsed=0
until curl -fsS -m 2 "http://$HEALTH_HOST:$API_PORT/api/health" >/dev/null 2>&1; do
  kill -0 "$backend_PID" 2>/dev/null || fail "backend exited during startup (see [backend] log above)"
  [ "$elapsed" -ge "$HEALTH_TIMEOUT_S" ] && fail "backend not healthy after ${HEALTH_TIMEOUT_S}s"
  sleep 1; elapsed=$((elapsed + 1))
done
info "backend healthy"

info "2/3 simulator on $BIND_HOST:$SIM_PORT"
start_service simulator "$ROOT/simulator" "$PY" simulator.py

info "3/3 vite on :$VITE_PORT"
start_service vite "$ROOT" npm run dev -- --port "$VITE_PORT" --strictPort

printf "${GREEN}"
cat <<EOF
╔═══════════════════════════════════════════════════════════╗
  Aurora is starting
    Frontend:     http://localhost:$VITE_PORT
    Backend API:  http://$HEALTH_HOST:$API_PORT   (health: /api/health)
    Simulator:    http://$HEALTH_HOST:$SIM_PORT   (internal)
  Press Ctrl+C to stop all services
╚═══════════════════════════════════════════════════════════╝
EOF
printf "${NC}"

wait
