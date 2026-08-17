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

# Log the decision itself, not just that a request happened. FreeRADIUS ships
# with `auth = no`, so an Access-Reject leaves no trace whatsoever: the router
# reports "authentication failed", the server log stays empty, and there is
# nothing to tell a wrong password apart from a wrong shared secret or a missing
# user. Turning this on is what makes the reject state its own reason.
#
# auth_badpass stays off deliberately — it writes the attempted password to the
# log in clear, and these logs are read casually over `docker compose logs`.
sed -i 's/^\([[:space:]]*\)auth = no/\1auth = yes/' "$RADDB/radiusd.conf"

# Scope credential lookups to the tenant that owns the router the request came
# from. Both matching lines are the radcheck and radreply authorize queries.
#
# Edited here rather than overridden in mods-available/sql: FreeRADIUS keeps the
# FIRST definition of a config item, so an assignment placed after the $INCLUDE
# of queries.conf is silently ignored. It looks correct, starts cleanly, and
# leaves the stock username-only query running -- which is how a cross-tenant
# lookup can survive a test that appears to pass.
#
# Without the filter the match is on username alone across the whole platform.
# Two ISPs both numbering customers from 10001 share credentials, and the row
# with the lower id wins whichever router asked.
#
# An address with no router row yields no tenant, the comparison is false, and
# nothing matches -- an unknown NAS authenticates nobody.
QUERIES="$RADDB/mods-config/sql/main/postgresql/queries.conf"

# Strip any previous patch first. queries.conf is part of the image and survives
# a container restart, unlike the files installed from /config, so without this
# the sed stacks another copy of the filter onto the same query every time the
# container restarts. The count check below caught exactly that.
sed -i '/AND tenant_id = (SELECT tenant_id FROM routers/d' "$QUERIES"

sed -i "s|^\(\s*\)WHERE Username = '%{SQL-User-Name}' \\\\$|\1WHERE Username = '%{SQL-User-Name}' \\\\\n\1AND tenant_id = (SELECT tenant_id FROM routers WHERE host(host) = '%{Packet-Src-IP-Address}' LIMIT 1) \\\\|" "$QUERIES"

grep -c "AND tenant_id = (SELECT tenant_id FROM routers" "$QUERIES" | {
  read -r n
  [ "$n" -eq 2 ] || { echo "FATAL: tenant scoping patched $n queries, expected 2"; exit 1; }
  echo "tenant scoping applied to $n queries"
}

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
