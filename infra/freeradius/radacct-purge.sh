#!/bin/sh
# Deletes RADIUS accounting/auth-log rows past their retention window.
#
# radacct is mirrored into the app's own `sessions` table the moment a row is
# written (sync_session_from_radacct, schema.sql) — FUP enforcement, usage
# stats and everything else the app shows reads from `sessions`, never
# radacct directly. So radacct itself is safe to age out: nothing downstream
# loses data it still needs, it just stops being the multi-year raw RADIUS
# log FreeRADIUS would otherwise happily grow forever.
#
# radpostauth (every auth attempt, accept or reject — see entrypoint.sh's
# `auth = yes`) has no mirror anywhere; it exists purely for debugging a
# specific rejected login shortly after it happened, so the same retention
# window is more than enough for that and nothing reads it after.
#
# Active sessions (acctstoptime is null) are never touched regardless of
# start date — this only ever removes rows for a session that has already
# closed.
set -e

RETENTION_DAYS="${RADACCT_RETENTION_DAYS:-90}"
# PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE come from the container's own
# environment (docker-compose.prod.yml) — psql reads all five without being
# told to.

while true; do
  echo "radacct-purge: deleting closed radacct/radpostauth rows older than ${RETENTION_DAYS}d"
  psql -v ON_ERROR_STOP=1 -c \
    "delete from radacct where acctstoptime is not null and acctstoptime < now() - interval '${RETENTION_DAYS} days';"
  psql -v ON_ERROR_STOP=1 -c \
    "delete from radpostauth where authdate < now() - interval '${RETENTION_DAYS} days';"
  # Once a day is plenty for a purge job — sleeping in the foreground (rather
  # than a real cron daemon) is the whole process here, which is all
  # supervisord needs to keep it running as its own program.
  sleep 86400
done
