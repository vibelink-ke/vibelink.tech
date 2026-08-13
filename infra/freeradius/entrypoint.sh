#!/bin/sh
# Enable only what the billing server needs, then hand off to radiusd.
#
# The stock image ships every site and module enabled. Leaving `default` and
# `inner-tunnel` on means a request that misses our rules can still be answered
# by a default policy — which is how you end up with someone authenticating
# against a config you never wrote.
set -e

# The alpine image builds FreeRADIUS with --prefix=/opt, so the config lives in
# /opt/etc/raddb and the binary in /opt/sbin — neither is on PATH, and neither is
# where the documentation says. Resolve it rather than assuming.
RADDB=/opt/etc/raddb
[ -d "$RADDB" ] || RADDB=/etc/raddb
RADIUSD=/opt/sbin/radiusd
[ -x "$RADIUSD" ] || RADIUSD=$(command -v radiusd)

cd "$RADDB"

# Copy our config in rather than bind-mounting it. A bind mount from a Windows
# host arrives mode 0777, and FreeRADIUS refuses to load a world-writable config
# ("Refusing to start due to insecure configuration") — correctly, since anyone
# who can write it can rewrite the auth rules.
install -m 640 /config/mods-available/sql        "$RADDB/mods-available/sql"
install -m 640 /config/sites-available/billing   "$RADDB/sites-available/billing"

# Our virtual server, and nothing else.
rm -f sites-enabled/default sites-enabled/inner-tunnel

# EAP is for 802.1X/WPA-Enterprise; PPPoE and hotspot use PAP/CHAP/MSCHAP. The
# stock module is enabled by default and refuses to instantiate without an
# "Auth-Type EAP" section, which lived in the default site we just removed.
rm -f mods-enabled/eap
ln -sf ../sites-available/billing sites-enabled/billing

# SQL is the whole point; the rest are what `billing` actually references.
for m in sql expiration logintime pap chap mschap preprocess acct_unique \
         exec attr_filter suffix; do
  [ -f "mods-available/$m" ] && ln -sf "../mods-available/$m" "mods-enabled/$m"
done

# Log where Docker can see it. FreeRADIUS defaults to writing a file inside the
# container, so `docker compose logs freeradius` shows the startup banner and
# then nothing — every authentication decision, and every rejected packet, goes
# somewhere you have to exec in to read. That turns an ordinary "why was this
# request dropped" into an archaeology exercise.
sed -i 's/^\([[:space:]]*\)destination = files/\1destination = stdout/' "$RADDB/radiusd.conf"

# Fail loudly on a bad config rather than starting half-working.
"$RADIUSD" -CX >/tmp/radcheck.log 2>&1 || {
  echo "--- FreeRADIUS rejected the configuration ---"
  tail -40 /tmp/radcheck.log
  exit 1
}
echo "configuration OK"

# The compose command says `radiusd`, which is not on PATH under the /opt prefix.
if [ "$1" = "radiusd" ]; then
  shift
  set -- "$RADIUSD" "$@"
fi
exec "$@"
