#!/usr/bin/env bash
#
# Drive the local observability stack: up | down | logs | reload.
#
# Every npm script routes through here rather than calling `docker compose -f
# ../docker-compose.observability.yml` directly, for two reasons.
#
# The daemon: `docker compose up` against a stopped Docker Desktop fails with a
# socket error that reads like a config problem. This starts it and waits.
#
# The path casing: the compose file's volume paths are relative, so they resolve
# against whatever the caller's shell thought the directory was called. macOS is
# case-insensitive, so `cd ~/code/FuelSense` works even though the directory is
# `Code` — but Docker Desktop's file sharing is not, and it mounts an empty
# directory instead of the configs. Prometheus then dies on reload with "no such
# file or directory" against a file that is plainly there.
#
# `git rev-parse` asks the filesystem and returns the real casing. Note that
# `pwd -P` does NOT fix this under bash — it does under zsh, which is exactly
# the sort of difference that makes this bug look intermittent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --show-toplevel 2>/dev/null)" \
  || REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.observability.yml"
GRAFANA_URL="http://localhost:9091"
SERVICES=(prometheus loki promtail grafana)

# Production is scraped through an SSH tunnel: the box only serves /metrics to
# loopback, and a request arriving over `-L` is loopback as far as it can
# tell. The tunnel's pid is kept so `down` can close it.
PROD_HOST="${FUELSENSE_PROD_HOST:-13.63.114.126}"
PROD_USER="${FUELSENSE_PROD_USER:-ec2-user}"
PROD_KEY="${FUELSENSE_PROD_KEY:-$HOME/.ssh/fuelsense.pem}"
PROD_TUNNEL_PORT=15001
PROD_TUNNEL_PID="$REPO_ROOT/ops/observability/.prod-tunnel.pid"

log() { printf '\033[2m[obs]\033[0m %s\n' "$1"; }
die() { printf '\033[31m[obs]\033[0m %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is not installed."

# Run compose from the repo root so the relative volume paths in the compose
# file resolve against the canonical directory, not the caller's cwd.
compose() { (cd "$REPO_ROOT" && docker compose -f "$COMPOSE_FILE" "$@"); }

ensure_daemon() {
  docker info >/dev/null 2>&1 && return 0

  case "$(uname -s)" in
    Darwin)
      log "Docker daemon is not running — starting Docker Desktop."
      open -a Docker || die "Could not launch Docker Desktop."
      ;;
    *) die "Docker daemon is not running. Start it and try again." ;;
  esac

  log "Waiting for the daemon (up to 3 min)."
  for _ in $(seq 1 36); do
    docker info >/dev/null 2>&1 && return 0
    sleep 5
  done

  # Docker Desktop can sit with its UI up and no daemon behind it, which this
  # script cannot clear on its own — it needs a human at the app.
  die "Docker Desktop is running but its daemon never came up. Open the app and
     check for a sign-in or update prompt, then re-run. If it stays wedged:
     pkill -9 -f com.docker.backend && open -a Docker"
}

# The configs are bind-mounted, and a wrong-cased or missing mount shows up as
# an empty directory rather than an error — so check the container can actually
# see them before trusting the stack.
verify_mounts() {
  local missing=0
  docker exec fuelsense-prometheus test -f /etc/prometheus/conf/prometheus.yml 2>/dev/null || missing=1
  docker exec fuelsense-prometheus test -f /etc/prometheus/conf/rules.yml 2>/dev/null || missing=1
  if [ "$missing" -eq 1 ]; then
    die "Prometheus cannot see its config. The bind mount resolved to an empty
     directory — check that $REPO_ROOT matches the real path casing, then:
     npm run prom:grafana:stop && npm run prom:grafana"
  fi
}

tunnel_alive() {
  [ -f "$PROD_TUNNEL_PID" ] && kill -0 "$(cat "$PROD_TUNNEL_PID")" 2>/dev/null
}

open_prod_tunnel() {
  tunnel_alive && { log "Production tunnel already open (localhost:$PROD_TUNNEL_PORT)."; return 0; }
  [ -f "$PROD_KEY" ] || die "SSH key not found at $PROD_KEY (set FUELSENSE_PROD_KEY)."
  log "Opening tunnel localhost:$PROD_TUNNEL_PORT -> $PROD_HOST:5001 (metrics)."
  ssh -i "$PROD_KEY" -o ServerAliveInterval=15 -o ExitOnForwardFailure=yes -o BatchMode=yes \
    -N -L "$PROD_TUNNEL_PORT:127.0.0.1:5001" "$PROD_USER@$PROD_HOST" \
    >/dev/null 2>&1 &
  echo $! > "$PROD_TUNNEL_PID"
  for _ in $(seq 1 10); do
    curl -fsS "http://localhost:$PROD_TUNNEL_PORT/api/health" >/dev/null 2>&1 && { log "Production reachable through the tunnel."; return 0; }
    sleep 1
  done
  die "Tunnel opened but $PROD_HOST did not answer on :5001. Is the fuelsense unit up?"
}

close_prod_tunnel() {
  tunnel_alive && { kill "$(cat "$PROD_TUNNEL_PID")" 2>/dev/null || true; log "Production tunnel closed."; }
  rm -f "$PROD_TUNNEL_PID"
}

case "${1:-up}" in
  prod)
    # Same as `up`, plus the tunnel — so the dashboards' env=prod has data.
    open_prod_tunnel
    exec "$0" up
    ;;

  up)
    ensure_daemon
    log "Starting the observability stack."
    compose up -d

    log "Waiting for Grafana."
    for _ in $(seq 1 40); do
      curl -fsS "$GRAFANA_URL/api/health" >/dev/null 2>&1 && break
      sleep 3
    done
    curl -fsS "$GRAFANA_URL/api/health" >/dev/null 2>&1 \
      || die "Grafana did not become healthy. Try: npm run prom:grafana:logs"

    verify_mounts

    # Scrape health is worth saying out loud: the backend target being down is
    # the commonest reason the dashboard looks empty, and it is not Grafana's
    # fault, so Grafana never mentions it.
    #
    # Polled rather than checked once — `up` does not exist until the first
    # scrape completes, and a check that races the scrape interval reports a
    # healthy backend as missing, which is worse than saying nothing.
    # -G with --data-urlencode, not a literal query string: the braces and
    # quotes in a PromQL selector are not legal in a URL, and Prometheus answers
    # 400. With `curl -f` that failure is silent, so the check can never pass
    # and the warning prints unconditionally.
    scraped=0
    for _ in $(seq 1 10); do
      if curl -fsS -G --data-urlencode 'query=max(up{job="fuelsense-backend"})' \
           http://localhost:9090/api/v1/query 2>/dev/null \
         | grep -q '"1"'; then
        scraped=1
        break
      fi
      sleep 3
    done
    [ "$scraped" -eq 1 ] \
      || log "Warning: no backend is being scraped. Start it with 'npm run dev' in backend/."

    tunnel_alive \
      && log "Production is being scraped too — pick env=prod on either dashboard." \
      || log "Laptop only. For the EC2 box's numbers: npm run prom:prod"

    log "Grafana    $GRAFANA_URL"
    log "Prometheus http://localhost:9090"
    log "Logs need the backend started with 'npm run dev:logs' rather than 'npm run dev'."

    case "$(uname -s)" in
      Darwin) open "$GRAFANA_URL" ;;
      Linux) command -v xdg-open >/dev/null 2>&1 && xdg-open "$GRAFANA_URL" >/dev/null 2>&1 || true ;;
    esac
    ;;

  down)
    compose down
    close_prod_tunnel
    ;;

  logs)
    compose logs -f --tail 50
    ;;

  reload)
    # Restart rather than hitting /-/reload: a restart re-resolves the bind
    # mounts, and a stale mount is the failure this most often has to clear.
    ensure_daemon
    compose restart "${SERVICES[@]}"
    log "Waiting for Grafana."
    for _ in $(seq 1 40); do
      curl -fsS "$GRAFANA_URL/api/health" >/dev/null 2>&1 && break
      sleep 3
    done
    verify_mounts
    log "Reloaded."
    ;;

  *)
    die "Unknown command '${1}'. Use: up | down | logs | reload"
    ;;
esac
