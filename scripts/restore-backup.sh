#!/usr/bin/env bash
# Restore a database backup made by backend/src/backup.js.
#
#   scripts/restore-backup.sh list            what is on this server
#   scripts/restore-backup.sh now             take a backup right now
#   scripts/restore-backup.sh copy [file]     copy a backup out to this directory
#   scripts/restore-backup.sh restore <file>  REPLACE the live database with it
#
# <file> is a path inside the api container, e.g. /backups/daily/vibelink-2026-09-19.dump
# Run from the project directory on the server.
set -euo pipefail

DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
cmd="${1:-list}"

case "$cmd" in
  list)
    $DC exec api sh -c 'ls -lh /backups/daily /backups/weekly 2>/dev/null || echo "no backups yet"'
    ;;
  now)
    $DC exec api node -e "import('./src/backup.js').then(m => m.dbBackup()).then(() => console.log('backup ok'), e => { console.error('backup FAILED:', e.message); process.exit(1); })"
    ;;
  copy)
    file="${2:-}"
    if [ -z "$file" ]; then
      file="$($DC exec -T api sh -c 'ls -1t /backups/daily/*.dump | head -1' | tr -d '\r')"
    fi
    $DC cp "api:$file" .
    echo "copied $(basename "$file") to $(pwd)"
    ;;
  restore)
    file="${2:?give the backup path, see: $0 list}"
    echo "This REPLACES the live database with $file."
    echo "Everything entered since that backup will be lost."
    read -r -p "Type RESTORE to continue: " answer
    [ "$answer" = "RESTORE" ] || { echo "cancelled"; exit 1; }
    # Take a safety copy of the current state first, so a wrong choice is undoable.
    $DC exec api node -e "import('./src/backup.js').then(m => m.dbBackup())" || true
    $DC stop api
    $DC run --rm --no-deps --entrypoint sh api -c \
      "pg_restore --clean --if-exists --no-owner -d \"\$DATABASE_URL\" '$file'"
    $DC up -d api
    echo "restored from $file"
    ;;
  *)
    echo "usage: $0 list | now | copy [file] | restore <file>"; exit 1;;
esac
