# iproute2 baked in at build time, not installed at container startup —
# watchdog.sh's whole job is recovering from no internet access in this
# namespace, so it cannot depend on having internet access to install its own
# tool first.
FROM alpine:3.20
RUN apk add --no-cache iproute2
COPY watchdog.sh /watchdog.sh
