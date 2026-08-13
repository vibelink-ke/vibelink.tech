# OpenVPN server that authenticates routers against the billing database.
#
# Deliberately not one of the turnkey images: those assume per-client certificates
# issued by hand. Here a router's credentials are minted by the app when you press
# "Onboard via OVPN", so the server has to check them against Postgres instead.
FROM alpine:3.20

RUN apk add --no-cache openvpn easy-rsa postgresql16-client bash

COPY server.conf      /etc/openvpn/server.conf
COPY auth.sh          /etc/openvpn/auth.sh
COPY client-connect.sh /etc/openvpn/client-connect.sh
COPY entrypoint.sh    /entrypoint.sh
RUN chmod +x /etc/openvpn/auth.sh /etc/openvpn/client-connect.sh /entrypoint.sh

EXPOSE 1194/tcp
ENTRYPOINT ["/entrypoint.sh"]
CMD ["openvpn", "--config", "/etc/openvpn/server.conf"]
