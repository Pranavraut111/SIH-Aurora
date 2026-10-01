# ═══════════════════════════════════════════════════════════════
#  Aurora — internal simulator (simulator/simulator.py, Flask control API on :8001)
#  Runs the physics tick loop and the anomaly/forecast/decision/Chronos engines and
#  POSTs telemetry to the backend. NOT public: the browser never calls it (CLAUDE.md).
#
#  Build:  docker build -f docker/simulator.Dockerfile -t aurora-simulator .
#          --build-arg WITH_ML=true  adds the optional Chronos extras (CPU-only torch).
# ═══════════════════════════════════════════════════════════════
ARG PYTHON_VERSION=3.12

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

# See backend.Dockerfile for why the CPU index is used with a PyPI fallback.
RUN if [ "$WITH_ML" = "true" ]; then \
      pip install --index-url https://download.pytorch.org/whl/cpu \
                  --extra-index-url https://pypi.org/simple \
                  -r requirements-ml.txt ; \
    fi

FROM python:${PYTHON_VERSION}-slim AS runtime

LABEL org.opencontainers.image.title="Aurora simulator" \
      org.opencontainers.image.description="Physics + AI simulator for the Aurora Antarctic digital twin (SIH PS 26060)" \
      org.opencontainers.image.source="https://github.com/Saeesh-Vele/SIH2026A" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --shell /usr/sbin/nologin --uid 10001 aurora

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    SIM_PORT=8001 \
    DB_PATH=/data/antarctic_observations.db \
    HF_HOME=/hf-cache

WORKDIR /app

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

EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${SIM_PORT}/health" >/dev/null || exit 1

ENTRYPOINT ["aurora-entrypoint"]
CMD ["python", "simulator.py"]
