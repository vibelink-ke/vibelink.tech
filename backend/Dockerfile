# API image.
FROM node:22-alpine

WORKDIR /app

# pg_dump for the nightly backup job — must match the server's major version
# (postgres:16-alpine in docker-compose) or pg_dump refuses to run against it.
# wireguard-tools (wg) + iproute2 (ip): wireguard.js's syncServer() hot-reloads
# wg0 live from here rather than only writing its config file — api shares
# wg0's own network namespace with the `wireguard` compose service (both are
# network_mode: service:net) and is granted NET_ADMIN in docker-compose.prod.yml
# for exactly this.
#
# NET_ADMIN on the container is not enough by itself, though — confirmed live
# on this exact wg0 the hard way: `wg set`/`ip route` run as this image's own
# non-root PUID/PGID user silently did nothing (no error, no effect) until
# retried as root. Docker's cap_add only fills the *container's* bounding
# set; a non-root process still needs the capability in its own effective
# set at exec time, which plain cap_add does not grant it. `USER node` below
# means every one of this process's own network calls, so rather than run
# the whole API as root just for this, setcap grants NET_ADMIN to `wg` and
# `ip` specifically — the kernel adds it to their effective set on exec,
# for those two binaries only, regardless of the calling process's own UID.
RUN apk add --no-cache postgresql16-client wireguard-tools iproute2 libcap \
    && setcap cap_net_admin+eip "$(command -v wg)" \
    && setcap cap_net_admin+eip "$(command -v ip)"

# Dependencies as their own layer, so editing source does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY schema.sql ./schema.sql
COPY certs ./certs

# Don't run the API as root. Nothing here needs to write to the image.
USER node

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/server.js"]
