#!/bin/sh
# Free-tier hosting: when DATABASE_URL / REDIS_URL are not set, run PostgreSQL
# and Redis inside this container. Their data lives in /tmp and resets on every
# restart, which suits a public demo (the hall refills). Set both URLs to point
# at managed services instead; nothing else changes.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] DATABASE_URL not set: starting embedded PostgreSQL"
  export PGDATA=/tmp/pgdata
  initdb --auth=trust --username=booknow --encoding=UTF8 >/tmp/initdb.log 2>&1 || { cat /tmp/initdb.log; exit 1; }
  pg_ctl --wait --log=/tmp/postgres.log \
    -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp -c shared_buffers=32MB -c max_connections=30 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
    start
  createdb --host=127.0.0.1 --username=booknow booknow
  export DATABASE_URL="postgres://booknow@127.0.0.1:5432/booknow"
  export DB_POOL_MAX="${DB_POOL_MAX:-10}"
fi

if [ -z "${REDIS_URL:-}" ]; then
  echo "[entrypoint] REDIS_URL not set: starting embedded Redis"
  # noeviction: a seat lock must never be silently dropped to free memory.
  redis-server --bind 127.0.0.1 --port 6379 --save '' --appendonly no \
    --maxmemory 32mb --maxmemory-policy noeviction --daemonize yes --logfile /tmp/redis.log
  export REDIS_URL="redis://127.0.0.1:6379"
fi

exec "$@"
