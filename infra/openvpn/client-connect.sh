#!/bin/bash
# OpenVPN client-connect.
#
# Pins each router to the address recorded in ovpn_clients rather than letting
# OpenVPN pick from a pool. The address has to be stable: it is the router's
# nasname in the `nas` view, and the destination for RADIUS CoA. A router that
# reconnected onto a different address would silently stop receiving CoA.
set -uo pipefail

OUT="$1"
username="${common_name:-${username:-}}"

if [ -z "$username" ]; then
  echo "openvpn-connect: no username" >&2
  exit 1
fi

# OpenVPN gives its scripts a fresh environment — no PATH, no PG* settings. The
# entrypoint left them here.
# shellcheck disable=SC1091
[ -r /etc/openvpn/db.env ] && . /etc/openvpn/db.env
export PGPASSWORD="${PGPASSWORD:-secret}"

# SQL on stdin, not -c: psql substitutes :'u' only in input it reads itself.
ip=$(/usr/bin/psql -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-billing}" \
       -d "${PGDATABASE:-billing}" -tA -v u="$username" <<'SQL' 2>/dev/null
select host(assigned_ip) from ovpn_clients where username = :'u'
order by created_at desc limit 1
SQL
)

if [ -z "$ip" ]; then
  echo "openvpn-connect: no address allocated for $username" >&2
  exit 1
fi

# topology subnet: ifconfig-push takes the address and the tunnel netmask, which
# is the whole supernet, not the tenant's /24.
echo "ifconfig-push $ip 255.255.0.0" > "$OUT"
echo "openvpn-connect: $username -> $ip" >&2
exit 0
