# ═══════════════════════════════════════════════════════════════
#  Aurora — unified backend (simulator/unified_backend.py, FastAPI on :8080)
#  The single public backend; the browser talks only to it (see CLAUDE.md).
#
#  Build:  docker build -f docker/backend.Dockerfile -t aurora-backend .
#  With the optional Chronos extras (CPU-only torch, much larger image):
#          docker build -f docker/backend.Dockerfile --build-arg WITH_ML=true ...
# ═══════════════════════════════════════════════════════════════
ARG PYTHON_VERSION=3.12

# ── Stage 1: build the wheels ─────────────────────────────────
# Compilers and headers stay here and never reach the runtime image.
FROM python:${PYTHON_VERSION}-slim AS builder

ARG WITH_ML=false

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /wheels
COPY simulator/requirements.txt simulator/requirements-ml.txt ./

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --upgrade pip && pip install -r requirements.txt

# CPU-only torch: the default index would pull the CUDA build (~2.5 GB of libs this
# stack never uses). The CPU wheel index has no aarch64 wheels, so on ARM we fall
# back to PyPI, which ships CPU-only wheels there anyway.
RUN if [ "$WITH_ML" = "true" ]; then \
      pip install --index-url https://download.pytorch.org/whl/cpu \
                  --extra-index-url https://pypi.org/simple \
                  -r requirements-ml.txt ; \
    fi

# ── Stage 2: runtime ──────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim AS runtime

LABEL org.opencontainers.image.title="Aurora unified backend" \
      org.opencontainers.image.description="FastAPI backend for the Aurora Antarctic digital twin (SIH PS 26060)" \
      org.opencontainers.image.source="https://github.com/Saeesh-Vele/SIH2026A" \
      org.opencontainers.image.licenses="MIT"

# curl is only for the HEALTHCHECK below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --shell /usr/sbin/nologin --uid 10001 aurora

COPY --from=builder /opt/venv /opt/venv

# HOST=0.0.0.0: containers must listen on all interfaces; compose decides what is
# published. DB_PATH lives on the aurora-data volume, which the entrypoint seeds on
# first start. HF_HOME is writable and shared, so the Chronos cache survives restarts.
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    API_PORT=8080 \
    DB_PATH=/data/antarctic_observations.db \
    HF_HOME=/hf-cache

WORKDIR /app

# Runtime code only: simulator/*.py plus the committed demo data, model artefacts and
# ERA5 caches that make the stack work with no internet. Tests, docs, node_modules and
# the Vite app are excluded by .dockerignore.
COPY --chown=aurora:aurora simulator/ /app/simulator/
COPY --chown=aurora:aurora docker/entrypoint.sh /usr/local/bin/aurora-entrypoint

# Pristine copies of the demo data, kept outside the volume mount points so the
# entrypoint can still seed them once a volume is mounted over the originals.
RUN mkdir -p /opt/aurora-seed \
 && cp /app/simulator/data_store/antarctic_observations.db /opt/aurora-seed/ \
 && cp -r /app/simulator/weather_cache /opt/aurora-seed/weather_cache \
 && chmod +x /usr/local/bin/aurora-entrypoint \
 && mkdir -p /data /hf-cache \
 && chown -R aurora:aurora /data /hf-cache /opt/aurora-seed

USER aurora
WORKDIR /app/simulator

EXPOSE 8080

# /api/health reports the DB, the simulator probe and per-station telemetry.
# start-period covers init_db() + migrations + the first physics tick.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["aurora-entrypoint"]
CMD ["python", "unified_backend.py"]
