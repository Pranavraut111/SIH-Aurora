# Deploying Aurora

Aurora runs as three containers — nginx (UI + reverse proxy), the unified backend, and
the internal simulator — on any Linux server, x86 (amd64) or ARM (arm64).

```
docker compose up -d
```

Only the frontend publishes a port. The backend and the simulator are reachable only on
the internal Docker network, which is the architecture the app assumes: the browser
talks to the backend through nginx and never to the simulator.

**Requirements**

| | Without Chronos | With Chronos (`WITH_ML=true`) |
|---|---|---|
| RAM | 2 GB | 4 GB+ |
| Disk | 3 GB | 6 GB |
| vCPU | 1 | 2 |

Docker Engine 24+ and Docker Compose v2.24+ (the HTTPS and prod overlays use the
`!reset` tag). No internet is needed at run time — see [Running offline](#running-offline).

---

## 1. A fresh Ubuntu 24.04 VM, start to finish

### Install Docker

Use Docker's own repository; the `docker.io` package in Ubuntu ships an old Compose.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Run docker without sudo (log out and back in afterwards)
sudo usermod -aG docker "$USER"

docker --version && docker compose version
```

### Get Aurora

Either pull the published images (recommended on a small VM — no Node toolchain, no
build, ~400 MB of pulls):

> The three packages are public, so `docker pull` needs no login. If you ever make them
> private, authenticate on the server with
> `echo "$TOKEN" | docker login ghcr.io -u <user> --password-stdin` using a token that has
> `read:packages`.

```bash
git clone https://github.com/Saeesh-Vele/SIH2026A.git aurora
cd aurora
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
```

…or build from source (needs ~2 GB of scratch space and a few minutes):

```bash
git clone https://github.com/Saeesh-Vele/SIH2026A.git aurora
cd aurora
cp .env.example .env
```

### Configure `.env`

`.env.example` documents every variable. **Three are required for a public deployment**,
and with `APP_ENV=production` the backend refuses to start without them:

```bash
# .env — the minimum for a public host
APP_ENV=production
ALLOWED_ORIGINS=http://203.0.113.10          # or https://aurora.example.org
ADMIN_TOKEN=$(openssl rand -hex 32)          # paste the generated value
```

Generate the token with `openssl rand -hex 32` and keep it out of version control — `.env`
is gitignored.

| Variable | Required? | What it does |
|---|---|---|
| `APP_ENV` | **yes for production** | `production` turns the startup warnings below into a refusal to start. Default `development`. |
| `ALLOWED_ORIGINS` | **yes** unless you browse via localhost | Origins allowed by CORS *and* by the `/ws/station` WebSocket check. Set it to exactly how people reach the UI: `http://203.0.113.10`, or `https://aurora.example.org`. Comma-separate several. |
| `ADMIN_TOKEN` | **yes for a public host** | Required by every state-changing endpoint as `X-Admin-Token`. Without it anyone who can load the page can change thresholds, edit the inventory ledger and drive the simulator. |
| `GROQ_API_KEY` | optional | Enables LLM-written explanations. Without it the AI panels use the offline explainer and say so. |
| `GROQ_MAX_CALLS_PER_HOUR` | no (60) | Hard cap on outbound Groq calls per rolling hour. Past it the explain endpoints serve the offline summary. |
| `HTTP_PORT` | no (80) | Host port for the UI. |
| `WITH_ML` | no (`false`) | Build the simulator with torch + Chronos. Also raise `SIMULATOR_MEMORY_LIMIT` to `3g`. |
| `SIMULATOR_MEMORY_LIMIT` | no (`768M`) | Memory ceiling for the simulator container. |
| `DOMAIN`, `ACME_EMAIL` | only for HTTPS | Hostname Caddy gets a certificate for, and the ACME contact address. |
| `AURORA_MODE`, `AURORA_SPEED`, `AURORA_DATE` | no | Replay mode, speed (simulated seconds per real second) and ERA5 start date. |
| `TICK_INTERVAL_S`, `ALERT_RESOLVE_TICKS`, `SIM_BATCH_FRESH_S` | no | Tick cadence, alert hysteresis, telemetry freshness window. |

`HOST`, `API_PORT`, `SIM_PORT`, `BACKEND_URL`, `SIMULATOR_URL` and `DB_PATH` are
overridden per service in `docker-compose.yml`, so whatever `.env` says for those is
ignored inside the containers.

### Start

```bash
# From source:
docker compose up -d

# Or from the published images:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

docker compose ps          # wait until all three say "healthy"
```

First start seeds the `aurora-data` volume from the committed demo database and the
`aurora-weather-cache` volume from the repository's ERA5 caches, then the backend runs
the schema migrations. Expect 30–60 seconds before everything is healthy.

Open `http://<server-ip>/`.

### Open the firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp     # only if you add the HTTPS overlay
sudo ufw enable
```

Most cloud providers have a **second** firewall in front of the VM — see
[Provider notes](#provider-notes).

---

## 2. Add a domain and HTTPS

Point an `A` record (and `AAAA` if you have IPv6) at the server, wait for it to resolve,
then:

```bash
# .env
DOMAIN=aurora.example.org
ACME_EMAIL=you@example.org
ALLOWED_ORIGINS=https://aurora.example.org
```

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d
```

Caddy obtains and renews the certificate itself, redirects HTTP to HTTPS, sets HSTS and
proxies the WebSocket. Port 80 must stay open — Let's Encrypt's HTTP-01 challenge uses
it. With the published images, add `-f docker-compose.prod.yml` as well.

While testing, uncomment `acme_ca` in `docker/Caddyfile` to use Let's Encrypt's staging
CA, so a mistake does not consume the production rate limit.

---

## 3. Everyday operations

### Logs

```bash
docker compose logs -f                   # everything
docker compose logs -f backend           # one service
docker compose logs --tail=200 simulator
```

Logs rotate at 3 × 10 MB per container.

### Update to a new version

With published images:

```bash
cd aurora
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker image prune -f
```

From source:

```bash
git pull
docker compose up --build -d
```

The volumes are not touched, so the database and the acknowledged alerts carry over.
Pin a version instead of tracking `main` with `AURORA_TAG=v1.2.3` in `.env`.

### Back up and restore the database

The SQLite database lives in the `aurora-data` volume. Back it up with SQLite's own
`.backup`, which is safe while the stack is running (plain `cp` of a WAL database can
capture a torn state):

```bash
mkdir -p backups
docker compose exec -T backend \
  python -c "
import sqlite3
src = sqlite3.connect('/data/antarctic_observations.db')
dst = sqlite3.connect('/tmp/backup.db')
src.backup(dst); dst.close(); src.close()
"
docker compose cp backend:/tmp/backup.db "backups/aurora-$(date +%F-%H%M).db"
```

Restore. The database runs in WAL mode, so the stale `-wal` and `-shm` files from the
old database **must** go with it — SQLite would otherwise try to replay that write-ahead
log into the restored file:

```bash
docker compose down
docker compose run --rm --no-deps -v "$PWD/backups:/backups" backend sh -c '
  rm -f /data/antarctic_observations.db-wal /data/antarctic_observations.db-shm
  cp /backups/aurora-2026-10-01-1200.db /data/antarctic_observations.db
'
docker compose up -d
```

The backup above is written with SQLite's `.backup`, which produces a self-contained file
with no WAL to carry over. The backend runs the migrations on the restored file at
startup, so a backup from an older version is fine.

To start completely fresh (this **deletes** the data):

```bash
docker compose down -v
docker compose up -d        # re-seeds from the committed demo database
```

### Enable Chronos (optional ML)

```bash
# .env
WITH_ML=true
SIMULATOR_MEMORY_LIMIT=3g
```

```bash
docker compose build simulator
docker compose up -d
curl -s http://localhost/api/health | grep -o '"chronos":{[^}]*}'
```

The weights (~190 MB) download on first use into the `hf-cache` volume, so this one step
does need internet. Without it Chronos reports `available: false` and the forecast panels
fall back to the physics forward-run — honestly labelled. The published images do **not**
include the extras, so this needs a local build.

---

## What a public deployment is protected against

This is demo-grade hardening: enough to put the dashboard on the internet, not a
substitute for real authentication.

**Write protection.** With `ADMIN_TOKEN` set, every state-changing endpoint requires the
`X-Admin-Token` header and returns 401 without it — thresholds, logistics edits, alert
acknowledge, remote dispatch, simulator inject/reset/mode, NCPOR ingest, and telemetry
ingest. Reads and the WebSocket stay public, so anyone can view the whole dashboard. The
UI shows a **READ-ONLY** pill in the top bar; clicking it asks for the token and turns it
into **OPERATOR**. The token is kept in memory only, so a page refresh signs you out.

Two POSTs stay public because they change nothing: `/api/simulation/whatif` (read-only
against the published snapshot) and the explain routes. They are rate-limited instead.

**Rate limiting** (nginx, per client address):

| Scope | Limit |
|---|---|
| `/api/*` | 10 req/s, burst 20 |
| the AI explain routes | 5 req/min, burst 2 |
| concurrent connections | 64 |
| request body | 64 kB (`413` beyond) |

Exceeding a limit returns `429` with a JSON `detail` the UI displays; normal dashboard use
is nowhere near these numbers.

**Cost control.** `GROQ_MAX_CALLS_PER_HOUR` (default 60) caps outbound LLM calls for the
whole process. Past the cap nothing is sent upstream and the explain endpoints return the
deterministic offline summary, labelled as such.

**What is still missing.** There are no user accounts, no roles and no audit of *who*
signed in — one shared token gates all writes, and the operator name on an audit record is
self-declared. Treat `ADMIN_TOKEN` like a password: anyone holding it can change anything.

### Checking the protection on a live host

```bash
# Reads work with no token
curl -fsS http://localhost/api/health > /dev/null && echo "read ok"

# Writes are refused without it, and accepted with it
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "http://localhost/api/sim/reset?stationId=maitri"                    # expect 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  "http://localhost/api/sim/reset?stationId=maitri"                     # expect 200

# The rate limit trips, with a readable message
for i in $(seq 1 15); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' \
    -d '{"stationId":"maitri","question":"status"}' http://localhost/api/aurora-explain
done; echo                                                             # expect 429s
```

## Running offline

The stack is designed to work on a server with no route to the internet. Open-Meteo,
the NCPOR page, Groq and HuggingFace are all optional:

| Dependency | Without it |
|---|---|
| Open-Meteo (ERA5 + forecast) | Replays the ERA5 caches baked into the image; the forecast panel says the live forecast is unavailable. |
| NCPOR AWS page | `/api/ncpor/*` serves the newest rows already in the database and labels their real dataset. |
| Groq | AI panels use the offline explainer and report `llmAvailable: false`. |
| HuggingFace | Chronos reports `available: false`; forecasts come from the physics forward-run. |

Fonts are self-hosted and the CSP allows no third-party origin, so the UI itself makes
no external request at all.

To prove it on your own server:

```bash
docker compose -f docker-compose.yml -f docker-compose.offline.yml up -d
```

That overlay moves the Python services onto a Docker network with no external route
(nginx stays reachable). CI runs exactly this on every push and asserts that
`api.open-meteo.com`, `huggingface.co` and `api.groq.com` really are unreachable, that
telemetry still flows, and that the browser smoke test still passes.

---

## Provider notes

**Oracle Cloud Always Free (ARM / Ampere A1 — a good fit: 4 OCPU / 24 GB)**
Two firewalls must be opened, and forgetting the second is the usual reason a new VM
looks dead:
1. The VCN **security list** (or NSG): add ingress for TCP 80 and 443 from `0.0.0.0/0`.
2. The instance's own **iptables** — Oracle's Ubuntu images ship a default-DROP chain:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

**AWS EC2** — the instance's **security group** needs inbound TCP 80/443. `t4g` instances
are arm64 and use the same images.

**Azure** — the VM's **network security group** needs inbound rules for 80/443. `Bpsv2`
instances are arm64.

**DigitalOcean** — droplets have no firewall by default, so `ufw` is enough; if you
attached a Cloud Firewall, add 80/443 there too.

---

## Troubleshooting

**The UI loads but the data badge says "browser demo" / telemetry looks synthetic.**
The WebSocket was rejected. The backend enforces an Origin allow-list on
`/ws/station` (CORS middleware does not cover WebSockets), so `ALLOWED_ORIGINS` must
match the URL in your address bar exactly — scheme included.

```bash
docker compose logs backend | grep "WS rejected"
# WS rejected: disallowed origin http://203.0.113.10
```

Set `ALLOWED_ORIGINS=http://203.0.113.10` in `.env` and `docker compose up -d`.

**A container never becomes healthy.**

```bash
docker compose ps
docker compose logs --tail=100 backend
```
The backend's health check allows 40 s for `init_db()`, the migrations and the first
physics tick. If it reports `"db": {"ok": false}`, the `aurora-data` volume is not
writable — `docker compose down -v` and up again re-creates it.

**`port is already allocated`.** Something else owns port 80. Set `HTTP_PORT=8088` in
`.env`, or stop the other service (`sudo ss -ltnp | grep ':80'`).

**Caddy cannot get a certificate.** `DOMAIN` must resolve to this server's public IP and
port 80 must be reachable from the internet. Check with
`docker compose logs caddy | grep -i acme`, and use the staging CA while debugging.

**The build is killed on a small VM.** The frontend build needs ~2 GB of RAM. Use the
published images (`-f docker-compose.prod.yml`) instead of building.

**ARM: "no matching manifest".** The published images are multi-arch; make sure you are
not pinning a digest or an old tag built before arm64 support.

**`denied` or `unauthorized` when pulling from ghcr.io.** The packages have been made
private — `docker login ghcr.io` with a `read:packages` token, or build from source.

**The UI loads but every control is greyed out with "Operator login required".** That is
`ADMIN_TOKEN` working. Click the **READ-ONLY** pill in the top bar and enter the token.

**`429 Too many requests`.** The nginx rate limit. Normal use does not reach it; if a demo
genuinely needs more, raise the `rate=` values in `docker/nginx.conf` and rebuild the
frontend image.

**The backend exits immediately with "Refusing to start with APP_ENV=production".** It is
telling you which variable is still at a development value — set `ADMIN_TOKEN` and point
`ALLOWED_ORIGINS` at your real origin, or drop `APP_ENV` back to `development`.

**The simulator keeps restarting with WITH_ML=true.** It is being OOM-killed. Raise
`SIMULATOR_MEMORY_LIMIT` to `3g` and use a host with 4 GB+.

---

## Verifying a deployment

```bash
curl -s http://localhost/api/health | python3 -m json.tool
```

`db.ok` must be `true` and `simulator.reachable` must be `true`. Then check that the
internal services are *not* exposed — both of these must fail:

```bash
curl -m 3 http://localhost:8080/api/health    # backend: expect a connection error
curl -m 3 http://localhost:8001/health        # simulator: expect a connection error
```

Everything above runs automatically on every push; see the `Docker images` workflow in
[`.github/workflows/docker.yml`](../.github/workflows/docker.yml).
