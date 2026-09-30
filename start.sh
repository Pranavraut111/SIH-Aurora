#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Aurora — Start All Services
#  Launches Frontend + Backend + AI Service + Simulator
# ═══════════════════════════════════════════════════════════════

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║          Aurora — Antarctic Station Digital Twin          ║"
echo "║          Starting all services...                        ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Python executable selection
if [ -f "$ROOT_DIR/simulator/.venv/bin/python3" ]; then
  PYTHON_BIN="$ROOT_DIR/simulator/.venv/bin/python3"
else
  PYTHON_BIN="python3"
fi

# 1. Start Frontend (Vite)
echo -e "${CYAN}[1/4]${NC} Starting React frontend on :5173..."
cd "$ROOT_DIR" && npm run dev &
FRONTEND_PID=$!
sleep 2

# 2. Start Backend
if command -v mvn &>/dev/null && [ "$USE_SPRING" = "1" ]; then
  echo -e "${CYAN}[2/4]${NC} Starting Spring Boot backend on :8080..."
  cd "$ROOT_DIR/backend" && mvn spring-boot:run -q &
  BACKEND_PID=$!
  sleep 8
else
  echo -e "${CYAN}[2/4]${NC} Starting Unified Mission Control backend on :8080..."
  cd "$ROOT_DIR/simulator" && $PYTHON_BIN unified_backend.py &
  BACKEND_PID=$!
  sleep 3
fi

# 3. Start AI Service (FastAPI)
echo -e "${CYAN}[3/4]${NC} Starting AI service on :8000..."
cd "$ROOT_DIR/ai-service" && $PYTHON_BIN ai_service.py &
AI_PID=$!
sleep 2

# 4. Start Simulator (with Control API on :8001)
echo -e "${CYAN}[4/4]${NC} Starting sensor simulator on :8001..."
cd "$ROOT_DIR/simulator"
# Load environment variables (Groq API key, etc.)
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo "       Loaded .env (Groq API key configured)"
fi
$PYTHON_BIN simulator.py &
SIM_PID=$!

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  All services started!                                   ║${NC}"
echo -e "${GREEN}║                                                          ║${NC}"
echo -e "${GREEN}║  Frontend:      http://localhost:5173                     ║${NC}"
echo -e "${GREEN}║  Backend:       http://localhost:8080                     ║${NC}"
echo -e "${GREEN}║  AI Service:    http://localhost:8000                     ║${NC}"
echo -e "${GREEN}║  Simulator API: http://localhost:8001                     ║${NC}"
echo -e "${GREEN}║  H2 Console:    http://localhost:8080/h2-console          ║${NC}"
echo -e "${GREEN}║                                                          ║${NC}"
echo -e "${GREEN}║  Demo Control:  Click the 🎮 button in the app           ║${NC}"
echo -e "${GREEN}║  AI Panel:      Click the 'AI / Aurora' tab              ║${NC}"
echo -e "${GREEN}║                                                          ║${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop all services                       ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Trap Ctrl+C to kill all child processes
trap "echo 'Shutting down...'; kill $FRONTEND_PID $BACKEND_PID $AI_PID $SIM_PID 2>/dev/null; exit" SIGINT SIGTERM

# Wait for all background processes
wait
