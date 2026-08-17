# The stock alpine image ships rlm_sql_postgresql.so but not the library it links
# against, so the module fails to instantiate with:
#   Could not link driver rlm_sql_postgresql: Error loading shared library libpq.so.5
FROM freeradius/freeradius-server:3.2.5-alpine
#
# tzdata is for the log timestamps. Without it the container is stuck on UTC
# whatever TZ says, so every authentication line reads three hours behind Kenyan
# time — and the one thing these logs get used for is lining a rejection up
# against the moment a customer said they could not connect.
RUN apk add --no-cache libpq tzdata
