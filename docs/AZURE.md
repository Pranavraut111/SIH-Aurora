# Aurora on the Azure VM

The public demo runs on one Azure VM. This page is the runbook for it; the generic,
provider-neutral guide is [DEPLOYMENT.md](DEPLOYMENT.md). No secrets live in this file or
in the repository — they are only in `/opt/aurora/.env` on the server.

| | |
|---|---|
| URL | https://aurora-sih.centralindia.cloudapp.azure.com |
| SSH | `azureuser@aurora-sih.centralindia.cloudapp.azure.com` |
| VM | Ubuntu 24.04, Standard_B2als_v2 (2 vCPU, 4 GB RAM, x64), Central India |
| App | `/opt/aurora` (a clone of this repo, `main`) |
| Config | `/opt/aurora/.env` — `chmod 600`, owner `azureuser`, never committed |
| Backups | `/opt/aurora/backups`, nightly at 02:30 IST, 7 days kept |

## How it is put together

```
Internet ──► Azure NSG ──► ufw (22, 80, 443 only)
                                │
                     caddy :80/:443  (Let's Encrypt, HTTP→HTTPS, HSTS)
                                │  internal Docker network "aurora"
                     frontend (nginx: UI, /api + /ws proxy, rate limits, CSP)
                                │
                     backend :8080 ◄── simulator :8001     (never published)
                                │
                     volume aurora-data (SQLite, WAL)
```

The stack is `docker-compose.yml` + `docker-compose.prod.yml` (published GHCR images, no
build on the VM) + `docker-compose.https.yml` (Caddy). `.env` sets
`COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.https.yml`, so in
`/opt/aurora` a plain `docker compose …` always means those three files.

Server setup that is not in the repo: timezone `Asia/Kolkata`, unattended-upgrades, a
2 GB `/swapfile` (`vm.swappiness=10`), ufw, fail2ban (`/etc/fail2ban/jail.d/sshd.local`:
5 failures in 10 min → 1 h ban), Docker Engine + compose plugin from Docker's apt repo,
`/etc/cron.d/aurora-backup` and `/etc/logrotate.d/aurora-backup`. Docker and every
container restart on boot (`restart: unless-stopped`).

**Chronos is off** (`WITH_ML=false`). The published images are built without the ML
extras, so the flag would do nothing with `docker-compose.prod.yml`. Turning it on means
building the ~2.5 GB simulator image on this VM and giving it a 3 GB memory limit, which
leaves about 1 GB for the OS, backend, nginx and Caddy on a 4 GB machine with
burstable CPU. The forecast panels fall back to the physics forward-run and say so.

## SSH in

```bash
ssh -i ~/.ssh/<your-key> azureuser@aurora-sih.centralindia.cloudapp.azure.com
cd /opt/aurora
```

On Windows, the same command works in PowerShell (OpenSSH ships with Windows 10+).
fail2ban bans an address for an hour after five failed logins in ten minutes; to lift a
ban from another session: `sudo fail2ban-client set sshd unbanip <ip>`.

## Status and logs

```bash
docker compose ps                         # backend, frontend, simulator "healthy"; caddy "Up"
docker compose logs -f                    # everything
docker compose logs -f backend            # one service
docker compose logs --tail=200 simulator
docker compose logs caddy | grep -i -E 'obtained|renew|error'    # certificate
curl -s https://aurora-sih.centralindia.cloudapp.azure.com/api/health | python3 -m json.tool
free -h; df -h /; docker stats --no-stream
```

Container logs rotate at 3 × 10 MB each (json-file driver, set in the compose files);
`backups/backup.log` rotates weekly (4 kept); journald uses Ubuntu's default cap.

## Update

```bash
/opt/aurora/update.sh
```

It runs `git pull`, pulls the images for `AURORA_TAG` (default `latest` = newest `main`),
recreates what changed, waits for the stack to report healthy and prunes old images. The
image digests before and after are appended to `/opt/aurora/deploy-history.log`. The
database volume is not touched. `update.sh` is a symlink to
[`deploy/azure/update.sh`](../deploy/azure/update.sh).

## Roll back

Every push to `main` publishes images tagged `sha-<7-char commit>`. Pin the last good
one and re-run the update:

```bash
cd /opt/aurora
git log --oneline -10                     # pick the last good commit, e.g. 05289c5
grep -q '^AURORA_TAG=' .env \
  && sed -i 's/^AURORA_TAG=.*/AURORA_TAG=sha-05289c5/' .env \
  || echo 'AURORA_TAG=sha-05289c5' >> .env
git checkout 05289c5 -- docker-compose.yml docker-compose.prod.yml docker-compose.https.yml docker/
docker compose up -d
docker compose ps
```

(Use `docker compose up -d`, not `update.sh`, while pinned to an old commit: `update.sh`
runs `git pull` first.) To return to `main`: delete the `AURORA_TAG` line,
`git checkout main -- .` and run `./update.sh`. If a release changed the database
schema, also restore the backup taken before it (below) — migrations only go forward.

## Back up

Nightly at 02:30 IST, cron runs [`deploy/azure/backup.sh`](../deploy/azure/backup.sh) as
`azureuser`. It uses SQLite's online backup API inside the backend container (WAL-safe
while the stack runs, per DEPLOYMENT.md), checks the copy with `PRAGMA integrity_check`,
saves `backups/aurora-YYYY-MM-DD-HHMM.db` (`chmod 600`) and deletes copies older than 7
days. Output goes to `backups/backup.log`.

```bash
/opt/aurora/deploy/azure/backup.sh        # take one now
ls -lh /opt/aurora/backups
tail /opt/aurora/backups/backup.log
```

To keep a copy off the VM (from your own machine):

```bash
scp -i ~/.ssh/<your-key> 'azureuser@aurora-sih.centralindia.cloudapp.azure.com:/opt/aurora/backups/aurora-*.db' .
```

## Restore a backup

The backups are readable only by `azureuser`, and the backend container runs as uid
10001, so the one-off restore container runs as root and hands the file back to the
`aurora` user. The stale `-wal`/`-shm` files **must** be removed with the old database,
or SQLite replays them into the restored file.

```bash
cd /opt/aurora
./deploy/azure/backup.sh                  # safety copy of the current state first
ls -1t backups/aurora-*.db                # pick one
B=aurora-2026-10-01-0230.db               # ← the file to restore

docker compose down
docker compose run --rm --no-deps --user 0 --entrypoint sh \
  -v /opt/aurora/backups:/backups:ro backend -c "
    rm -f /data/antarctic_observations.db-wal /data/antarctic_observations.db-shm
    cp /backups/$B /data/antarctic_observations.db
    chown aurora:aurora /data/antarctic_observations.db"
docker compose up -d
docker compose ps
```

The backend runs the migrations on the restored file at start-up, so an older backup is
fine.

## Stop the VM to save credit

Stopping from inside the OS (`sudo poweroff`) leaves the VM **allocated and billed**.
Deallocate it from the Azure portal (VM → **Stop**) or with the Azure CLI:

```bash
az vm deallocate --resource-group <resource-group> --name <vm-name>
az vm start      --resource-group <resource-group> --name <vm-name>
```

(The OS hostname is `aurora-vm`; `az vm list -o table` shows the Azure name and group.)

While deallocated you pay only for the OS disk (and a static public IP, if one is
attached). On start, Docker and the whole stack come back by themselves within about a
minute — tested with a reboot on 2026-10-01. If the public IP is dynamic it may change,
but the `aurora-sih.centralindia.cloudapp.azure.com` DNS label follows it, so the URL
and the certificate stay valid. Caddy renews the certificate itself; one that expired
while the VM was off is renewed on the next start.

## Secrets

`ADMIN_TOKEN` gates every write (`X-Admin-Token`); `GROQ_API_KEY` is optional. Both live
only in `/opt/aurora/.env`. Never paste them into chat, tickets, commits or command-line
arguments that land in shell history — the commands below read them from a hidden prompt
or generate them in place.

**Read the current ADMIN_TOKEN** (to log in as OPERATOR in the UI):

```bash
grep '^ADMIN_TOKEN=' /opt/aurora/.env | cut -d= -f2-
```

**Set or change GROQ_API_KEY**:

```bash
cd /opt/aurora
read -rsp 'GROQ_API_KEY: ' K; echo
(umask 077; K="$K" awk 'BEGIN{v=ENVIRON["K"]} /^GROQ_API_KEY=/{print "GROQ_API_KEY="v; d=1; next} {print} END{if(!d) print "GROQ_API_KEY="v}' .env > .env.tmp && mv .env.tmp .env)
unset K
docker compose up -d --force-recreate backend simulator
docker compose exec -T simulator python -c "import os; print('GROQ key loaded:', bool(os.environ.get('GROQ_API_KEY')))"
```

**Rotate ADMIN_TOKEN** (logs every operator out; the simulator picks up the new token
too):

```bash
cd /opt/aurora
(umask 077; T="$(openssl rand -hex 32)" awk 'BEGIN{v=ENVIRON["T"]} /^ADMIN_TOKEN=/{print "ADMIN_TOKEN="v; d=1; next} {print} END{if(!d) print "ADMIN_TOKEN="v}' .env > .env.tmp && mv .env.tmp .env)
docker compose up -d --force-recreate backend simulator
docker compose ps
```

Then read the new value as above and hand it on out of band. `ls -l .env` must still show
`-rw------- azureuser azureuser`.

## Add or remove a teammate's SSH key

`~/.ssh/authorized_keys` holds several people's keys — **append and delete single lines;
never overwrite the file**. Keep your current session open until you have confirmed a
fresh login still works.

Add (the teammate sends their **public** key, e.g. `id_ed25519.pub`; it is safe to share):

```bash
KEY='ssh-ed25519 AAAA... name@laptop'     # the whole line from their .pub file
grep -qxF "$KEY" ~/.ssh/authorized_keys || echo "$KEY" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Remove (match on the key's comment or a unique part of the key):

```bash
cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak
grep -n 'name@laptop' ~/.ssh/authorized_keys        # check exactly one line matches
grep -vF 'name@laptop' ~/.ssh/authorized_keys.bak > ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
wc -l ~/.ssh/authorized_keys.bak ~/.ssh/authorized_keys   # exactly one line fewer
```

The portal's **Help → Reset password → Reset SSH public key** also appends a key without
removing the others, which helps if everyone is locked out.

## Firewall

Two layers, and both must allow a port: the Azure network security group (portal → VM →
Networking) and ufw on the VM (`sudo ufw status`). Only 22, 80 and 443 (TCP, plus UDP 443
for HTTP/3) are open. The backend (8080) and simulator (8001) are never published to the
host. Docker-published ports bypass ufw, so do not add a `ports:` mapping to either.
