# Moving Vibelink to a new VPS

Written for: same domain (`vibelink.tech` and its subdomains), a new server,
most likely a new public IP. If the domain itself is also changing, stop and
say so before following this — several steps below assume it is not.

Read the whole thing before starting. Two things here are not obvious from
the code, and getting them wrong is expensive:

- **`APP_SECRET_KEY` must be copied byte-for-byte, never regenerated.** It is
  the only key decrypting every router's stored service-account password, the
  SMTP password, and every customer's self-service portal password — all
  sitting encrypted in the database dump you are about to restore. A new key
  on the new server does not lock you out gently; it makes that data
  permanently unreadable, with no recovery.
- **Every router onboarded via OVPN dials a pinned IP address, not a
  hostname.** DNS pointing at the new server will not reconnect them. Each one
  needs a fresh script — Routers → that credential → Revoke → **+ Onboard via
  OVPN** again — pasted onto the router by hand. Budget for that as real,
  unavoidable per-router work, remote or on site, not something this move can
  script away.

WireGuard-onboarded routers do not have this problem if `WG_ENDPOINT` is set
to the hostname rather than a bare IP — RouterOS re-resolves it. Verify a
handshake after cutover rather than assuming; this is expected to survive,
not guaranteed to.

## What has to move

| What | Where it lives | How it moves |
|---|---|---|
| Everything about every tenant, subscriber, router, payment, RADIUS credential, encrypted secret | the `billing-pgdata` Postgres volume | `pg_dump` / `pg_restore` |
| `APP_SECRET_KEY`, `POSTGRES_*`, `WG_SERVER_PRIVATE_KEY`, `WG_SERVER_PUBLIC_KEY`, `WG_ENDPOINT`, `ROOT_DOMAIN`, `ACME_EMAIL` | `.env` next to `docker-compose.prod.yml` | copy the file itself, unedited, over a channel that is not this chat |
| The OpenVPN CA/server cert | `billing-ovpn-pki` volume | worth bringing along, but not load-bearing — see below |
| TLS certificates Caddy has already issued | `caddy-data` volume | **skip.** Caddy re-issues automatically from Let's Encrypt on first request; carrying old certs saves nothing and risks copying something stale |
| The OpenVPN status file | `ovpn-run` volume | **skip.** Regenerated the moment OpenVPN starts |

### Why the OVPN CA is optional

`connect-to=... certificate=none` is what every router's onboarding script
sends — no client certificate, and nothing in that script names a CA to
trust the server against. Authentication is the username/password pair
already sitting in `ovpn_clients` in the database, which the `pg_restore`
above already carries. A freshly generated CA on the new box works with
those same credentials. Bring the volume anyway; it costs one command and
removes any doubt, but if it is lost, nothing here goes on fire because of
it — only `APP_SECRET_KEY` is the one that does.

## The window

Plan for downtime, not a live cutover. The size of this deployment does not
justify the complexity of a dual-write migration, and a clean stop-copy-start
is far easier to reason about and roll back if something goes wrong partway.

Expect **5–15 minutes of API downtime** — a `pg_dump` on a database this size
is fast, and PPPoE customers already online keep their sessions since nothing
about their live RADIUS session depends on the API being reachable in that
moment. New sign-ins and payments during the window queue up or bounce; tell
the customer support inbox to expect a short gap.

## Steps

**1. On the old VPS — take the snapshot.**

```bash
cd ~/vibelink.tech
bash scripts/migration-snapshot.sh
```

This writes `migration-snapshot/` containing a `pg_dump`, a tarball of the
OVPN PKI volume, and a checklist of the `.env` values that must survive
unedited. It does not touch anything running; it only reads.

**2. Copy the snapshot and `.env` to the new VPS**, over `scp` or `rsync` —
never through this chat, and never committed to the repo.

```bash
scp -r migration-snapshot/ .env new-vps:~/vibelink.tech-migration/
```

**3. On the new VPS — clone the repo and place the files.**

```bash
git clone https://github.com/vibelink-ke/vibelink.tech.git
cd vibelink.tech
cp ~/vibelink.tech-migration/.env .
# Confirm ROOT_DOMAIN and ACME_EMAIL are what you expect before continuing —
# everything else in .env should need no editing if the domain is not moving.
```

**4. Bring up only the database, and restore into it.**

```bash
docker compose -f docker-compose.prod.yml up -d db
# wait for it to report healthy:
docker compose -f docker-compose.prod.yml ps db
docker exec -i billing-db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < ~/vibelink.tech-migration/pgdump.custom
```

**5. Restore the OVPN PKI volume** (optional, per the note above — skip if
you would rather let it regenerate):

```bash
docker volume create vibelinktech_billing-ovpn-pki
docker run --rm -v vibelinktech_billing-ovpn-pki:/to \
  -v ~/vibelink.tech-migration/ovpn-pki.tgz:/pki.tgz alpine \
  sh -c "tar xzf /pki.tgz -C /to"
```

**6. Bring the rest of the stack up.**

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

**7. Point DNS at the new server** — the `A` record(s) for `vibelink.tech`
and `*.vibelink.tech`. Caddy's on-demand TLS issues certificates the moment a
request actually arrives at a hostname it recognises, so the first real visit
after DNS propagates will take a few seconds longer while that happens; every
one after is instant.

**8. Re-run WireGuard sync**, so any already-onboarded WireGuard peers are
written into the new server's config from the restored database:

```bash
docker compose -f docker-compose.prod.yml exec api node scripts/wg-sync.mjs
docker compose -f docker-compose.prod.yml restart wireguard
```

**9. Verify before telling anyone it is done:**

```bash
curl -s https://vibelink.tech/api/version
docker compose -f docker-compose.prod.yml logs --tail 50 openvpn
docker compose -f docker-compose.prod.yml logs --tail 50 freeradius
```

Sign in to the admin portal, open Routers, and check the Dashboard's ONLINE
NOW figure looks sane against what you expect.

**10. Re-onboard OVPN routers.** For each router that was reachable over
OVPN before the move: Routers → Revoke its credential → **+ Onboard via
OVPN** → paste the new script on the router. This is the one piece of real
per-router work this migration costs; there is no way around it given how
the tunnel is pinned.

**11. Once everything is confirmed working on the new server**, decommission
the old VPS. Not before — keep it as a fallback until you have watched a full
day of automation runs (RADIUS accounting, invoicing, reminders) succeed on
the new one.

## If something goes wrong mid-migration

The old VPS is untouched by any of the steps above until you point DNS away
from it (step 7) and decommission it (step 11) — nothing here is destructive
to the source. If the new server does not come up cleanly, point DNS back and
you are exactly where you started.
