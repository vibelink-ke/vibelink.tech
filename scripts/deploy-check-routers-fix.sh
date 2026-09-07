#!/bin/sh
# Run this ON THE VPS (ssh in first), from anywhere:
#   bash deploy-check-routers-fix.sh
#
# Diagnoses and fixes the "Actions dropdown does nothing" report by checking,
# at each step, whether the assumption behind it actually holds — rather than
# re-running the same rebuild command and hoping.

set -e
cd ~/vibelink.tech || { echo "Could not cd to ~/vibelink.tech — adjust the path at the top of this script."; exit 1; }

echo "=== 1. What commit is actually checked out here? ==="
git log --oneline -1
git status --short

echo
echo "=== 2. Pulling latest ==="
git fetch origin
git log --oneline HEAD..origin/master
git pull origin master
git log --oneline -1

echo
echo "=== 3. Rebuilding web with --no-cache (rules out a stale Docker layer) ==="
docker compose -f docker-compose.prod.yml build --no-cache web
docker compose -f docker-compose.prod.yml up -d web

echo
echo "=== 4. Confirming the fix is actually IN the built JS ==="
CID=$(docker compose -f docker-compose.prod.yml ps -q web)
if docker exec "$CID" sh -c "grep -rl 'Actions ▾' /srv/assets/*.js" >/dev/null 2>&1; then
  echo "FOUND: 'Actions ▾' string is present in the deployed bundle — the build includes the dropdown code."
else
  echo "NOT FOUND: 'Actions ▾' is missing from every JS file in the running container."
  echo "This means the build did not actually pick up frontend/src/screens/Routers.jsx — check the build log above for errors."
  exit 1
fi

echo
echo "=== 5. Done. Now do a HARD refresh (Ctrl+Shift+R) on the Routers page and try Actions again. ==="
