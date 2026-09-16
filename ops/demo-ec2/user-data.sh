#!/bin/bash
# First boot of the demo box: node for the API, caddy to serve the site and
# proxy /api. Runs once; deploy.sh does everything after this.
set -eux
dnf install -y nodejs20 rsync
[ -x /usr/bin/node ] || ln -s /usr/bin/node-20 /usr/bin/node
[ -x /usr/bin/npm ] || ln -s /usr/bin/npm-20 /usr/bin/npm
curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/bin/caddy
chmod +x /usr/bin/caddy
mkdir -p /etc/caddy
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy (demo front door)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
mkdir -p /home/ec2-user/backend /home/ec2-user/site
chown -R ec2-user:ec2-user /home/ec2-user
chmod 755 /home/ec2-user
touch /home/ec2-user/.bootstrapped
