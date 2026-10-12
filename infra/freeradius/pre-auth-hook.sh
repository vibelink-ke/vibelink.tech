#!/bin/sh
# Called from sites-available/billing's authorize section, BEFORE the router is told yes, for a hotspot login where this phone
# already has an open session on the same code. $1 = RADIUS username (the code), $2 = Calling-Station-Id (the phone's MAC),
# $3 = the router's address as FreeRADIUS sees it.
#
# The router decides on "already logged in" the moment it receives our answer. A phone that rejoined the Wi-Fi on a new address
# still has its old session listed, so the router refused the new login. This clears that old session first (the API only touches
# a session of the SAME phone on an address it no longer holds). Not backgrounded on purpose: it must finish before the answer goes
# out. The five-second limit means a slow or unreachable API can only ever delay a login by that much, never block it.
curl -s -m 5 -X POST "http://localhost:8080/radius/pre-auth" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$1\",\"mac\":\"$2\",\"nas\":\"$3\"}" >/dev/null 2>&1
exit 0
