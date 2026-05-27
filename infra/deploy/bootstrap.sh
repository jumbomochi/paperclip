#!/bin/bash
# Idempotent VPS bootstrap. Run on a fresh Ubuntu 24.04 VPS as root (or via sudo).
set -euo pipefail

apt-get update -y
apt-get install -y \
  curl ca-certificates gnupg ufw fail2ban git \
  unattended-upgrades apt-listchanges

# Firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

dpkg-reconfigure -plow unattended-upgrades || true

# Docker
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# App user + dirs
id -u paperclip >/dev/null 2>&1 || useradd -m -s /bin/bash paperclip
usermod -aG docker paperclip
mkdir -p /opt/paperclip /var/log/paperclip
chown -R paperclip:paperclip /opt/paperclip /var/log/paperclip

# systemd unit
cat > /etc/systemd/system/paperclip.service <<'UNIT'
[Unit]
Description=Paperclip Marketing Agency
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/paperclip
ExecStart=/usr/bin/docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml down
User=paperclip
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable paperclip.service

echo "Bootstrap complete. Next:"
echo "  sudo -u paperclip git clone <repo> /opt/paperclip"
echo "  populate /opt/paperclip/.env"
echo "  sudo systemctl start paperclip"
