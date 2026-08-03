#!/usr/bin/env bash
#
# Start chunky.fm: the backend, its database, and the frontend.
#
#   ./start.sh              build if needed, start everything, wait for healthy
#   ./start.sh --build      force a rebuild of both images first
#   ./start.sh logs         follow the logs of the running station
#   ./start.sh status       what is up, and how healthy
#   ./start.sh stop         stop the containers, keep the library
#
# The database is SQLite, opened in-process by the backend — there is no third
# container to start. It lives in the chunky-fm_data volume together with the
# audio and artwork, and survives `stop`, `--build`, and image rebuilds.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

readonly ENV_FILE=.env
readonly EXAMPLE_ENV=.env.example
readonly HEALTH_TIMEOUT=180

bold=''; dim=''; red=''; green=''; yellow=''; reset=''
if [[ -t 1 ]]; then
  bold=$'\033[1m'; dim=$'\033[2m'; red=$'\033[31m'
  green=$'\033[32m'; yellow=$'\033[33m'; reset=$'\033[0m'
fi

say()  { printf '%s\n' "$*"; }
info() { printf '%s==>%s %s\n' "$bold" "$reset" "$*"; }
warn() { printf '%s warn%s %s\n' "$yellow" "$reset" "$*" >&2; }
die()  { printf '%serror%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }

# --- prerequisites ----------------------------------------------------------

command -v docker >/dev/null 2>&1 \
  || die "docker is not installed — see https://docs.docker.com/get-docker/"

docker info >/dev/null 2>&1 \
  || die "the docker daemon is not reachable — is Docker running, and is your user in the docker group?"

if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose "$@"; }
else
  die "docker compose is not available — install the Compose plugin (docker compose version)"
fi

# --- configuration ----------------------------------------------------------

generate_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24
  else
    LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24
  fi
}

ensure_env() {
  [[ -f $ENV_FILE ]] && return 0
  [[ -f $EXAMPLE_ENV ]] || die "neither $ENV_FILE nor $EXAMPLE_ENV exists — cannot configure the station"

  local generated
  generated=$(generate_password)
  # Only the placeholder is replaced, so every other setting keeps the comments
  # and defaults the example file ships with.
  sed "s|^ADMIN_PASSWORD=change-me$|ADMIN_PASSWORD=${generated}|" "$EXAMPLE_ENV" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  info "Created $ENV_FILE with a generated admin password:"
  say  "    ${bold}${generated}${reset}"
  say  "    ${dim}Sign in with this at the admin panel. Edit $ENV_FILE to change it.${reset}"
  say
}

# Read one value out of .env without sourcing it — the file is untrusted input
# as far as this script is concerned, and it is compose that owns parsing it.
# A shell variable wins over the file, matching how compose resolves the same
# name, so `WEB_PORT=8080 ./start.sh` reports the port it actually published.
env_value() {
  local key=$1 line
  [[ -n ${!key-} ]] && { printf '%s' "${!key}"; return 0; }
  line=$(grep -m1 "^${key}=" "$ENV_FILE" 2>/dev/null) || return 0
  printf '%s' "${line#*=}"
}

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&-; return 0; }
  return 1
}

# Docker's own message for a taken port names a container id and a hex endpoint,
# which says nothing about which knob to turn. Check first and say it plainly.
check_ports() {
  # Ports held by our own already-running containers are not a conflict.
  [[ -n $(compose ps -q 2>/dev/null) ]] && return 0

  local spec key port label conflict=no
  for spec in "WEB_PORT:${1}:frontend" "SERVER_PORT:${2}:backend"; do
    IFS=: read -r key port label <<< "$spec"
    if port_in_use "$port"; then
      warn "port $port (the $label) is already in use — set $key in $ENV_FILE, or run '$key=<free port> ./start.sh'"
      conflict=yes
    fi
  done
  [[ $conflict == no ]] || die "refusing to start into an occupied port"
}

check_password() {
  local password
  password=$(env_value ADMIN_PASSWORD)
  if [[ -z $password ]]; then
    die "ADMIN_PASSWORD is empty in $ENV_FILE — the backend refuses to start with an unguarded admin surface"
  elif [[ $password == change-me ]]; then
    warn "ADMIN_PASSWORD is still 'change-me' in $ENV_FILE — fine locally, never anywhere else"
  fi
}

# --- health -----------------------------------------------------------------

container_health() {
  local service=$1 id
  id=$(compose ps -q "$service" 2>/dev/null) || return 1
  [[ -n $id ]] || { printf 'missing'; return 0; }
  # A container with no healthcheck reports an empty string; treat "running and
  # unmonitored" as healthy rather than hanging on it forever.
  docker inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else if .State.Running}}healthy{{else}}stopped{{end}}' \
    "$id" 2>/dev/null || printf 'missing'
}

wait_for_health() {
  local service=$1 label=$2 waited=0 state
  printf '%s' "    ${label} "
  while true; do
    state=$(container_health "$service")
    case $state in
      healthy)
        printf '%s✓%s\n' "$green" "$reset"
        return 0
        ;;
      unhealthy|stopped|missing)
        printf '%s✗ %s%s\n' "$red" "$state" "$reset"
        say
        warn "$service did not come up — last 40 lines:"
        compose logs --tail 40 "$service" || true
        return 1
        ;;
    esac
    (( waited >= HEALTH_TIMEOUT )) && {
      printf '%s✗ timed out after %ss%s\n' "$red" "$HEALTH_TIMEOUT" "$reset"
      return 1
    }
    printf '.'
    sleep 2
    waited=$(( waited + 2 ))
  done
}

# --- commands ---------------------------------------------------------------

start() {
  local force_build=$1

  ensure_env
  check_password

  # Defaults match docker-compose.yml, and are deliberately not the 5173/3000
  # that `npm run dev` binds — the two are meant to be able to run side by side.
  local web_port server_port
  web_port=$(env_value WEB_PORT); web_port=${web_port:-18173}
  server_port=$(env_value SERVER_PORT); server_port=${server_port:-13000}
  check_ports "$web_port" "$server_port"

  if [[ $force_build == yes ]]; then
    info "Building images"
    compose build --pull
  fi

  info "Starting the station"
  compose up -d --remove-orphans

  info "Waiting for services"
  wait_for_health server "backend + sqlite" || die "startup failed"
  wait_for_health web    "frontend        " || die "startup failed"

  say
  say "  ${bold}chunky.fm is on air${reset}"
  say "    listen   ${bold}http://localhost:${web_port}${reset}"
  say "    admin    ${bold}http://localhost:${web_port}/#admin${reset}"
  say "    api      http://localhost:${server_port}"
  say "    library  docker volume ${bold}chunky-fm_data${reset} ${dim}(sqlite + audio + artwork)${reset}"
  say
  say "  ${dim}./start.sh logs    follow the logs${reset}"
  say "  ${dim}./start.sh stop    stop, keeping the library${reset}"
  say
}

usage() {
  sed -n '3,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

main() {
  case ${1-} in
    ''|up|start)  start no ;;
    --build|-b|rebuild)
                  start yes ;;
    logs)         shift; compose logs -f --tail 100 "$@" ;;
    status|ps)    compose ps ;;
    stop|down)    info "Stopping — the library volume is left alone"
                  compose down ;;
    restart)      compose down
                  start no ;;
    -h|--help|help) usage ;;
    *)            usage; die "unknown command: $1" ;;
  esac
}

main "$@"
