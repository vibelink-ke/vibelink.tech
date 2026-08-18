#!/usr/bin/env bash
#
# The whole product, running locally on a throwaway database.
#
#   scripts/dev-stack.sh up      start Postgres, the API and the web app
#   scripts/dev-stack.sh down    stop everything and delete the database
#   scripts/dev-stack.sh reset   down, then up — a clean database in one step
#   scripts/dev-stack.sh status  what is running, and where
#
# Why this exists: the checks in frontend/scripts prove that screens open and
# that every call has a route, which is not the same as the product working. A
# form that fails on submit, a payment that does not reach a subscriber, a
# voucher that is issued but never authenticates — none of that is visible until
# something drives the real UI against the real API.
#
# Everything here is disposable. The database lives in a container with no
# volume, the tenant is "demo", and the admin password is printed below and is
# not a secret. Nothing in this file should ever be pointed at production: it
# creates and deletes data freely, and the flows it exists to exercise include
# Suspend and Delete.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER=vibelink-dev-db

RUN_DIR="${ROOT}/.dev-stack"
mkdir -p "${RUN_DIR}"
PORTS_FILE="${RUN_DIR}/ports.env"

# Ports are found once and then remembered, not re-found on every invocation.
#
# The first version picked a free port fresh each time this script ran. That
# looked reasonable and produced an accumulating pile of orphaned API
# processes: "up" would find 8080 taken by a leftover from yesterday and start
# a fresh one on 8081; the next "up", checking again, found 8081 now taken too
# — by the API it had just started — and moved on to 8082, launching *another*
# API rather than recognising the one already serving correctly. Three
# processes in, none of the port numbers curl was told to check ever matched
# a server curl could actually reach in time, and every run reported failure
# even though something had been working the whole time.
#
# Recorded once in .dev-stack/ports.env and reused on every later run. "down"
# deletes the file, so the next "up" is a fresh search — a leftover process
# from a previous day is stepped over, never fought with or killed, since it
# might matter to whoever started it.
port_free() { ! (netstat -ano 2>/dev/null | grep "LISTENING" | grep -q ":$1 "); }
next_free() {
  local p="$1"
  for _ in $(seq 1 40); do
    if port_free "$p"; then echo "$p"; return 0; fi
    p=$((p + 1))
  done
  echo "$1"   # nothing free nearby; let it fail loudly rather than silently
}
running_db_port() { docker port "${DB_CONTAINER}" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://'; }

if [ -f "${PORTS_FILE}" ]; then
  # shellcheck disable=SC1090
  . "${PORTS_FILE}"
fi

# The database keeps whichever port its container actually published, if it is
# running — that is a fact, not a guess, and searching for a free one instead
# found a different number than the container was really listening on.
DB_PORT="${VIBELINK_DB_PORT:-$(running_db_port)}"
DB_PORT="${DB_PORT:-${DB_PORT_SAVED:-}}"
DB_PORT="${DB_PORT:-$(next_free 55432)}"
API_PORT="${VIBELINK_API_PORT:-${API_PORT_SAVED:-$(next_free 8080)}}"
WEB_PORT="${VIBELINK_WEB_PORT:-${WEB_PORT_SAVED:-$(next_free 5173)}}"

cat > "${PORTS_FILE}" <<EOF
DB_PORT_SAVED=${DB_PORT}
API_PORT_SAVED=${API_PORT}
WEB_PORT_SAVED=${WEB_PORT}
EOF

# Local only, and deliberately obvious. A real password here would be a real
# password sitting in a repository.
DEV_PASSWORD='dev-password-not-for-production'
DEV_EMAIL='dev@vibelink.test'
DEV_SUBDOMAIN='demo'

export DATABASE_URL="postgres://postgres:devpass@127.0.0.1:${DB_PORT}/vibelink"
# The API refuses to store router passwords without this. Regenerated per run:
# nothing here outlives the container.
export APP_SECRET_KEY="${APP_SECRET_KEY:-$(head -c 32 /dev/urandom | base64 | tr -d '\n')}"
export ROOT_DOMAIN=vibelink.tech
export DEV_TENANT="${DEV_SUBDOMAIN}.vibelink.tech"
export PORT="${API_PORT}"
# The Vite proxy targets 8080 by default; tell it where the API actually landed.
export VITE_API_ORIGIN="http://localhost:${API_PORT}"
export VITE_TENANT_HOST="${DEV_TENANT}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# A plain TCP connect via bash's own /dev/tcp, not curl.exe.
#
# Spawning a new curl.exe process on every poll turned out to cost far more
# than a second each under this shell — a server logging "up" and answering a
# curl run immediately afterward by hand still failed 75 straight polls
# in-loop. Bash can open the socket itself with no process spawned at all,
# which is both faster and immune to that overhead.
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3<&- 3>&-; }

wait_for() {   # wait_for <name> <host:port for /dev/tcp> <seconds>
  local name="$1" hostport="$2" secs="${3:-40}"
  local port="${hostport##*:}"
  for _ in $(seq 1 "$secs"); do
    if port_open "$port"; then return 0; fi
    sleep 1
  done
  echo "  ${name} did not answer on port ${port} within ${secs}s"
  return 1
}

start_db() {
  if docker ps --format '{{.Names}}' | grep -qx "${DB_CONTAINER}"; then
    echo "  database already running"
  else
    docker rm -f "${DB_CONTAINER}" >/dev/null 2>&1
    # No volume on purpose: "down" must leave nothing behind.
    docker run -d --rm --name "${DB_CONTAINER}" \
      -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=vibelink \
      -p "${DB_PORT}:5432" postgres:16-alpine >/dev/null
    echo "  postgres:16 on ${DB_PORT}"
  fi
  for _ in $(seq 1 40); do
    docker exec "${DB_CONTAINER}" pg_isready -U postgres -q 2>/dev/null && return 0
    sleep 1
  done
  echo "  database never became ready"; return 1
}

seed() {
  ( cd "${ROOT}/backend" && npm run migrate >/dev/null 2>&1 ) || {
    echo "  migrate failed — run it by hand to see why:"
    echo "    cd backend && DATABASE_URL='${DATABASE_URL}' npm run migrate"
    return 1
  }
  echo "  schema applied"

  ( cd "${ROOT}/backend" && node scripts/create-account.mjs \
      --email "${DEV_EMAIL}" --password "${DEV_PASSWORD}" \
      --company 'Demo ISP' --subdomain "${DEV_SUBDOMAIN}" \
      --name 'Demo Admin' --username demo --super >/dev/null 2>&1 ) || {
    echo "  could not create the admin account"; return 1; }
  echo "  tenant '${DEV_SUBDOMAIN}' and admin ${DEV_EMAIL}"

  # A plan and a hotspot bundle, because a client cannot be added without one
  # and a voucher cannot be issued without the other. Everything else the tests
  # create for themselves.
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d vibelink -q <<'SQL' >/dev/null 2>&1
insert into plans (tenant_id, service, title, price, duration_min, rate_down, rate_up, radius_profile)
select t.id, 'pppoe', 'Home 10Mbps', 1500, 43200, 10000, 5000, 'home-10'
  from tenants t where t.subdomain='demo'
    and not exists (select 1 from plans p where p.tenant_id=t.id and p.title='Home 10Mbps');
insert into plans (tenant_id, service, title, price, duration_min, rate_down, rate_up, radius_profile)
select t.id, 'hotspot', '1 Hour', 20, 60, 3000, 1000, 'hs-1h'
  from tenants t where t.subdomain='demo'
    and not exists (select 1 from plans p where p.tenant_id=t.id and p.title='1 Hour');
SQL
  echo "  seeded one PPPoE plan and one hotspot bundle"
}

start_api() {
  if port_open "${API_PORT}"; then
    echo "  API already answering on ${API_PORT}"
    return 0
  fi
  # nohup with stdin closed, or the servers die with the shell that started
  # them and "up" leaves nothing running once the terminal goes away.
  ( cd "${ROOT}/backend" && nohup node src/server.js >"${RUN_DIR}/api.log" 2>&1 </dev/null & echo $! >"${RUN_DIR}/api.pid" )
  # 75s, not 30. The API connects to Postgres and registers ten cron jobs before
  # it listens, and on a cold container that took longer than the old wait — so
  # the script reported a failure and left a working API running behind it.
  wait_for "API" "127.0.0.1:${API_PORT}" 75 || {
    echo "  last lines of ${RUN_DIR}/api.log:"; tail -5 "${RUN_DIR}/api.log"; return 1; }
  echo "  API on ${API_PORT} (log: .dev-stack/api.log)"
}

start_web() {
  if port_open "${WEB_PORT}"; then
    echo "  web already answering on ${WEB_PORT}"
    return 0
  fi
  ( cd "${ROOT}/frontend" && nohup npx vite --port "${WEB_PORT}" --strictPort --host 127.0.0.1 >"${RUN_DIR}/web.log" 2>&1 </dev/null & echo $! >"${RUN_DIR}/web.pid" )
  wait_for "web" "127.0.0.1:${WEB_PORT}" 40 || {
    echo "  last lines of ${RUN_DIR}/web.log:"; tail -5 "${RUN_DIR}/web.log"; return 1; }
  echo "  web on ${WEB_PORT} (log: .dev-stack/web.log)"
}

# Kill whatever is actually listening on a port, by the Windows PID netstat
# reports — not by the number $! recorded when the process was launched.
#
# Under this shell, $! from a backgrounded "nohup ... &" is unreliable: it can
# name an intermediate wrapper rather than node.exe or esbuild itself, so
# kill "$pid" succeeds against a process that was never the one holding the
# port. The API and web startup logged "stopped" while both kept running,
# still bound to the port the next "up" needed — which is why a "reset" left
# two vite processes alive on 5173 and 5174 at once.
#
# netstat's PID column is a fact rather than a memory of one; killing that is
# killing the thing that is actually there.
kill_port() {
  local port="$1"
  local pid
  for pid in $(netstat -ano 2>/dev/null | grep "LISTENING" | grep ":$port " | awk '{print $NF}' | sort -u); do
    cmd //c "taskkill /PID $pid /F" >/dev/null 2>&1 && echo "  stopped pid ${pid} on port ${port}"
  done
}

stop_node() {
  kill_port "${API_PORT}"
  kill_port "${WEB_PORT}"
  rm -f "${RUN_DIR}/api.pid" "${RUN_DIR}/web.pid"
}

case "${1:-up}" in
  up)
    say 'Database'; start_db || exit 1
    say 'Schema and seed data'; seed || exit 1
    say 'API'; start_api || exit 1
    say 'Web'; start_web || exit 1
    say 'Ready'
    cat <<EOF
  open      http://localhost:${WEB_PORT}
  sign in   ${DEV_EMAIL}
            ${DEV_PASSWORD}

  Throwaway data on a throwaway database. Delete, suspend and send freely —
  "down" removes the container and everything in it.
EOF
    ;;
  down)
    say 'Stopping'
    stop_node
    docker rm -f "${DB_CONTAINER}" >/dev/null 2>&1 && echo "  database removed"
    # So the next "up" searches for ports fresh rather than reusing numbers
    # that belonged to a stack which no longer exists.
    rm -f "${PORTS_FILE}"
    ;;
  reset)
    "$0" down; "$0" up
    ;;
  status)
    say 'Status'
    docker ps --filter "name=${DB_CONTAINER}" --format '  db   {{.Status}}' | grep . || echo '  db   not running'
    port_open "${API_PORT}" && echo "  api  answering on ${API_PORT}" || echo '  api  not answering'
    port_open "${WEB_PORT}" && echo "  web  answering on ${WEB_PORT}" || echo '  web  not answering'
    ;;
  *)
    echo "usage: $0 [up|down|reset|status]"; exit 1;;
esac
