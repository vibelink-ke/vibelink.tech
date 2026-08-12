# The stock alpine image ships rlm_sql_postgresql.so but not the library it links
# against, so the module fails to instantiate with:
#   Could not link driver rlm_sql_postgresql: Error loading shared library libpq.so.5
FROM freeradius/freeradius-server:3.2.5-alpine
RUN apk add --no-cache libpq
