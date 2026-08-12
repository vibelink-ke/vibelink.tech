# The public face: builds the React app, then serves it and reverse-proxies the
# API behind automatic HTTPS. Build context is the repository root.
FROM node:22-alpine AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# BASE is empty in api/client.js, so the app calls /api on its own origin — which
# is this same server. No API host to bake in.
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /src/dist /srv
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
