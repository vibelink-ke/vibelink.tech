#!/bin/sh
# Enable only what the billing server needs, then hand off to radiusd.
#
# The stock image ships every site and module enabled. Leaving `default` and
# `inner-tunnel` on means a request that misses our rules can still be answered
# by a default policy — which is how you end up with someone authenticating
# against a config you never wrote.
set -e

cd /etc/raddb

# Our virtual server, and nothing else.
rm -f sites-enabled/default sites-enabled/inner-tunnel
ln -sf ../sites-available/billing sites-enabled/billing

# SQL is the whole point; the rest are what `billing` actually references.
for m in sql expiration logintime pap chap mschap preprocess acct_unique \
         exec attr_filter suffix; do
  [ -f "mods-available/$m" ] && ln -sf "../mods-available/$m" "mods-enabled/$m"
done

# Fail loudly on a bad config rather than starting half-working.
radiusd -CX >/tmp/radcheck.log 2>&1 || {
  echo "--- FreeRADIUS rejected the configuration ---"
  tail -40 /tmp/radcheck.log
  exit 1
}
echo "configuration OK"

exec "$@"
