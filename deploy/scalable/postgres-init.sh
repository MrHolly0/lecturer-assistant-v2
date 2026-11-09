#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=worker_password="$CONTENT_DB_PASSWORD" <<'SQL'
CREATE ROLE content_worker LOGIN PASSWORD :'worker_password';
SQL
