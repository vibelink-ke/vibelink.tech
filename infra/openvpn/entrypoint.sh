#!/bin/bash
# Generate the server PKI on first run, then hand off to openvpn.
#
# Even with verify-client-cert none, OpenVPN needs a CA, a server certificate and
# DH parameters for the TLS handshake — routers authenticate with a password, but
# the tunnel itself is still TLS.
set -euo pipefail

# The status file lives here so the API can read which routers are connected.
# Created rather than assumed: OpenVPN refuses to start at all if the directory
# is missing ("--status fails ... No such file or directory"), which takes the
# whole tunnel down over a diagnostic file. A compose file without the volume
# still works; the status is just not shared.
mkdir -p /run/openvpn

PKI=/etc/openvpn/pki

if [ ! -f "$PKI/server.crt" ]; then
  echo "no PKI found — generating one (first run only, DH takes a minute)"
  mkdir -p "$PKI"

  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$PKI/ca.key" -out "$PKI/ca.crt" \
    -subj "/CN=vibelink-tunnel-ca" 2>/dev/null

  openssl req -nodes -newkey rsa:2048 \
    -keyout "$PKI/server.key" -out "$PKI/server.csr" \
    -subj "/CN=vibelink-tunnel" 2>/dev/null

  openssl x509 -req -in "$PKI/server.csr" -days 3650 \
    -CA "$PKI/ca.crt" -CAkey "$PKI/ca.key" -CAcreateserial \
    -out "$PKI/server.crt" \
    -extfile <(printf "keyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth") 2>/dev/null

  # 2048-bit DH is the practical floor; higher takes minutes for no real gain here.
  openssl dhparam -out "$PKI/dh.pem" 2048 2>/dev/null

  rm -f "$PKI/server.csr"
  chmod 600 "$PKI"/*.key
  echo "PKI generated"
fi

# Keep the digest in one place. The generated MikroTik script reads the same
# variable, so the two ends cannot drift apart and leave tunnels dying straight
# after authentication.
if [ -n "${OVPN_AUTH_DIGEST:-}" ]; then
  digest=$(printf '%s' "$OVPN_AUTH_DIGEST" | tr '[:lower:]' '[:upper:]')
  sed -i "s/^auth .*/auth ${digest}/" /etc/openvpn/server.conf
  echo "auth digest set to ${digest}"
fi

# The tun device has to exist inside the container.
mkdir -p /dev/net
[ -c /dev/net/tun ] || mknod /dev/net/tun c 10 200
chmod 600 /dev/net/tun

# Reaching routers on the far side of the tunnel needs forwarding on.
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || \
  echo "could not enable ip_forward (needs --privileged or a sysctl in compose)"

# Per-tenant tunnel isolation. client-to-client (server.conf) is now on, which
# on its own would let every connected peer — every router, every tenant's
# staff laptop — reach every other one. This chain is what actually stops
# that: a default DROP for all tun-to-tun traffic, with client-connect.sh
# punching a narrow ACCEPT (this staff peer's IP <-> this tenant's own router
# IPs, nothing wider) the moment a staff peer connects, and
# client-disconnect.sh removing it the moment they leave.
#
# Rebuilt from scratch on every start rather than preserved: a restart drops
# every existing tunnel anyway, so there is nothing valid left to keep, and
# starting clean means a leftover rule from a bug can never survive a restart.
if command -v iptables >/dev/null 2>&1; then
  # Every line here needs `|| true`, not just `2>/dev/null` — under `set -e`
  # (line 7) a redirected-but-nonzero exit still kills the script. -F fails on
  # the very first run (chain doesn't exist yet); -N fails on every run after
  # that (chain already does). Both are expected, not errors, but without
  # `|| true` the container died on this line on every single start — taking
  # every router's tunnel down with it, platform-wide, not just one tenant's.
  iptables -F VIBELINK_TUNNEL_ISOLATION 2>/dev/null || true
  iptables -N VIBELINK_TUNNEL_ISOLATION 2>/dev/null || true
  iptables -D FORWARD -i tun0 -o tun0 -j VIBELINK_TUNNEL_ISOLATION 2>/dev/null || true
  iptables -I FORWARD 1 -i tun0 -o tun0 -j VIBELINK_TUNNEL_ISOLATION || true
  iptables -A VIBELINK_TUNNEL_ISOLATION -j DROP || true
  # The -I/-A steps above are the ones that actually matter — if either was
  # silently swallowed by `|| true`, client-to-client is on with no isolation
  # behind it, which is worse than not having the feature. Loud on failure,
  # rather than a platform quietly running open between tenants.
  if iptables -C FORWARD -i tun0 -o tun0 -j VIBELINK_TUNNEL_ISOLATION 2>/dev/null \
     && iptables -C VIBELINK_TUNNEL_ISOLATION -j DROP 2>/dev/null; then
    echo "tunnel isolation chain ready (default deny, per-connection holes only)"
  else
    echo "WARNING: tunnel isolation chain did not verify — client-to-client is on" \
         "and peers may be able to reach across tenants. Do not issue staff VPN" \
         "peers until this is investigated." >&2
  fi
else
  echo "iptables not available — tunnel isolation chain NOT set up; " \
       "client-to-client is on, so do not issue staff VPN peers until this is fixed" >&2
fi

# OpenVPN does not hand its own environment to auth.sh and client-connect.sh — it
# builds a fresh one holding only the variables it defines, so PATH and every PG*
# setting would be missing there. Snapshot them to a file the scripts source.
cat > /etc/openvpn/db.env <<ENV
PGHOST=${PGHOST:-db}
PGPORT=${PGPORT:-5432}
PGUSER=${PGUSER:-billing}
PGPASSWORD=${PGPASSWORD:-secret}
PGDATABASE=${PGDATABASE:-billing}
ENV
chmod 600 /etc/openvpn/db.env

# Fail fast on an unreachable database rather than rejecting every router later.
export PGPASSWORD="${PGPASSWORD:-secret}"
until psql -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-billing}" \
        -d "${PGDATABASE:-billing}" -c 'select 1' >/dev/null 2>&1; do
  echo "waiting for the database…"
  sleep 2
done
echo "database reachable"

exec "$@"
