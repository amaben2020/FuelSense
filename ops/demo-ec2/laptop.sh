#!/usr/bin/env bash
# Run the demo API on this laptop against the demo box's database.
#
#   ops/demo-ec2/laptop.sh
#
# Opens an SSH tunnel to the box's Postgres (local port 15433 — never 15432,
# which is the production RDS tunnel and refused everywhere) and starts the
# backend from .env.demo on :5101 with the fleet simulator OFF: the box's
# simulator is the only thing writing positions, this process just serves the
# UI. Frontend: `npm run dev:demo` in frontend/ as before.
source "$(dirname "$0")/common.sh"

INSTANCE_ID="$(state_get INSTANCE_ID)"
IP="$(demo_instance_ip "$INSTANCE_ID")"
refuse_prod "$INSTANCE_ID" "$IP"
SG_ID="$(state_get SG_ID)"
[ -n "$SG_ID" ] && allow_ssh_from_here "$SG_ID"
PW="$(state_get DB_PASSWORD)"
[ -n "$PW" ] || { echo "no DB_PASSWORD in .state — the box has no local database" >&2; exit 1; }

pkill -f "15433:127.0.0.1:5432" 2>/dev/null || true
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
  -f -N -L 15433:127.0.0.1:5432 "$SSH_USER@$IP"
echo "tunnel open: localhost:15433 → demo box postgres"

cd "$REPO/backend"
exec env DOTENV_CONFIG_PATH=.env.demo \
  DATABASE_URL="postgresql://fuelsense:$PW@127.0.0.1:15433/fuelsense_demo" \
  DATABASE_SSL=disable \
  ENABLE_FLEET_SIMULATOR=false \
  npx tsx src/server.ts
