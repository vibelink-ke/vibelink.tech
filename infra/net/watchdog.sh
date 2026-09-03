#!/bin/sh
# Keeps this namespace's default route alive no matter what openvpn or
# wireguard do to it after joining.
#
# Docker's own bridge setup puts a correct default route in place the moment
# this container starts — before openvpn or wireguard (network_mode:
# service:net) ever attach to the namespace. One of them can then clobber it:
# observed on a fresh deploy where linuxserver/wireguard's "client mode" init
# (selected whenever SERVERURL isn't set, which this deployment never sets —
# it manages wg0.conf itself via the API instead) tore the default route out
# in preparation for becoming the tunnel's own gateway, and never put
# anything back since no tunnel ever came up. The result: this whole shared
# namespace — api, freeradius, everything — lost all outbound internet
# access, and nothing in any application log pointed at a routing problem.
#
# Deliberately does not try to "catch" the original default route before
# whichever container destroys it — depends_on: condition: service_started
# fires as soon as this container's process launches, not once this script
# has actually run, so that race is not reliably winnable. Instead it
# recomputes the gateway itself every check, from the connected-subnet route
# Docker's bridge setup leaves in place regardless (e.g. "172.18.0.0/16 dev
# eth0 ... src 172.18.0.4"), which survives even when the default route
# doesn't — Docker's default bridge networks always put the gateway at the
# first address in that subnet.
set -eu

gateway() {
  ip -4 route show dev eth0 scope link \
    | awk '{ split($1, net, "/"); split(net[1], oct, "."); print oct[1]"."oct[2]"."oct[3]".1"; exit }'
}

while true; do
  if ! ip route show default | grep -q .; then
    gw=$(gateway)
    if [ -n "$gw" ]; then
      echo "net watchdog: default route missing — restoring via $gw"
      ip route add default via "$gw" dev eth0 2>&1 || echo "net watchdog: restore failed, will retry"
    else
      echo "net watchdog: default route missing and could not determine eth0's gateway yet"
    fi
  fi
  sleep 5
done
