#!/usr/bin/env bash
# Runs ON the server, from the deployed copy of the repo (ops/deploy.sh
# sends the code and starts this). Safe to run again: it never replaces a
# secret that already exists. docs/deploy.md.
#
#   bash ~/fils-pay/ops/remote-deploy.sh
#
# Env (all optional):
#   PUBLIC_IP   the server's public address (default: asked from the network)
#   SITE_HOST   dashboard and checkout host (default: <ip with dashes>.sslip.io,
#               which resolves to the IP, so HTTPS works without a domain)
#   OPS_HOST    Ops console host (default: ops.<SITE_HOST>)
#   HTTP_ONLY=1 serve plain HTTP (no certificate; cookies not marked Secure)
#   SEED=1      load the demo data, only into an empty database
#
# Settings live in ~/fils-pay-config (.env and .env.docker), outside the
# code, so a new deploy never loses them; they are copied into ops/ each run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$HOME/fils-pay-config"
cd "$ROOT"
say() { printf '\n== %s\n' "$*"; }

# 1. Docker -----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Docker is not installed; installing it (needs sudo)"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
if docker info >/dev/null 2>&1; then DOCKER=(docker); else DOCKER=(sudo docker); fi
if ! "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  echo "remote-deploy: docker compose (v2) is missing; install the docker-compose-plugin package" >&2
  exit 1
fi

# 2. Settings ---------------------------------------------------------------
mkdir -p "$CONF"
chmod 700 "$CONF"
rand() { openssl rand -hex 24; }
# A deployment from before this script kept its settings inside the code
# folder. Carry them over once: the database volume was created with that
# POSTGRES_PASSWORD, and a new one would not open it.
for f in .env .env.docker; do
  for old in "$HOME/fils-pay.old/ops/$f" "$ROOT/ops/$f"; do
    if [ ! -f "$CONF/$f" ] && [ -f "$old" ]; then
      cp "$old" "$CONF/$f"
      echo "kept existing settings from $old"
    fi
  done
done
touch "$CONF/.env" "$CONF/.env.docker"
chmod 600 "$CONF/.env" "$CONF/.env.docker"
# Adds KEY=value to a settings file unless KEY is already there.
ensure() {
  local file="$1" key="$2" value="$3"
  grep -q "^$key=" "$file" || printf '%s=%s\n' "$key" "$value" >> "$file"
}

ip="${PUBLIC_IP:-$(curl -fsS --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')}"
site_host="${SITE_HOST:-${ip//./-}.sslip.io}"
ops_host="${OPS_HOST:-ops.$site_host}"
if [ "${HTTP_ONLY:-0}" = 1 ]; then scheme=http; else scheme=https; fi

ensure "$CONF/.env" POSTGRES_PASSWORD "$(rand)"
ensure "$CONF/.env" API_DB_PASSWORD "$(rand)"
ensure "$CONF/.env" SETTLEMENT_DB_PASSWORD "$(rand)"
ensure "$CONF/.env" REPORTING_DB_PASSWORD "$(rand)"
ensure "$CONF/.env" WEBHOOK_SECRET_ENCRYPTION_KEY "$(openssl rand -base64 32)"
ensure "$CONF/.env" SETTLEMENT_INTERNAL_TOKEN "$(rand)"
if [ "$scheme" = http ]; then
  ensure "$CONF/.env" SITE_ADDRESS "http://$site_host"
  ensure "$CONF/.env" OPS_ADDRESS "http://$ops_host"
  ensure "$CONF/.env" COOKIE_SECURE false
else
  ensure "$CONF/.env" SITE_ADDRESS "$site_host"
  ensure "$CONF/.env" OPS_ADDRESS "$ops_host"
  ensure "$CONF/.env" COOKIE_SECURE true
fi
ensure "$CONF/.env" PUBLIC_SITE_URL "$scheme://$site_host"
ensure "$CONF/.env" PUBLIC_OPS_URL "$scheme://$ops_host"

ensure "$CONF/.env.docker" NODE_ENV production
ensure "$CONF/.env.docker" PORT 3000
ensure "$CONF/.env.docker" ACQUIRER_CALLBACK_SIGNING_SECRET "$(rand)"
# Development-only switches the api refuses in production.
sed -i '/^OTP_DEV_EXPOSE=/d; /^WEBHOOK_ALLOW_PRIVATE_HOSTS=/d' "$CONF/.env.docker"

cp "$CONF/.env" ops/.env
cp "$CONF/.env.docker" ops/.env.docker

# 3. Build and start ---------------------------------------------------------
COMPOSE=("${DOCKER[@]}" compose -f ops/docker-compose.yml -f ops/docker-compose.prod.yml)

# Caddy needs ports 80 and 443. Stop early, with the culprit's name, if
# something other than this stack already holds them (an old nginx, say).
if ! "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx web; then
  busy="$( (ss -ltnpH 2>/dev/null || sudo ss -ltnpH 2>/dev/null || true) | awk '$4 ~ /:(80|443)$/' )"
  if [ -n "$busy" ]; then
    echo "remote-deploy: ports 80/443 are already in use on this server:" >&2
    echo "$busy" >&2
    echo "Stop that service (e.g. sudo systemctl disable --now nginx) and run this again." >&2
    exit 1
  fi
fi
if command -v ufw >/dev/null 2>&1 && sudo -n ufw status 2>/dev/null | grep -q 'Status: active'; then
  sudo -n ufw allow 80/tcp >/dev/null && sudo -n ufw allow 443/tcp >/dev/null && echo "firewall: opened 80 and 443 (ufw)"
fi

say "Building and starting (the first build takes several minutes on one vCPU)"
"${COMPOSE[@]}" up -d --build --remove-orphans

say "Waiting for the api"
for _ in $(seq 1 90); do
  if curl -fsS --max-time 2 http://127.0.0.1:3000/healthz >/dev/null 2>&1; then break; fi
  sleep 2
done
if ! curl -fsS --max-time 2 http://127.0.0.1:3000/healthz >/dev/null; then
  echo "remote-deploy: the api did not come up; its last log lines:" >&2
  "${COMPOSE[@]}" logs --tail 40 api >&2
  exit 1
fi

# 4. Demo data (optional) ------------------------------------------------------
if [ "${SEED:-0}" = 1 ]; then
  say "Loading demo data (refused if the database already has merchants it didn't create)"
  "${COMPOSE[@]}" --profile seed run --rm seed || echo "seed refused or failed; the database was left as it was"
fi

# 5. Report ----------------------------------------------------------------------
say "Status"
"${COMPOSE[@]}" ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
site_url="$(grep '^PUBLIC_SITE_URL=' "$CONF/.env" | cut -d= -f2-)"
ops_url="$(grep '^PUBLIC_OPS_URL=' "$CONF/.env" | cut -d= -f2-)"
echo
echo "Deployed commit: $(cat "$ROOT/DEPLOYED_COMMIT" 2>/dev/null || echo unknown)"
echo "Dashboard:  $site_url/dashboard"
echo "Checkout:   $site_url/pay/<token>"
echo "Ops:        $ops_url"
echo "API:        $site_url/v1   (health: $site_url/healthz)"
echo
echo "Ports 80 and 443 must be open to the internet (the certificate is issued over them)."
if [ "$scheme" = https ]; then
  echo "The first HTTPS request can take a few seconds while Caddy gets the certificate:"
  echo "  ${COMPOSE[*]} logs -f web"
fi
