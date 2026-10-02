#!/usr/bin/env bash
# Run the market maker in the background against Monad testnet: quotes test liquidity on the Kuru book of
# every live weekly series.
#
#   bots/scripts/mm.sh start | stop | status | logs
#   bots/scripts/mm.sh cancel      # stop, then pull every resting quote
#
# Uses MM_PRIVATE_KEY from contracts/.env. Logs and order state go to bots/.run/ (git-ignored).
set -euo pipefail

cd "$(dirname "$0")/.."
RUN=.run
mkdir -p "$RUN"

start() {
  if [ -f "$RUN/mm.pid" ] && kill -0 "$(cat "$RUN/mm.pid")" 2>/dev/null; then
    echo "mm already running (pid $(cat "$RUN/mm.pid"))"
    return
  fi
  local cmd=(node src/mm.ts --interval 60)
  if command -v caffeinate >/dev/null; then cmd=(caffeinate -i "${cmd[@]}"); fi
  # Supervisor loop: restart the maker if it ever exits.
  nohup bash -c 'while true; do "$@"; echo "$(date -u +%FT%TZ) [supervisor] mm exited ($?), restarting in 15s"; sleep 15; done' \
    _ "${cmd[@]}" >>"$RUN/mm.log" 2>&1 &
  echo $! >"$RUN/mm.pid"
  echo "mm started (pid $!), log: bots/$RUN/mm.log"
}

stop() {
  if [ -f "$RUN/mm.pid" ]; then
    pkill -P "$(cat "$RUN/mm.pid")" 2>/dev/null || true
    kill "$(cat "$RUN/mm.pid")" 2>/dev/null && echo "mm stopped" || echo "mm not running"
    rm -f "$RUN/mm.pid"
  fi
  pkill -f "^node src/mm.ts" 2>/dev/null || true
}

status() {
  if [ -f "$RUN/mm.pid" ] && kill -0 "$(cat "$RUN/mm.pid")" 2>/dev/null; then
    echo "mm: running (pid $(cat "$RUN/mm.pid"))"
    tail -n 2 "$RUN/mm.log" | sed 's/^/  /'
  else
    echo "mm: stopped"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  cancel) stop; node src/mm.ts --cancel-all ;;
  status) status ;;
  logs) tail -n 30 -f "$RUN/mm.log" ;;
  *) echo "Usage: $0 {start|stop|cancel|status|logs}"; exit 1 ;;
esac
