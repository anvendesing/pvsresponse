# NovaERP — Deployment Guide

This guide covers deploying NovaERP to a fresh VPS that is reachable
**by IP only** (no domain yet). When you eventually attach a domain,
no application changes are required — only DNS and (optionally) TLS
in front of the existing nginx.

The reference deployment uses **Docker Compose** with three containers:

| Service   | What it is                                  | Port (host) | Port (internal) |
| --------- | ------------------------------------------- | ----------- | --------------- |
| `web`     | nginx serving the ERP SPA + reverse-proxying API | `80` (`WEB_PORT`) | `80` |
| `shop`    | nginx serving the Prakruthivanam storefront + API proxy | `8080` (`SHOP_PORT`) | `80` |
| `backend` | Fastify API + Prisma + SQLite (default)     | _not exposed_ | `4000` |

Each frontend only ever sees one origin (`http://VPS_IP/` for ERP,
`http://VPS_IP:8080/` for the shop). nginx in each container routes
`/v1/*` and `/health` to the backend over the docker-internal network,
so you never need to open the API port on the firewall.

---

## TL;DR

```bash
# On the VPS (Ubuntu / Debian):
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
git clone <your-repo-url> novaerp && cd novaerp
cp .env.deploy.example .env
# generate a JWT secret and paste into .env (JWT_SECRET=...)
openssl rand -hex 64
# start
sudo docker compose up -d --build
# (~60-90s on a 2-core box, then visit http://<VPS_IP>/ )
```

Default credentials are seeded by `prisma/seed.ts` on the first run.
Look for the admin / supervisor / warehouse / billing logins printed
in `docker compose logs backend`.

---

## 1. Provision the VPS

1. Create a Linux VPS (any provider: Hetzner, DigitalOcean, Vultr,
   Linode, AWS Lightsail). **2 vCPU + 2 GB RAM + 20 GB disk** is
   plenty for the first 50 concurrent users.
2. SSH in as root or a sudo user.
3. Open inbound firewall for **TCP 22** (SSH), **TCP 80** (ERP), and
   **TCP 8080** (Prakruthivanam shop, or whatever you set as
   `SHOP_PORT`). Nothing else needs to be public.
   - On `ufw`: `sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 8080 && sudo ufw enable`
   - On the cloud provider's panel: same idea.

## 2. Install Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
# Docker official install (Debian / Ubuntu)
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
# Optional: let your sudo user run docker without sudo
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

## 3. Get the code onto the VPS

```bash
git clone <your-repo-url> novaerp
cd novaerp
```

## 4. Configure environment

```bash
cp .env.deploy.example .env
# edit .env — at minimum set JWT_SECRET to a long random string.
openssl rand -hex 64    # paste the output as JWT_SECRET
```

The only knobs you typically touch:

| Variable | Default | When to change |
| --- | --- | --- |
| `JWT_SECRET` | _(must set)_ | Always. Long random string. |
| `WEB_PORT` | `80` | If port 80 is already taken on the host. |
| `SHOP_PORT` | `8080` | Host port for the Prakruthivanam ecommerce storefront. |
| `DATABASE_URL` | `file:/data/dev.db` (SQLite on the docker volume) | When you upgrade to Postgres (see §8). |
| `CORS_ORIGIN` | `*` | When you have a known list of API consumers and want to lock down. |
| `VITE_API_URL` | _(empty)_ | Only when the SPA must talk to a backend on a different origin. Leave blank for IP-only. |

## 5. Build and start

```bash
docker compose up -d --build
```

First run takes ~1–2 minutes. Subsequent restarts are seconds.

Watch the logs while it boots:

```bash
docker compose logs -f backend
docker compose logs -f web
docker compose logs -f shop
```

You're up when you see `NovaERP API ready · http://localhost:4000/v1`
in the backend logs.

## 6. Verify

```bash
# From the VPS itself:
curl -s http://localhost/health
curl -s http://localhost/v1/public/company

# From your laptop:
curl -s http://<VPS_IP>/health
curl -s http://<VPS_IP>:8080/health
# Then open http://<VPS_IP>/ (ERP) and http://<VPS_IP>:8080/ (shop).
```

The chrome shows your brand (default `NovaERP`). Sign in with one of
the seeded users (printed in the backend startup logs).

## 7. Day-to-day operations

```bash
# Pull latest code + rebuild + restart
git pull
docker compose up -d --build

# Tail logs
docker compose logs -f

# Restart only one service
docker compose restart backend
docker compose restart web
docker compose restart shop

# Stop everything (keeps the DB volume)
docker compose down

# Wipe ALL data (DB + uploads) — irreversible
docker compose down -v
```

---

## Uploading Product Images

Product photos live in the `novaerp_uploads` Docker volume (mounted at
`/app/uploads` inside the backend container). They persist across
redeploys but are **not** included in the git repo or the Docker image,
so they must be transferred manually the first time (and re-run whenever
new images are added locally).

### One-command upload (PowerShell — from your dev machine)

```powershell
# Default: connects to 217.216.78.119 as root using your default SSH key
.\scripts\upload-images-to-vps.ps1

# Custom SSH key
.\scripts\upload-images-to-vps.ps1 -SshKey "C:\Users\Sharath\.ssh\pvs_key"

# Different user or host
.\scripts\upload-images-to-vps.ps1 -VpsUser ubuntu -VpsHost 217.216.78.119
```

The script:
1. Tars `backend/uploads/products/` locally
2. SCPs the archive to `/tmp/` on the VPS
3. SSHs in, extracts, and `docker cp`s every image into the running
   backend container at `/app/uploads/products/`

### Verify on the VPS

```bash
# Count images inside the container
docker exec $(docker ps --filter name=backend --format '{{.Names}}' | head -1) \
  ls /app/uploads/products/ | wc -l

# Test one image URL
curl -I http://localhost:4000/uploads/products/I61.jpg
```

### Re-run the import script after a DB wipe

If the VPS database is wiped (`docker compose down -v`), run the
import script again to restore `imageUrl` on all products:

```bash
# On the VPS, inside the repo directory
docker exec -it $(docker ps --filter name=backend --format '{{.Names}}' | head -1) \
  sh -c "ls /app/uploads/products/ | head -5"   # confirm images are there first

# Then from your dev machine, re-run the Python import script
python scripts/import-product-images.py
# and commit + push + redeploy to re-seed the DB
```

---

### Backups (SQLite)

The DB is a single file inside a docker volume. Snapshot it nightly
with cron:

```bash
sudo crontab -e
# add (runs at 02:30 daily, keeps 14 days)
30 2 * * * docker run --rm -v pvsresponse_novaerp_db:/data -v /opt/backups:/out alpine sh -c "cp /data/dev.db /out/novaerp-$(date +\%F).db && find /out -type f -mtime +14 -delete"
```

Restore by stopping the stack, copying the snapshot back into the
volume, and starting again.

### Restore from a backup

```bash
docker compose down
docker run --rm -v pvsresponse_novaerp_db:/data -v /opt/backups:/in \
  alpine sh -c "cp /in/novaerp-2026-05-21.db /data/dev.db"
docker compose up -d
```

## 8. Switching to Postgres (optional)

SQLite is fine until you have ~25 concurrent writers. To upgrade:

1. Add a `db` service to `docker-compose.yml`:
   ```yaml
   db:
     image: postgres:16-alpine
     restart: unless-stopped
     environment:
       POSTGRES_USER: novaerp
       POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set in .env}
       POSTGRES_DB: novaerp
     volumes:
       - novaerp_pg:/var/lib/postgresql/data
     networks: [novaerp]
   ```
   And a matching named volume `novaerp_pg`.
2. Change one line in `backend/prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. Set `DATABASE_URL` in `.env`:
   ```
   DATABASE_URL=postgresql://novaerp:strongpassword@db:5432/novaerp?schema=public
   POSTGRES_PASSWORD=strongpassword
   ```
4. Rebuild: `docker compose up -d --build`. The backend's
   `prisma migrate deploy` runs on every container start, so it
   creates the schema in the new Postgres DB automatically.
5. Re-run the seed if you want fresh data:
   ```
   docker compose exec backend sh -c "tsx prisma/seed.ts"
   ```

## 9. Attaching a domain later

Two options when you're ready to put a real domain in front:

**A. Cloudflare Tunnel** (no public TLS work; the Tunnel agent runs as
a third container, no firewall changes needed). Cheapest path to
HTTPS.

**B. Caddy / Traefik in front of the existing `web` container.**
Example with Caddy:

```yaml
# Add this service; expose Caddy on 80/443 instead of `web`.
caddy:
  image: caddy:2-alpine
  restart: unless-stopped
  ports: ["80:80", "443:443"]
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile
    - caddy_data:/data
  networks: [novaerp]
```

`Caddyfile`:

```
your-domain.com {
    reverse_proxy web:80
}
```

Then change `web`'s `ports:` to `expose: ["80"]` (no host publish).
Caddy auto-issues a Let's Encrypt cert as soon as DNS resolves.

No application code changes are needed — the SPA already uses
relative URLs.

## 10. Bare-metal alternative (no Docker)

If your VPS can't run Docker (rare), the same stack runs natively:

```bash
# Backend
sudo apt install -y nodejs npm nginx
cd backend
npm ci
npx prisma migrate deploy
npm run build
# Run with pm2 or systemd
sudo npm i -g pm2
PORT=4000 HOST=127.0.0.1 JWT_SECRET=... DATABASE_URL=file:./prisma/dev.db \
  pm2 start dist/index.js --name novaerp-api
pm2 save
pm2 startup   # follow the printed instructions

# Frontend
cd ../erp-portal
npm ci
npm run build           # produces dist/
sudo cp -r dist/* /var/www/novaerp/

# nginx site (copy the contents of erp-portal/nginx.conf into
# /etc/nginx/sites-available/novaerp, but change `backend:4000`
# to `127.0.0.1:4000` since you're not in docker-compose).
sudo nginx -t && sudo systemctl reload nginx
```

## 11. CI-built images (recommended once you have a GitHub repo)

Building on the VPS works but is slow. The included GitHub Actions
workflow at `.github/workflows/build-images.yml` builds all three images
(`novaerp-backend`, `novaerp-web`, and `novaerp-shop`) on every push to `main`,
publishes them to **GitHub Container Registry** (ghcr.io), and tags
them with `latest`, `sha-<short>`, and any pushed `v*` semver tag.

### One-time setup

1. **Repo settings → Actions → General → Workflow permissions**:
   set to "Read and write permissions" so the workflow can push
   packages.
2. **First successful run** publishes the images. They're private by
   default. To make them public, go to your GitHub profile →
   Packages → click the package → Package settings →
   "Change visibility".
3. On the VPS, log in to ghcr.io once (only needed for private
   packages):
   ```bash
   echo $GITHUB_PAT | docker login ghcr.io -u <github-user> --password-stdin
   ```
   The PAT needs `read:packages`. Persist the credentials in
   `~/.docker/config.json` (login does this automatically).

### Deploying from prebuilt images

The repo includes `docker-compose.prod.yml`, a small overlay that
swaps each service's `image:` for the GHCR-qualified one:

```bash
# On the VPS, in the repo root:
export REGISTRY_OWNER=<lowercase github user or org>
export IMAGE_TAG=latest          # or sha-1a2b3c4 / v1.2.3
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build
```

`pull` fetches the new tags; `up -d --no-build` recreates only the
containers whose image digest changed. Total downtime is ~5 s
(graceful stop + start). The `novaerp_db` volume is preserved.

### Rolling back to a known-good build

Each commit on `main` produces an immutable `sha-<short>` tag, so
rolling back is a one-liner:

```bash
IMAGE_TAG=sha-9f8e7d6 \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build
```

Find the SHA in the `Pushed backend image` / `Pushed web image` /
`Pushed shop image` section of the Actions run that you want to roll back to.

### Pinning to a release

When you cut a release, push a `v1.2.3` git tag:

```bash
git tag v1.2.3 && git push origin v1.2.3
```

The CI publishes immutable `1.2.3`, `1.2`, `1`, and `latest` tags.
Production should usually pin to the full version (`IMAGE_TAG=v1.2.3`)
so a future `latest` push doesn't re-deploy without your knowledge.

### CI cache & build time

The workflow uses Buildx with a GitHub Actions cache, so warm
rebuilds typically finish in under a minute (cold takes ~3 min).
To enable ARM builds (Raspberry Pi / Ampere VPS), change the
`platforms:` line in the workflow from `linux/amd64` to
`linux/amd64,linux/arm64`. Build time roughly doubles when both
are enabled.

## 12. Reference: what's in this repo for deployment

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | Top-level orchestration. Services: `web`, `shop`, `backend`, named volume `novaerp_db`. |
| `docker-compose.prod.yml` | Overlay that swaps `image:` to GHCR-qualified refs. Used with the base file via `-f` flags. |
| `.env.deploy.example` | Copy to `.env`. Holds `JWT_SECRET`, `WEB_PORT`, `SHOP_PORT`, `DATABASE_URL`, `CORS_ORIGIN`, `VITE_API_URL`. |
| `backend/Dockerfile` | Multi-stage Node 22 build. Runs `prisma migrate deploy` on every container start. |
| `backend/.dockerignore` | Keeps node_modules / dev DB out of the build context. |
| `erp-portal/Dockerfile` | Multi-stage: Vite build → nginx static serve. |
| `erp-portal/nginx.conf` | Site config: SPA fallback to `index.html`, reverse proxy `/v1` and `/health` to `backend:4000`. |
| `erp-portal/.dockerignore` | Same idea for the frontend build context. |
| `pvsecommerce/Dockerfile` | Multi-stage: Prakruthivanam Vite build → nginx static serve. |
| `pvsecommerce/nginx.conf` | Same proxy pattern as ERP; serves the shop on `$SHOP_PORT`. |
| `pvsecommerce/.dockerignore` | Shop build context exclusions. |
| `.github/workflows/build-images.yml` | CI: matrix build of backend + web + shop → push to ghcr.io with `latest`, `sha-<short>`, semver tags. |

## 13. Troubleshooting

**`docker compose up` fails on `JWT_SECRET is required`**
You haven't created `.env` yet (or didn't set the variable). See §4.

**Browser shows `Backend unreachable` on the login screen**
The backend container isn't healthy. Check `docker compose logs backend`.
Most common cause: the named volume contains an old DB without the
latest migrations. Either let `prisma migrate deploy` run (it always
does at startup), or wipe with `docker compose down -v` if you're OK
losing data.

**`prisma migrate deploy` fails with `P3009 migrate found failed migrations`**
Inspect with `docker compose exec backend npx prisma migrate status`.
If you're early in deployment, `docker compose down -v` and retry.

**Port 80 already in use**
Set `WEB_PORT=8080` in `.env` and re-run `docker compose up -d`.
Then access the app at `http://<VPS_IP>:8080/`.

**Tab title still says NovaERP**
Set the brand under Settings → Appearance → Brand name. The change
propagates instantly via `/v1/public/company`.
