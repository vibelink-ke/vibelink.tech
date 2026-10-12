# Putting the sites behind Cloudflare

Cloudflare absorbs floods (DDoS) before they reach the server and hides the server's address. The code is already prepared
(real visitor address read through Cloudflare: `trust proxy` in server.js, `trusted_proxies` in the Caddyfile). Deploy that first.

## Roll out one site at a time
1. Add the domain at cloudflare.com (Free plan), let it import the DNS records, check every record against what you have now.
2. At the domain's registrar, change the nameservers to the two Cloudflare gives you. Wait until Cloudflare says Active.
3. SSL/TLS -> Overview: mode **Full (strict)**. Edge Certificates: Always Use HTTPS on, Minimum TLS 1.2.
4. Security -> WAF -> Custom rules: a rule that **skips all** security for `starts_with(http.request.uri.path, "/webhooks/")`
   (M-Pesa and KopoKopo call these; a challenge page would make payments vanish).
5. Security -> Bots: turn **Bot Fight Mode off** (it challenges the payment callbacks and the routers' own page downloads).
6. DNS: set the orange cloud (Proxied) on the web records, one site at a time, testing after each:
   - first the lowest-risk one (skyplan), then billing, then the apex, then the wildcard that serves tenant subdomains.
   - leave **DNS only (grey)** anything that is not a website: mail (MX and the mail host's A record), a VPN or RADIUS name if routers
     use a name instead of the IP, and any record used by SSH if you use a name for it.
7. After each: sign in, buy a hotspot bundle (payment must complete), open a router's page, check the router stays online.

## Things that behave differently behind Cloudflare
- A brand-new tenant's first page load can show a 525/526 error once, while Caddy fetches its certificate. Reload and it works.
- Only websites go through it (HTTP/HTTPS). OpenVPN 1194, WireGuard 51820, RADIUS 1812-1813 and TR-069 7547 still go straight to the
  server's IP, so those ports stay open as they are, and routers must keep using the server's IP for them.
- If a flood starts: Security -> Settings -> Security Level -> "I'm Under Attack". Turn it back down afterwards.

## Optional, only when every website record is proxied
Allow ports 80/443 only from Cloudflare's ranges (https://www.cloudflare.com/ips/), so nobody can reach the server directly and bypass
the shield. Do not do this while any site is still DNS-only, and not before the routers' page downloads are confirmed to work.
