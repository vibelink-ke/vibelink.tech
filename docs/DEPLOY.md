# Putting Vibelink on a public server

Everything on your laptop works, but nothing outside your house can reach it.
Two things need that to change:

- **Routers.** A MikroTik dials *out* to the tunnel, so it never needs a public
  IP of its own — but it has to have something to dial.
- **Payments.** Daraja and KopoKopo confirm a payment by POSTing to a webhook.
  The STK prompt reaches the customer's handset either way; without a reachable
  `BASE_URL` the confirmation never arrives and the payment sits pending
  forever. `backend/src/server.js` already warns about this at STK time.

A home connection cannot serve either. Kenyan consumer lines are almost always
CGNAT — no inbound connections at all — and the address changes anyway.

---

## 1. The server

A small VPS is enough. This is control traffic and a database, not customer
bandwidth: subscriber traffic never touches it.

| | Minimum | Comfortable |
|---|---|---|
| vCPU | 1 | 2 |
| RAM | 1 GB | 2 GB |
| Disk | 20 GB | 40 GB |

`radacct` is the only table that grows quickly, and nothing prunes it yet.

**Where.** Latency to Nairobi matters for the CoA round trip, not much else.
Hetzner (Falkenstein) and DigitalOcean (Frankfurt/Amsterdam) are ~150 ms away
and cheap. A Nairobi host — Angani, Safaricom Cloud, EAC Directory — is ~5 ms
and better if you can. Any of them is fine.

**Ubuntu 24.04 LTS** or **Debian 12** both work. The only difference that bites:
Debian does not ship `ufw`, so install it before the firewall step.

> You create the account and the server yourself — that part needs your payment
> details and nobody else should be entering them.

---

## 2. DNS

`vibelink.tech` currently resolves to nothing at all, so start here. At your
registrar, point the domain's nameservers at a DNS provider (Cloudflare's free
tier is fine), then add:

| Type | Name | Value |
|---|---|---|
| A | `@` | your VPS IP |
| A | `*` | your VPS IP |

The wildcard is what makes tenants work: `tenantByHost()` reads the first label
of the hostname, so `acme.vibelink.tech` is the tenant whose subdomain is
`acme`, and the apex is the platform-owner tenant.

If you use Cloudflare, set both records to **DNS only** (grey cloud). Orange-cloud
proxying breaks Let's Encrypt's HTTP-01 check and hides the real client IP.

Confirm before continuing — DNS has to be live for certificates to issue:

```bash
dig +short vibelink.tech
dig +short anything.vibelink.tech
```

Both must print your VPS IP.

---

## 3. Prepare the server

SSH in as root, then make a user so you are not deploying as root. Do this
**before** installing Docker — the install line adds this user to the `docker`
group, and that fails if the user does not exist yet:

```bash
adduser vibelink && usermod -aG sudo vibelink
```

Install Docker:

```bash
curl -fsSL https://get.docker.com | sh && usermod -aG docker vibelink
```

On Debian, install the firewall first (Ubuntu already has it):

```bash
apt-get install -y ufw
```

Open only what is needed. Allowing 22 in the same breath as `enable` is what
stops you locking yourself out of your own SSH session:

```bash
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 1194/tcp && ufw allow 51820/udp && ufw --force enable
```

What each is for: 22 SSH, 80 Let's Encrypt validation (it cannot use 443 to get
the first certificate), 443 the app, 1194 the OVPN tunnel, 51820 WireGuard.

**Leave 1812/1813 closed here.** RADIUS should only ever be reachable through
the tunnel, and the compose file publishes those ports on the host. Restrict
them to the tunnel supernet once routers are on:

```bash
ufw allow from 10.50.0.0/16 to any port 1812,1813 proto udp
```

---

## 4. Deploy

```bash
git clone https://github.com/vibelink-ke/vibelink.tech.git && cd vibelink.tech
```

```bash
cp .env.production.example .env
```

Edit `.env`. Generate the database password rather than inventing one:

```bash
openssl rand -base64 24
```

Then bring it up:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes a few minutes, and OpenVPN generates its CA and DH
parameters on first start, which adds a minute more.

Create the schema and your login:

```bash
docker compose -f docker-compose.prod.yml exec api npm run migrate
```

```bash
docker compose -f docker-compose.prod.yml exec -it api npm run account
```

Then open `https://vibelink.tech`. The certificate is issued on first request,
so the very first page load is slow. If it fails, see the table at the bottom.

---

## 5. Point the router at it

On the Routers screen, **Onboard via OVPN**, and this time the address to dial
is your real hostname:

- RouterOS version: whatever `/system resource print` says
- Address to dial: `vibelink.tech` (or an `ovpn.` record if you prefer)

Paste the generated line into the MikroTik, then check both ends:

```bash
docker compose -f docker-compose.prod.yml logs openvpn | grep openvpn-
```

`accepted` followed by `-> 10.50.x.y` means the tunnel is up. Add the router
with that tunnel address as its NAS address, then press **Test CoA**, and enable
CoA on the MikroTik itself:

```
/radius incoming set accept=yes port=3799
```

---

## 6. Tell the payment providers where to post

In the Daraja portal, the callback URLs are now real:

- Confirmation / callback: `https://vibelink.tech/api/mpesa/callback`
- Validation: `https://vibelink.tech/api/mpesa/validate`

KopoKopo webhooks point at `https://vibelink.tech/api/kopokopo/webhook`. Check
the exact paths against the routes in `backend/src/payments/` before pasting —
they must match character for character or the provider silently drops the POST.

Do a KES 1 live STK to yourself and confirm the payment lands in the UI rather
than staying pending. Pending means the webhook is not arriving.

---

## 7. Before real customers

- [ ] Rotate every credential that was ever in the old `backend/.env` — it was
      committed to git history and is still fetchable from GitHub by old commit
      SHA. Rewriting history did not undo that.
- [ ] `POSTGRES_PASSWORD` generated, not typed from memory
- [ ] A different RADIUS secret per router; the UI already allows it
- [ ] 1812/1813 restricted to `10.50.0.0/16`
- [ ] SSH key-only. A public box with root password login gets brute-forced
      within hours of being switched on. Copy your key up, prove it works in a
      **second** terminal while the first stays open, and only then set
      `PermitRootLogin no` and `PasswordAuthentication no` in
      `/etc/ssh/sshd_config` and `systemctl restart ssh`. Doing it in that order
      is the difference between hardening the box and locking yourself out of it.
- [ ] Back up the `billing-ovpn-pki` volume. Losing the CA means re-onboarding
      every RouterOS 6 router.
- [ ] A `radacct` retention policy — it grows fast and nothing prunes it
- [ ] Database backups:

```bash
set -a && . ./.env && set +a && docker compose -f docker-compose.prod.yml exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backup-$(date +%F).sql.gz
```

---

> Anything that runs `psql` or `pg_dump` needs the credentials from `.env`, so
> source it first — `POSTGRES_USER` is not necessarily `billing`:
>
> ```bash
> set -a && . ./.env && set +a
> ```

---

## When it does not work

| Symptom | Cause |
|---|---|
| `role "billing" does not exist` | A command hardcoded the database user. Source `.env` and use `$POSTGRES_USER` |
| Certificate never issues | DNS not pointing here yet, port 80 closed, or Cloudflare proxying is on (orange cloud) |
| `unknown tenant` on every page | The hostname's first label matches no `tenants.subdomain`. The apex needs a tenant whose subdomain is the first label of your domain |
| Certificate refused for a subdomain | On-demand TLS asked the API and got a 404 — that subdomain is not a tenant. Create the tenant first |
| STK prompt arrives, payment stays pending | `BASE_URL` wrong, or the callback URL registered with the provider does not match the route |
| Router connects, CoA times out | 3799 not enabled on the MikroTik, or `routers.host` is not the tunnel address |
| Everything dies after a reboot | `restart: unless-stopped` covers the containers; check `systemctl is-enabled docker` |
