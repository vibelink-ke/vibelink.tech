# API image.
FROM node:22-alpine

WORKDIR /app

# pg_dump for the nightly backup job — must match the server's major version
# (postgres:16-alpine in docker-compose) or pg_dump refuses to run against it.
RUN apk add --no-cache postgresql16-client

# Dependencies as their own layer, so editing source does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY schema.sql ./schema.sql

# Don't run the API as root. Nothing here needs to write to the image.
USER node

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/server.js"]
