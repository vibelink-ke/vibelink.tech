#!/bin/bash
# OpenVPN client-disconnect.
#
# The other half of client-connect.sh's per-tenant tunnel isolation: whatever
# firewall hole was punched for a staff peer's laptop <-> their own tenant's
# routers is removed the moment they disconnect, so a stale ACCEPT rule can
# never outlive the peer it was opened for. A router peer never had a hole to
# begin with, so this is a no-op for one.
set -uo pipefail

username="${common_name:-${username:-}}"
[ -z "$username" ] && exit 0

# shellcheck disable=SC1091
[ -r /etc/openvpn/db.env ] && . /etc/openvpn/db.env
export PGPASSWORD="${PGPASSWORD:-secret}"

command -v iptables >/dev/null 2>&1 || exit 0

ip=$(/usr/bin/psql -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-billing}" \
       -d "${PGDATABASE:-billing}" -tA -v u="$username" <<'SQL' 2>/dev/null
select host(assigned_ip) from ovpn_clients where username = :'u' order by created_at desc limit 1
SQL
)
[ -z "$ip" ] && exit 0

router_ips=$(/usr/bin/psql -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-billing}" \
       -d "${PGDATABASE:-billing}" -tA -v u="$username" <<'SQL' 2>/dev/null
select host(r.host) from ovpn_clients c
  join routers r on r.tenant_id = c.tenant_id
 where c.username = :'u'
SQL
)

for rip in $router_ips; do
  [ -z "$rip" ] && continue
  iptables -D VIBELINK_TUNNEL_ISOLATION -s "$ip" -d "$rip" -j ACCEPT 2>/dev/null || true
  iptables -D VIBELINK_TUNNEL_ISOLATION -s "$rip" -d "$ip" -j ACCEPT 2>/dev/null || true
done
echo "openvpn-disconnect: closed tunnel holes for $username ($ip)" >&2

# The other half of client-connect.sh's route override: hand the /32 back
# rather than leaving it pointed at a tun0 that no longer carries it. If
# this router still has an enabled WireGuard peer, restore its route so a
# recovered WireGuard tunnel is actually usable again the moment it
# reconnects; otherwise just drop the override and let it fall through to
# whatever broader route exists.
if command -v ip >/dev/null 2>&1; then
  wg_enabled=$(/usr/bin/psql -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-billing}" \
         -d "${PGDATABASE:-billing}" -tA -v ip="$ip" <<'SQL' 2>/dev/null
select 1 from wg_peers where host(assigned_ip) = :'ip' and enabled limit 1
SQL
  )
  if [ -n "$wg_enabled" ]; then
    ip route replace "$ip/32" dev wg0 2>/dev/null \
      && echo "openvpn-disconnect: restored $ip to wg0" >&2
  else
    ip route del "$ip/32" dev tun0 2>/dev/null || true
  fi
fi
exit 0
