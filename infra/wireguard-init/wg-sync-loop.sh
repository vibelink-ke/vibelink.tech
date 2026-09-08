#!/usr/bin/with-contenv bash
#
# The api container writes /config/wg_confs/wg0.conf whenever a peer is
# created or deleted (wireguard.js's syncServer), but writing the file was
# never the same as the live wg0 interface knowing about it — this
# container is the only one with wg0 in its network namespace, and nothing
# ran `wg syncconf` here automatically. A router handed a fresh peer script
# would dial an interface that had never heard of its key, and the
# handshake just never completed — the exact failure this loop closes.
#
# Runs forever in the background so the image's own entrypoint still owns
# bringing wg0 up at boot; this only keeps it in sync afterwards. Also
# drops peer handshake/traffic stats to a file the api container already
# has mounted (the same host directory, /config/wg_confs on both sides),
# since `wg show` only ever means anything from inside this container.
(
  while true; do
    if [ -f /config/wg_confs/wg0.sync.conf ] && command -v wg >/dev/null 2>&1; then
      # wireguard.js's syncServer() writes this — already in the bare
      # [Interface]/[Peer] shape `wg syncconf` understands, and unlike
      # wg-quick strip on wg0.conf itself, it already includes a real
      # [Peer] block for every peer, including ones renderServerConfig
      # deliberately keeps out of wg0.conf's own static blocks (see its
      # own comment for why). Stripping wg0.conf here instead used to undo
      # any fix to that gap every 15 seconds, regardless of what the api
      # side did — this file is the one place both sides agree on.
      wg syncconf wg0 /config/wg_confs/wg0.sync.conf 2>/dev/null

      # syncconf never touches the kernel routing table — each peer's own
      # /32 AllowedIPs is also its tunnel address, and needs an explicit
      # route or nothing on this side can ever address a packet back to it.
      grep '^AllowedIPs' /config/wg_confs/wg0.sync.conf 2>/dev/null \
        | sed 's/^AllowedIPs = //' \
        | while read -r cidr; do
            [ -n "$cidr" ] && ip route replace "$cidr" dev wg0 metric 100 2>/dev/null
          done
    elif [ -f /config/wg_confs/wg0.conf ] && command -v wg >/dev/null 2>&1; then
      # Fallback only — correct for a plain WireGuard-only peer, but
      # silently drops any peer kept out of a static [Peer] block on
      # purpose. Only ever hit right after an upgrade, before the api
      # container has run syncServer() once to produce wg0.sync.conf above.
      wg-quick strip /config/wg_confs/wg0.conf > /tmp/wg0.stripped.conf 2>/dev/null \
        && wg syncconf wg0 /tmp/wg0.stripped.conf 2>/dev/null
    fi

    if [ -f /config/wg_confs/wg0.conf ] || [ -f /config/wg_confs/wg0.sync.conf ]; then
      {
        printf '['
        first=1
        wg show wg0 dump 2>/dev/null | tail -n +2 | while IFS="$(printf '\t')" \
          read -r pubkey _psk _endpoint _allowed handshake rx tx _keepalive; do
          [ "$first" = 1 ] || printf ','
          first=0
          printf '{"publicKey":"%s","latestHandshake":%s,"rxBytes":%s,"txBytes":%s}' \
            "$pubkey" "${handshake:-0}" "${rx:-0}" "${tx:-0}"
        done
        printf ']'
      } > /config/wg_confs/status.json.tmp 2>/dev/null \
        && mv /config/wg_confs/status.json.tmp /config/wg_confs/status.json
    fi
    sleep 15
  done
) &
