# legacy/ — frozen services (not part of the running system)

These two services were part of the original prototype. They are kept for
reference and history only. **`start.sh` / `start.ps1` do not start them**, and
the frontend does not talk to them. Do not extend them (see `CLAUDE.md`).

## Why they are legacy

The audit (`PROJECT_CONTEXT.md`, issues **B1/B2**) found two backends competing
for port 8080: the Java backend served the WebSocket + a few REST routes, while
the frontend's module panels only worked against the Python
`simulator/unified_backend.py`. Neither combination gave a working UI. The team
chose **`simulator/unified_backend.py` (FastAPI) as the single backend on :8080**.

| Legacy piece | What replaced it |
|---|---|
| `backend/` — Spring Boot: `/api/sensors/batch`, `/api/station/{id}/state`, `/api/health`, `/ws/station`, threshold alerts, H2 persistence | `simulator/unified_backend.py` (same routes; per-station WS via `?stationId=`; in-memory store + rolling history in `simulator/station_store.py`) |
| `ai-service/` — dependency-cascade alerts | `simulator/cascade.py` (logic ported unchanged; verified identical on all 6,561 alert combinations) |
| `ai-service/` — Holt smoothing "ChronosForecaster" + z-score verdicts | Not ported: it was misnamed (not Chronos) and is superseded by the simulator's physics-residual anomaly engine and the real Chronos-Bolt forecaster (`simulator/anomaly_engine.py`, `simulator/chronos_forecaster.py`) |
| Java per-sensor threshold table (`StationService.java`) | Not ported: tuned for random-walk nominals, it raised false warnings in physics mode (audit B15) |

Security hardening from the cleanup sprint (CORS allow-list via `ALLOWED_ORIGINS`,
bind address via `HOST`, H2 console disabled) is retained in both.

## How to run them (only if you really need to)

Both read `ALLOWED_ORIGINS` and `HOST` from the environment (see root `.env.example`).

### Java backend (`legacy/backend`)
Requires **JDK ≥ 21** and Maven 3.9+ (there is no `mvnw` wrapper).
```bash
cd legacy/backend
JAVA_HOME=/path/to/jdk-21-or-newer mvn spring-boot:run
```
It listens on **:8080**, the same port as the unified backend. Stop the
unified backend first; the two cannot run together.

### AI service (`legacy/ai-service`)
```bash
python3 -m venv .venv-legacy && source .venv-legacy/bin/activate
pip install -r legacy/ai-service/requirements.txt
python legacy/ai-service/ai_service.py        # :8000
```
The Java backend calls it at `aurora.ai-service.url` (default `http://localhost:8000`).
Nothing in the current system calls it.
