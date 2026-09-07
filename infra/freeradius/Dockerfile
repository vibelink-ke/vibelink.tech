# The stock alpine image ships rlm_sql_postgresql.so but not the library it links
# against, so the module fails to instantiate with:
#   Could not link driver rlm_sql_postgresql: Error loading shared library libpq.so.5
FROM freeradius/freeradius-server:3.2.5-alpine
#
# tzdata is for the log timestamps. Without it the container is stuck on UTC
# whatever TZ says, so every authentication line reads three hours behind Kenyan
# time — and the one thing these logs get used for is lining a rejection up
# against the moment a customer said they could not connect.
#
# curl is for post-auth-hook.sh — the post-auth section's fire-and-forget
# call back to the api container to start a 'login'-mode voucher's clock.
# Not present in the base image at all.
#
# supervisor runs radiusd and radacct-purge.sh as sibling processes (see
# supervisord.conf) instead of radiusd alone as PID 1 — restarting just
# radiusd on a crash, rather than Docker recreating the whole container, and
# giving the purge loop somewhere to run without a second container of its
# own. postgresql-client is psql, for that same purge script.
RUN apk add --no-cache libpq tzdata curl supervisor postgresql-client
