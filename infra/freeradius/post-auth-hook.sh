#!/bin/sh
# Called from sites-available/billing's post-auth section, once per
# successful auth (PPPoE or hotspot — FreeRADIUS has no way to tell them
# apart before this runs). $1 is the RADIUS username; for a hotspot login
# that is a voucher code, which is the only case the endpoint itself
# actually does anything with — a PPPoE username matches no voucher and the
# call is a harmless no-op there.
#
# freeradius shares the same network namespace as the api container
# (both network_mode: 'service:net'), so the api's own port is reachable
# on localhost here — no service name or DNS involved.
#
# Backgrounded (the trailing &) so a slow or unreachable API can never delay
# the RADIUS response a device is waiting on; this is a side effect of
# auth, never a precondition for it.
curl -s -m 3 -X POST "http://localhost:8080/radius/post-auth" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$1\"}" >/dev/null 2>&1 &
