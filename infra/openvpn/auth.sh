#!/bin/bash
# OpenVPN auth-user-pass-verify, via-file.
#
# $1 is a temp file: line 1 username, line 2 password. Exit 0 accepts.
#
# Credentials come from ovpn_clients, which the app fills when you press
# "Onboard via OVPN". The stored value is a pgcrypto hash, so a database dump does
# not hand someone every router's tunnel password.
set -uo pipefail

CREDS="$1"
username=$(sed -n 1p "$CREDS")
password=$(sed -n 2p "$CREDS")

if [ -z "$username" ] || [ -z "$password" ]; then
  echo "openvpn-auth: empty credentials" >&2
  exit 1
fi

# OpenVPN runs this with an environment of its own making — no PATH, none of the
# PG* settings. The entrypoint left them here.
# shellcheck disable=SC1091
[ -r /etc/openvpn/db.env ] && . /etc/openvpn/db.env
export PGPASSWORD="${PGPASSWORD:-secret}"

# Absolute path for the same reason: PATH may be empty.
PSQL=/usr/bin/psql

psql_q() {
  # SQL goes in on stdin, never through -c: psql only substitutes :'name'
  # variables in input it reads itself, and silently leaves a -c string alone.
  # -v with :'name' lets psql quote the values, so a username cannot break out
  # into SQL of its own.
  "$PSQL" -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-billing}" \
       -d "${PGDATABASE:-billing}" -tA -v ON_ERROR_STOP=1 "$@"
}

ok=$(psql_q -v u="$username" -v p="$password" <<'SQL' 2>/dev/null
select 1 from ovpn_clients
 where username = :'u'
   and password_hash is not null
   and password_hash = crypt(:'p', password_hash)
 limit 1
SQL
)

if [ "$ok" = "1" ]; then
  # Note the connection; the Routers screen shows it as last seen.
  psql_q -q -v u="$username" >/dev/null 2>&1 <<'SQL'
update ovpn_clients set connected_at = now() where username = :'u'
SQL
  echo "openvpn-auth: accepted $username" >&2
  exit 0
fi

# Recorded, not just logged. A revoked or mistyped credential makes RouterOS
# retry for ever, and until this existed the only trace was a line in a
# container log nobody reads — the router just showed as down with no reason.
psql_q -q -v u="$username" >/dev/null 2>&1 <<'SQL'
insert into ovpn_auth_failures (username) values (:'u')
SQL

echo "openvpn-auth: rejected $username" >&2
exit 1
