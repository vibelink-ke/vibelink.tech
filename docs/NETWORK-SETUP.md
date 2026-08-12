# RADIUS and the management tunnel, from scratch

This is the half of the system that actually controls internet access. Without
it the billing app is bookkeeping: it records who paid, but nothing stops a
non-payer browsing.

Read the first section before touching anything — the *why* makes the rest
obvious, and it will save you debugging the wrong thing.

---

## 1. What each piece does

### The problem

A customer's router (a MikroTik, usually) sits at their premises. When their
laptop connects, something has to decide:

1. **Is this person allowed on?**
2. **At what speed?**
3. **When do they get cut off?**

The MikroTik does not know. It has no idea who paid. So it asks a **RADIUS
server**, which reads the answer out of the billing database.

### RADIUS

RADIUS is a 1990s protocol that does exactly three things here:

| Message | Meaning | Where the answer comes from |
|---|---|---|
| **Access-Request** | "Can `john@zurinet` on, password `x`?" | `radcheck` table |
| **Access-Accept** | "Yes, and cap them at 10 Mbps until 4 Aug" | `radreply` table |
| **Accounting** | "John used 4.2 GB and hung up" | written to `radacct` |

The billing app already writes `radcheck` and `radreply` — look at
`activateSubscriber()` in `backend/src/radius.js`. **Nothing was reading them.**
That is what FreeRADIUS is for.

Accounting matters more than it looks: fair-use enforcement counts bytes from
those records. No accounting, no usage data, and every FUP policy reads zero.

### CoA — and why you need a tunnel

Normally RADIUS is the router asking the server. **Change of Authorisation**
reverses that: the server tells a router *"subscriber 42's session drops to
2 Mbps now"* without waiting for them to reconnect. It is what makes an expiry,
a top-up, or a fair-use throttle take effect immediately rather than at the next
login.

For that the **server has to reach the router**. And it cannot:

- Customer sites are behind CGNAT — no public IP at all
- Or on a dynamic IP that changes
- Or behind a firewall nobody will open for you

So every router dials **out** to a tunnel and keeps it open. Inside the tunnel it
has a fixed address like `10.51.0.7`, which the server can dial any time.

```
  MikroTik at Kimumu                 Your server
  ┌────────────────┐                ┌──────────────────────┐
  │ 10.51.0.7      │◄──WireGuard───►│ 10.51.0.1            │
  │                │   (router      │                      │
  │ PPPoE users ───┼──dials out)    │  FreeRADIUS :1812    │
  │                │                │  Postgres            │
  │  auth ─────────┼───────────────►│  billing API         │
  │  ◄─────── CoA ─┼────────────────┤                      │
  └────────────────┘                └──────────────────────┘
```

### WireGuard or OpenVPN?

The code shipped with an OpenVPN onboarding script. WireGuard is the better
choice **if your routers run RouterOS 7**:

| | OpenVPN on RouterOS | WireGuard on RouterOS 7 |
|---|---|---|
| Speed | Single-threaded, slow | In-kernel, fast |
| Config | Certificates, CA, fiddly | Two keys |
| RouterOS 6 | Works | **Not available at all** |

Check before choosing:

```
/system resource print
```

`version: 7.x` → WireGuard. `6.x` → either upgrade, or stay on the OVPN path.

---

## 2. What you need before starting

- A server with a **public IP** (a $5 VPS is plenty — this is control traffic,
  not customer traffic)
- **UDP 51820** open for WireGuard, or **TCP 1194** for OpenVPN — whichever
  tunnel your routers can speak
- **UDP 1812 and 1813** reachable *from your routers* — over the tunnel, so they
  do not need to be open to the world
- At least one MikroTik you can log into. No hardware? Install **CHR** (Cloud
  Hosted Router) in a VM — it is free below 1 Mbps and enough to test everything
  here.

> Everything below can be brought up and verified on your laptop. Only the last
> section needs a real router.

---

## 3. Start the services

```bash
docker compose --profile network up -d
```

That adds three containers to the Postgres you already run:

- **`billing-radius`** — FreeRADIUS 3.2, reading the same Postgres
- **`billing-wg`** — WireGuard, for RouterOS 7
- **`billing-ovpn`** — OpenVPN, for RouterOS 6

You do not need both tunnels. Run whichever matches your routers; the two can
coexist, and routers on either one get an address from the same tenant `/24`.

FreeRADIUS starts in `-X` (debug) mode on purpose: every decision it makes is
printed. Watch it while you are bringing this up.

```bash
docker compose logs -f freeradius
```

Look for `Ready to process requests`. If it exits instead, the entrypoint runs a
config check first and prints exactly what it rejected.

### What the config does

`infra/freeradius/` holds two files, both deliberately small:

- **`mods-available/sql`** — points FreeRADIUS at your Postgres and tells it to
  read the NAS list from the `nas` view.
- **`sites-available/billing`** — the virtual server. Authenticates from
  `radcheck`, replies from `radreply`, writes accounting to `radacct`.

The entrypoint **deletes the stock `default` and `inner-tunnel` sites**. That is
deliberate: leaving them enabled means a request that misses your rules can still
be answered by a policy you never wrote.

### The `nas` view

FreeRADIUS will not talk to a router it does not know. Normally you list them in
`clients.conf` and restart. Instead, `schema.sql` defines:

```sql
create or replace view nas as
  select ... from routers r;
```

So **adding a router in the UI authorises it immediately** — no file, no restart.
The shared secret in the Routers form is the one the MikroTik must send.

---

## 4. Bring up WireGuard

### Generate the server keypair

```bash
cd backend && node scripts/wg-sync.mjs --init
```

Put the output in `backend/.env`:

```
WG_SERVER_PRIVATE_KEY=<private>
WG_SERVER_PUBLIC_KEY=<public>
WG_ENDPOINT=your.public.ip.or.hostname
```

The private key never leaves the server. The public key is what routers are told
to trust.

### Write the config

```bash
node scripts/wg-sync.mjs --print   # inspect first
node scripts/wg-sync.mjs           # write and reload
```

The database is the source of truth. Peers live in `wg_peers`; this renders
`wg0.conf` from them and calls `wg syncconf`, which applies changes **without
dropping established tunnels** (`wg up` would).

Re-run it whenever you add or remove a router.

---

## 5. Onboard a router

In the UI: **Routers → Onboard via WireGuard**. That calls
`POST /api/routers/wg-peer`, which:

1. mints an X25519 keypair (`node:crypto`, no `wg` binary needed)
2. allocates the next free address in **this tenant's own `/24`** (see
   "Per-tenant subnets" below)
3. stores **only the public key**
4. returns RouterOS 7 commands to paste

> The private key is shown **once** and is never stored. Lose it and you recreate
> the peer rather than recover it. That is the right trade — a stored private key
> is a stored credential.

Then on the router:

```
/system resource print          # confirm RouterOS 7
```

Paste the generated block, then check:

```
/interface/wireguard/peers print
```

`last-handshake` filling in means the tunnel is up. From the server:

```bash
docker compose exec wireguard wg show
```

Then ping the address the UI showed you.

### Per-tenant subnets

Every tenant gets its own `/24` out of `10.50.0.0/16`, recorded in
`tenants.tunnel_subnet` and handed out by `backend/src/tunnel.js`. The first
tenant gets `10.50.1.0/24`, the next `10.50.2.0/24`, and so on; the server itself
is `10.50.0.1`. Allocation takes a row lock and scans the addresses actually in
use, so two tenants onboarding at the same moment cannot collide, and an address
freed by a deleted router is reused.

This matters beyond tidiness: a router's tunnel address is its `nasname` in the
`nas` view and the destination RADIUS uses for CoA. Overlapping tenants would
mean sending one operator's disconnect to another operator's router.

### RouterOS 6: onboard over OpenVPN instead

RouterOS 6 has no WireGuard. Use **Routers → Onboard via OVPN**. It asks two
things first, because neither can be guessed:

- **RouterOS version.** Check with `/system resource print`. The two versions
  spell the cipher differently — v6 wants `cipher=aes256`, v7 wants
  `cipher=aes256-cbc`, and both mean AES-256-CBC. Paste the wrong one and
  RouterOS answers with a bare `syntax error (line N column M)` that names no
  parameter at all.
- **The address the router should dial.** Its public hostname in production, or
  the server's LAN address on a bench. Port 1194/TCP has to be open to it.

It then calls `POST /api/routers/ovpn-script`, which:

1. allocates the next free address in the tenant's `/24`
2. mints a random password, stores it **hashed** (pgcrypto `crypt`/`bf`), and
   returns the plaintext once, inside the script
3. returns RouterOS 6 commands to paste

The server side is the `billing-ovpn` container. It authenticates each router
against `ovpn_clients` and pins it to its allocated address — the same address
the `nas` view advertises — rather than letting OpenVPN hand out a pool address
that would change on reconnect and silently break CoA.

Three settings are dictated by the RouterOS 6 client, not by preference:

| Setting | Why |
|---|---|
| `proto tcp-server` | The RouterOS 6 OpenVPN client cannot do UDP |
| `data-ciphers AES-256-CBC` | OpenVPN 2.6 negotiates GCM by default; RouterOS offers only CBC. Without this a router authenticates and is *then* dropped with "no shared cipher" |
| `verify-client-cert none` | Routers use the minted username/password, so there are no per-router certificates to issue by hand |

There is deliberately no `redirect-gateway` and no pushed routes: this is a
management tunnel, and customer traffic must never enter it.

On first start the container generates its own CA, server certificate and DH
parameters into the `billing-ovpn-pki` volume. **Keep that volume.** Deleting it
mints a new CA, and every router then has to be re-onboarded.

Check it from the server:

```bash
docker logs billing-ovpn | grep openvpn-
```

`openvpn-auth: accepted router-2` followed by `openvpn-connect: router-2 ->
10.50.1.2` means the router authenticated and landed on its allocated address. A
rejection logs `openvpn-auth: rejected <name>` and nothing else — the password
never reaches the log.

### Point the router at RADIUS

Still on the MikroTik — substitute your own secret, the one you entered in the
Routers form:

```
/radius
add service=ppp,hotspot address=10.51.0.1 secret="YOUR-SECRET" \
    timeout=3s src-address=10.51.0.7

/radius/incoming
set accept=yes port=3799

/ppp/aaa
set use-radius=yes accounting=yes interim-update=5m
```

`/radius/incoming` is the CoA listener — **without it, live speed changes and
disconnects silently do nothing**. `interim-update=5m` is what keeps fair-use
usage current; without it you only get totals when a session ends.

---

## 6. Test it

### Does RADIUS answer at all?

```bash
docker compose exec freeradius radtest someuser somepass 127.0.0.1 0 testing123
```

`Access-Reject` is a **good** first result — it means the server is listening and
made a decision. `no response` means it is not running or the port is blocked.

### Does a real subscriber authenticate?

Create a client in the UI with a PPPoE username and password, apply a payment so
`activateSubscriber()` runs, then:

```bash
docker compose exec -it db psql -U billing -d billing \
  -c "select username, attribute, value from radcheck order by id desc limit 5;"
```

You should see their `Cleartext-Password`. Then from the router's IP:

```bash
radtest <pppoe_user> <pppoe_pass> 10.51.0.1 0 YOUR-SECRET
```

`Access-Accept` with a `Mikrotik-Rate-Limit` attribute means the whole chain
works — the app wrote it, FreeRADIUS read it, the router will enforce it.

### Does accounting land?

Connect a real client through the router, then:

```sql
select username, acctinputoctets, acctoutputoctets, acctstarttime
from radacct order by radacctid desc limit 5;

select username, bytes_in, bytes_out from sessions order by started_at desc limit 5;
```

Both should have rows. The second is filled by a trigger on `radacct` — that is
what feeds fair-use. If `radacct` fills but `sessions` stays empty, the trigger
could not match the NAS IP to a router: check that `routers.host` equals the
tunnel address the router actually uses.

### Does CoA work?

CoA is the one link in the chain that fails quietly. Authentication and
accounting both leave a trail; a CoA that never arrives just means speed changes
wait for the subscriber to reconnect, which looks like nothing at all.

So test it directly: **Routers → Test CoA** sends a real CoA-Request to that
router and reports what came back.

| Result | Meaning |
|---|---|
| "Router accepted the change (CoA-ACK)" | Working |
| "Router answered and the shared secret matches… rejected this username" | **Also working.** The probe uses a username that does not exist, so a NAK proves the round trip |
| "no response after N attempts" | The router never answered — see below |

Silence means one of: UDP 3799 not reachable over the tunnel, CoA not enabled on
the router, or `routers.host` not holding the address the router actually uses.
Enable it on the MikroTik with:

```
/radius incoming set accept=yes port=3799
```

The result is stored on the router row, so the Routers screen shows whether CoA
last worked rather than leaving it invisible.

For a live end-to-end check, apply a fair-use throttle ("Run check now" on Fair
use policy) and watch the FreeRADIUS log — a connected session should change
speed within seconds.

> The app speaks RADIUS itself (`backend/src/coa.js`) rather than shelling out to
> `radclient`. That binary is not installed next to the API and does not exist on
> Windows, so every CoA used to fail silently. `npm test` in `backend/` checks the
> packet encoding against a decoder, including that a reply signed with the wrong
> secret is rejected.

---

## 7. When it does not work

| Symptom | Almost always |
|---|---|
| `radtest` gets no response | Container down, or UDP 1812 blocked |
| `Access-Reject` for a valid user | No `radcheck` row — the payment never ran `activateSubscriber()` |
| Rejected with "Client not found" | Router's source IP is not in `routers.host`, so the `nas` view does not list it |
| Auth works, speed is wrong | `radreply` has the wrong `Mikrotik-Rate-Limit`; the format is `upload/download` in bits, e.g. `5000k/10000k` |
| Tunnel never handshakes | UDP 51820 blocked, or `WG_ENDPOINT` is wrong. WireGuard is silent by design — it does not reply to bad peers at all |
| Handshake fine, no ping | Missing `/ip/address` on the router, or the firewall rule was not added |
| Fair use always reads 0 | No `interim-update`, so nothing is written until a session ends |
| Speed changes only on reconnect | CoA is not landing — press **Test CoA** on the Routers screen; usually `/radius incoming` is not enabled on the MikroTik |
| OVPN: `AUTH_FAILED` for a good password | The row is there but the script cannot reach Postgres. OpenVPN gives its scripts a bare environment, so they read `/etc/openvpn/db.env`, which the entrypoint writes at start |
| OVPN: auth OK, then "no shared cipher" | `data-ciphers` does not include `AES-256-CBC` |
| OVPN: router connects on the wrong address | `client-connect.sh` found no `ovpn_clients` row for that username |
| OVPN: pasted script gives `syntax error (line N column M)` | Wrong RouterOS version chosen — the column points into `cipher=`. v6 takes `aes256`, v7 takes `aes256-cbc` |
| OVPN: `input does not match any value of interface` | A follow-up command referenced `billing-ovpn` before the interface existed, i.e. the `add` above it failed. Fix that one first |

WireGuard's silence is the thing that catches people out: a misconfigured peer
produces **no error anywhere**. If there is no handshake, the two ends disagree
about a key or the endpoint, and neither will tell you which.

---

## 8. Before this touches paying customers

- Change `POSTGRES_PASSWORD` — `secret` is fine on a laptop and nowhere else
- Give each router a **different** RADIUS secret; the UI already allows it
- Drop FreeRADIUS out of `-X` debug mode (`radiusd -f`), it logs full credentials
- Put Postgres on a private network, not a published port
- Firewall 1812/1813 to the tunnel supernet (`10.50.0.0/16`) only
- Back up the `billing-ovpn-pki` volume; losing the CA means re-onboarding every
  RouterOS 6 router
- Set up `radacct` retention — it grows quickly and nothing prunes it yet
