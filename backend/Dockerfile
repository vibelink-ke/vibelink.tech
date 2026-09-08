# API image.
FROM node:22-alpine

WORKDIR /app

# pg_dump for the nightly backup job — must match the server's major version
# (postgres:16-alpine in docker-compose) or pg_dump refuses to run against it.
# wireguard-tools (wg, wg-quick) + iproute2 (ip): wireguard.js's syncServer()
# hot-reloads wg0 live from here rather than only writing its config file —
# api shares wg0's own network namespace with the `wireguard` compose service
# (both are network_mode: service:net) and is granted NET_ADMIN below for
# exactly this, so it needs the same tools that service already ships.
RUN apk add --no-cache postgresql16-client wireguard-tools iproute2

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
