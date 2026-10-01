# Aurora — developer entry points. `make help` lists them.
# Ports, hosts and keys come from the root .env (see .env.example); nothing here
# hardcodes them.

PYTHON ?= python3
VENV   := .venv
PY     := $(VENV)/bin/python
PIP    := $(VENV)/bin/pip

.DEFAULT_GOAL := help
.PHONY: help setup setup-ml dev test test-py test-js test-ml test-slow coverage \
        lint lint-py lint-js format-check build e2e clean

help:  ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup:  ## Create .venv, install Python + Node deps, install Playwright chromium
	$(PYTHON) -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r simulator/requirements.txt -r requirements-dev.txt
	npm install
	npx playwright install chromium
	@echo "Next: cp .env.example .env  (then: make dev)"

setup-ml:  ## Add the optional Chronos extras (torch + chronos-forecasting)
	$(PIP) install -r simulator/requirements-ml.txt

dev:  ## Start backend -> simulator -> Vite (Ctrl-C stops all three)
	./start.sh

test: test-py test-js  ## Run the default Python and frontend suites

test-py:  ## pytest from the repo root (skips ml and slow; no network)
	$(PY) -m pytest

test-js:  ## Vitest (jsdom)
	npm test

test-ml:  ## The Chronos inference tests (needs `make setup-ml`)
	$(PY) -m pytest -m ml

test-slow:  ## The ERA5 walk-forward validation
	$(PY) -m pytest -m slow

coverage:  ## pytest with the simulator/ coverage report
	$(PY) -m pytest --cov --cov-report=term-missing:skip-covered

lint: lint-py lint-js  ## ruff + oxlint

lint-py:  ## ruff check (must exit 0)
	$(PY) -m ruff check .

lint-js:  ## oxlint (warnings only; errors fail)
	npm run lint

format-check:  ## Inspect `ruff format` (NOT enforced: it would reflow ~43 files)
	$(PY) -m ruff format --check .

build:  ## Production frontend build
	npm run build

e2e:  ## Playwright smoke test (starts the whole stack itself)
	npm run test:e2e

clean:  ## Remove caches and test artefacts (keeps .venv and node_modules)
	rm -rf .pytest_cache .ruff_cache .coverage coverage.xml htmlcov coverage \
	       test-results playwright-report dist
	find . -name __pycache__ -type d -not -path './node_modules/*' -not -path './.venv/*' -exec rm -rf {} +
