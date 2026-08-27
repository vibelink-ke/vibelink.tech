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

# WireGuard installs a /32 route for this same address the moment its peer
# is configured — regardless of whether that peer's tunnel is actually up —
# and a /32 always outranks tun0's own /16 supernet route by longest-prefix
# match. Without this, a router that failed over to OVPN because WireGuard
# died still had every server-initiated packet routed straight back into
# the dead WireGuard tunnel: OpenVPN's control channel would show it
# connected while nothing — not a ping, not a RouterOS API call — could
# actually reach it. `route replace`, not `route add`, so this overwrites
# that entry at the same prefix rather than leaving two /32s to the same
# address arbitrating by metric.
if command -v ip >/dev/null 2>&1; then
  if ip route replace "$ip/32" dev tun0 2>/dev/null; then
    echo "openvpn-connect: routed $ip via tun0 (overriding any stale wg0 route)" >&2
  else
    echo "openvpn-connect: could not set route for $ip via tun0 — non-fatal, but RouterOS API calls to it may hang" >&2
  fi
fi

# Per-tenant tunnel isolation. client-to-client is on (server.conf) so a
# staff peer's laptop can reach its own tenant's routers — but on its own
# that would let it, and every other peer, reach everyone's. A router peer
# gets no hole: it only ever needs the server itself, which ordinary routing
# already provides regardless of this chain. Never allowed to fail the
# connection itself — a firewall-rule hiccup must cost this feature, not the
# router tunnels the whole platform depends on.
kind=$(/usr/bin/psql -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-billing}" \
       -d "${PGDATABASE:-billing}" -tA -v u="$username" <<'SQL' 2>/dev/null
select kind from ovpn_clients where username = :'u' order by created_at desc limit 1
SQL
)

if [ "$kind" = "staff" ] && command -v iptables >/dev/null 2>&1; then
  router_ips=$(/usr/bin/psql -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-billing}" \
       -d "${PGDATABASE:-billing}" -tA -v u="$username" <<'SQL' 2>/dev/null
select host(r.host) from ovpn_clients c
  join routers r on r.tenant_id = c.tenant_id
 where c.username = :'u'
SQL
  )
  for rip in $router_ips; do
    [ -z "$rip" ] && continue
    iptables -I VIBELINK_TUNNEL_ISOLATION 1 -s "$ip" -d "$rip" -j ACCEPT 2>/dev/null || true
    iptables -I VIBELINK_TUNNEL_ISOLATION 1 -s "$rip" -d "$ip" -j ACCEPT 2>/dev/null || true
    echo "openvpn-connect: opened $ip <-> $rip (staff tunnel access for $username)" >&2
  done
fi

exit 0
