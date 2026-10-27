#!/bin/bash
# Deploy: pull, rebuild api and web, and bring the stack up so nothing is left on a stale network.
# api, openvpn, freeradius and wireguard share the `net` container's network (network_mode: service:net). If `net` is
# recreated, anything left running from before loses its network (DNS to `db` fails, radius stops answering), so they are
# recreated together with it (only when net itself changed, so a normal deploy does not drop the router tunnels). Run from the project folder:  bash scripts/deploy.sh
set -e
F="-f docker-compose.yml -f docker-compose.prod.yml"
git pull --no-rebase
docker compose $F build api web
before=$(docker inspect -f '{{.Id}}' billing-net 2>/dev/null || echo none)
docker compose $F up -d net
after=$(docker inspect -f '{{.Id}}' billing-net)
if [ "$before" != "$after" ]; then
  echo "net was recreated: recreating everything that shares its network (routers reconnect in a minute or two)"
  docker compose $F up -d --force-recreate wireguard openvpn freeradius api
else
  docker compose $F up -d api
fi
docker compose $F up -d web
echo "waiting for the api to be healthy..."
i=0
while [ $i -lt 30 ]; do
  s=$(docker inspect -f '{{.State.Health.Status}}' billing-api 2>/dev/null || echo none)
  [ "$s" = "healthy" ] && break
  i=$((i+1)); sleep 5
done
docker compose $F ps
echo "api health: $s"
docker logs --tail 5 billing-api
[ "$s" = "healthy" ] || { echo "The api is not healthy. Check: docker logs --tail 50 billing-api"; exit 1; }
