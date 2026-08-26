# Extends the stock image only to add the sync-loop init script with the
# ownership/permissions the base image's own security check requires
# (root-owned, executable). A bind mount can't guarantee that: the file on
# the host is owned by whoever ran `git pull`, and that ownership does not
# survive a future pull either — COPY in a build always lands as root, so
# this is the only version of "just add one script" that stays correct.
FROM linuxserver/wireguard:latest
COPY wg-sync-loop.sh /custom-cont-init.d/wg-sync-loop.sh
RUN chmod 755 /custom-cont-init.d/wg-sync-loop.sh
