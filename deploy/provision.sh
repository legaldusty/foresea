#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y curl ca-certificates gnupg rsync ufw debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || ! node -v | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment=OLLAMA_KEEP_ALIVE=24h\nEnvironment=OLLAMA_NUM_PARALLEL=1\nNice=15\nCPUWeight=20\n' > /etc/systemd/system/ollama.service.d/keepalive.conf
systemctl daemon-reload
systemctl enable ollama
systemctl restart ollama
for i in $(seq 1 30); do curl -fs http://127.0.0.1:11434/api/tags >/dev/null && break; sleep 1; done
ollama pull granite4:micro

if ! id giveway >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /opt/giveway --shell /usr/sbin/nologin giveway
fi
mkdir -p /opt/giveway/app
chown -R giveway:giveway /opt/giveway

if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
