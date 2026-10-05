#!/usr/bin/env bash
# Run the Rackrate indexer locally: Postgres + Hasura in Docker, then `envio start` against them.
# (`envio dev` waits forever in this setup with envio 3.12.1, so the two steps are run explicitly.)
#
#   indexer/scripts/local.sh start | stop | status | logs
#
# Needs Docker running and ENVIO_API_TOKEN in indexer/.env. GraphQL: http://localhost:$HASURA_PORT/v1/graphql
# (default port 8082, so it doesn't collide with other projects on 8080). Logs go to indexer/.run/.
set -euo pipefail

cd "$(dirname "$0")/.."
RUN=.run
mkdir -p "$RUN"
export HASURA_EXTERNAL_PORT="${HASURA_PORT:-8082}" ENVIO_TUI=false
ENVIO=(node node_modules/envio/bin.mjs)
# Connection to the containers `envio local docker up` starts (setting these for `up` would make it skip Postgres).
DB_ENV=(ENVIO_PG_HOST=localhost ENVIO_PG_PORT=5433 ENVIO_PG_USER=postgres ENVIO_PG_PASSWORD=testing ENVIO_PG_DATABASE=envio-dev
  HASURA_GRAPHQL_ENDPOINT="http://localhost:$HASURA_EXTERNAL_PORT/v1/metadata" HASURA_GRAPHQL_ADMIN_SECRET=testing)

running() { [ -f "$RUN/indexer.pid" ] && kill -0 "$(cat "$RUN/indexer.pid")" 2>/dev/null; }

case "${1:-}" in
  start)
    if running; then echo "indexer already running (pid $(cat "$RUN/indexer.pid"))"; exit 0; fi
    "${ENVIO[@]}" local docker up
    nohup env "${DB_ENV[@]}" "${ENVIO[@]}" start </dev/null >>"$RUN/indexer.log" 2>&1 &
    echo $! >"$RUN/indexer.pid"
    echo "indexer started (pid $!), GraphQL http://localhost:$HASURA_EXTERNAL_PORT/v1/graphql, log indexer/$RUN/indexer.log"
    ;;
  stop)
    if running; then kill "$(cat "$RUN/indexer.pid")" && echo "indexer stopped"; fi
    rm -f "$RUN/indexer.pid"
    "${ENVIO[@]}" local docker down
    ;;
  status)
    running && echo "indexer: running (pid $(cat "$RUN/indexer.pid"))" || echo "indexer: stopped"
    curl -s --max-time 5 "http://localhost:$HASURA_EXTERNAL_PORT/v1/graphql" -H 'content-type: application/json' -H 'x-hasura-admin-secret: testing' \
      -d '{"query":"{ chain_metadata { block_height latest_processed_block num_events_processed } }"}' || true
    echo
    ;;
  logs) tail -n 40 -f "$RUN/indexer.log" ;;
  *) echo "Usage: $0 {start|stop|status|logs}"; exit 1 ;;
esac
