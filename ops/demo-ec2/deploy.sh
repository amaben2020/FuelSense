#!/usr/bin/env bash
# Push the current checkout to the demo box and (re)start it.
#
#   ops/demo-ec2/deploy.sh
#
# The API runs from backend/.env.demo copied as .env on the box — the Neon
# demo database and its own Upstash; the box never receives backend/.env and
# so never holds a production credential. The site is the frontend's static
# export, built here with a relative API base so it works behind CloudFront.
source "$(dirname "$0")/common.sh"

INSTANCE_ID="$(state_get INSTANCE_ID)"
[ -n "$INSTANCE_ID" ] || INSTANCE_ID="$(demo_instance_ids | awk '{print $1}')"
[ -n "$INSTANCE_ID" ] || { echo "no demo instance — run up.sh first" >&2; exit 1; }
IP="$(demo_instance_ip "$INSTANCE_ID")"
refuse_prod "$INSTANCE_ID" "$IP"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 $SSH_USER@$IP"

SG_ID="$(state_get SG_ID)"
[ -n "$SG_ID" ] && allow_ssh_from_here "$SG_ID"

[ -f "$REPO/backend/.env.demo" ] || { echo "backend/.env.demo missing" >&2; exit 1; }

echo "== waiting for first boot on $IP"
until $SSH test -f /home/ec2-user/.bootstrapped 2>/dev/null; do sleep 10; echo "   …"; done

echo "== building the site (static export, API at /api)"
( cd "$REPO/frontend" && NEXT_PUBLIC_API_URL=/api npx next build >/dev/null )

echo "== syncing backend and site"
rsync -az --delete -e "ssh -i $SSH_KEY" \
  --exclude node_modules --exclude .git --exclude '.env' --exclude '.env.*' --exclude dist --exclude '*.log' \
  "$REPO/backend/" "$SSH_USER@$IP:/home/ec2-user/backend/"
# The demo environment, and only that, becomes the box's .env. Simulator on,
# ports as the box's caddy expects.
grep -vE '^(PORT|TCP_PORT|TCP_SERVER_HOST|CORS_ALLOW_ALL)=' "$REPO/backend/.env.demo" > "$HERE/.env.box"
cat >> "$HERE/.env.box" <<ENV
PORT=5101
TCP_PORT=5127
TCP_SERVER_HOST=127.0.0.1
CORS_ALLOW_ALL=true
ENV
scp -q -i "$SSH_KEY" "$HERE/.env.box" "$SSH_USER@$IP:/home/ec2-user/backend/.env"
rm -f "$HERE/.env.box"
rsync -az --delete -e "ssh -i $SSH_KEY" "$REPO/frontend/out/" "$SSH_USER@$IP:/home/ec2-user/site/"
scp -q -i "$SSH_KEY" "$HERE/Caddyfile" "$HERE/fuelsense-demo.service" "$SSH_USER@$IP:/home/ec2-user/"

echo "== installing and starting"
$SSH 'set -e
  cd /home/ec2-user/backend && (npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null)
  sudo mv /home/ec2-user/Caddyfile /etc/caddy/Caddyfile
  sudo mv /home/ec2-user/fuelsense-demo.service /etc/systemd/system/fuelsense-demo.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now caddy >/dev/null
  sudo systemctl restart caddy
  sudo systemctl enable fuelsense-demo >/dev/null
  sudo systemctl restart fuelsense-demo
  sleep 8
  systemctl is-active fuelsense-demo caddy
  curl -sf http://127.0.0.1/api/health && echo'
echo "== up: http://$IP (HTTP only — run cloudfront.sh for the https URL)"
