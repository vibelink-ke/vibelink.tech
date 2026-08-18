#!/usr/bin/env bash
#
# Take everything a VPS migration needs a copy of, in one run, on the server
# being moved FROM. See docs/VPS-MIGRATION.md for the full procedure this is
# one step of.
#
#   scripts/migration-snapshot.sh
#
# Read-only against the running stack: this dumps and tars, it does not
# stop, start, or modify anything. Safe to run on a live server, though the
# pg_dump briefly adds load proportional to the database's size.
#
# What it deliberately does NOT capture, and why:
#   caddy-data / caddy-config   Caddy re-issues TLS certs on demand from
#                               Let's Encrypt; carrying old ones saves
#                               nothing and risks copying something stale.
#   ovpn-run                   The OpenVPN status file, regenerated the
#                               moment the container starts.
#   .env                       Copy it yourself, over a channel that is not
#                               this script's output directory — it holds
#                               APP_SECRET_KEY and the WireGuard server key,
#                               and does not belong bundled with things that
#                               might get uploaded somewhere less careful.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${ROOT}/migration-snapshot"
rm -rf "${OUT}"
mkdir -p "${OUT}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if [ ! -f .env ]; then
  echo "No .env in ${ROOT} — run this from the same directory docker-compose.prod.yml lives in."
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

DB_CONTAINER="$(docker compose -f docker-compose.prod.yml ps -q db)"
if [ -z "${DB_CONTAINER}" ]; then
  echo "The db service is not running. Bring the stack up before taking a snapshot —"
  echo "a snapshot of a stopped database is not meaningfully different from none."
  exit 1
fi

say 'Database'
# Custom format: compressed, and pg_restore can go straight from it without
# an intermediate plain-SQL file to reason about.
docker exec "${DB_CONTAINER}" pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -F custom \
  > "${OUT}/pgdump.custom"
echo "  $(du -h "${OUT}/pgdump.custom" | cut -f1)  ${OUT}/pgdump.custom"

say 'OpenVPN PKI'
if docker volume inspect vibelinktech_billing-ovpn-pki >/dev/null 2>&1; then
  docker run --rm -v vibelinktech_billing-ovpn-pki:/from -v "${OUT}:/to" alpine \
    tar czf /to/ovpn-pki.tgz -C /from .
  echo "  $(du -h "${OUT}/ovpn-pki.tgz" | cut -f1)  ${OUT}/ovpn-pki.tgz"
  echo "  optional on restore — see docs/VPS-MIGRATION.md for why"
else
  echo "  no billing-ovpn-pki volume found (OVPN never onboarded a router here) — nothing to take"
fi

say 'The .env values that must survive unedited'
cat > "${OUT}/env-checklist.txt" <<EOF
Copy .env itself to the new server, not this file — this is only a record of
which values must arrive unchanged, so a diff after the copy is a five-second
sanity check rather than a guess.

APP_SECRET_KEY must be identical. If it is not, every router service
password, the SMTP password, and every customer's portal password become
permanently unreadable — not merely wrong, unrecoverable.

WG_SERVER_PRIVATE_KEY and WG_SERVER_PUBLIC_KEY must be identical, or every
already-onboarded WireGuard peer stops trusting the server and needs
re-onboarding, the same cost paid on every OVPN router regardless.

Present in this .env (values withheld from this file on purpose):
EOF
grep -oE '^[A-Z_]+=' .env | sed 's/=$//' >> "${OUT}/env-checklist.txt"
echo "  ${OUT}/env-checklist.txt written — the values themselves are not copied here"

say 'Done'
echo "  ${OUT}/"
echo "  Copy this directory and .env to the new server over scp or rsync, never through chat"
echo "  and never committed to the repo. Then follow docs/VPS-MIGRATION.md from step 2."
