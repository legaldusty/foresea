#!/usr/bin/env bash
set -euo pipefail
HOST="${1:?Usage: deploy/push.sh <server ip> [domain]}"
DOMAIN="${2:-${HOST//./-}.sslip.io}"
KEY="${GIVEWAY_SSH_KEY:-$HOME/.ssh/giveway_deploy}"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
cd "$(dirname "$0")/.."

if [ "${SKIP_PROVISION:-0}" != "1" ]; then
  ssh "${SSH_OPTS[@]}" "root@$HOST" 'bash -s' < deploy/provision.sh
fi

rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
  --exclude node_modules --exclude .git --exclude dist --exclude dist-e2e \
  --exclude test-results --exclude playwright-report --exclude certs \
  --exclude round3 --exclude e2e/videos --exclude 'data/cache/audit-*' --exclude 'data/audit.sqlite*' \
  ./ "root@$HOST:/opt/giveway/app/"

ssh "${SSH_OPTS[@]}" "root@$HOST" "bash -s" <<REMOTE
set -euo pipefail
printf 'PUBLIC_URL=https://%s\nGIVEWAY_LLM_TIMEOUT_MS=20000\n' '$DOMAIN' > /opt/giveway/hosting.env
printf '%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:5170\n}\n' '$DOMAIN' > /etc/caddy/Caddyfile
cp /opt/giveway/app/deploy/giveway.service /etc/systemd/system/giveway.service
chown -R giveway:giveway /opt/giveway
cd /opt/giveway/app
sudo -u giveway npm ci --no-audit --no-fund
sudo -u giveway npm run build
systemctl daemon-reload
systemctl enable giveway
systemctl restart giveway
systemctl reload caddy || systemctl restart caddy
for i in \$(seq 1 60); do curl -fs http://127.0.0.1:5170/api/health >/dev/null && break; sleep 1; done
curl -fs http://127.0.0.1:5170/api/health | head -c 200
echo
REMOTE

echo "Live at https://$DOMAIN"
