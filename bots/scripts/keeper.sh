#!/usr/bin/env bash
# Run the keeper in the background against Monad testnet: lists upcoming weekly series, creates their Kuru
# order books, and settles finished series.
#
#   bots/scripts/keeper.sh start [FEEDS] [WEEKS]   # defaults: H100, 4
#   bots/scripts/keeper.sh stop | status | logs
#
# Uses DEPLOYER_PRIVATE_KEY (factory owner) from contracts/.env. Logs go to bots/.run/ (git-ignored).
set -euo pipefail

cd "$(dirname "$0")/.."
RUN=.run
mkdir -p "$RUN"

start() {
  if [ -f "$RUN/keeper.pid" ] && kill -0 "$(cat "$RUN/keeper.pid")" 2>/dev/null; then
    echo "keeper already running (pid $(cat "$RUN/keeper.pid"))"
    return
  fi
  local cmd=(node src/keeper.ts --feeds "${1:-H100}" --weeks "${2:-4}" --interval 300)
  if command -v caffeinate >/dev/null; then cmd=(caffeinate -i "${cmd[@]}"); fi
  # Supervisor loop: restart the keeper if it ever exits.
  nohup bash -c 'while true; do "$@"; echo "$(date -u +%FT%TZ) [supervisor] keeper exited ($?), restarting in 15s"; sleep 15; done' \
    _ "${cmd[@]}" >>"$RUN/keeper.log" 2>&1 &
  echo $! >"$RUN/keeper.pid"
  echo "keeper started (pid $!), log: bots/$RUN/keeper.log"
}

stop() {
  if [ -f "$RUN/keeper.pid" ]; then
    pkill -P "$(cat "$RUN/keeper.pid")" 2>/dev/null || true
    kill "$(cat "$RUN/keeper.pid")" 2>/dev/null && echo "keeper stopped" || echo "keeper not running"
    rm -f "$RUN/keeper.pid"
  fi
  pkill -f "^node src/keeper.ts" 2>/dev/null || true
}

status() {
  if [ -f "$RUN/keeper.pid" ] && kill -0 "$(cat "$RUN/keeper.pid")" 2>/dev/null; then
    echo "keeper: running (pid $(cat "$RUN/keeper.pid"))"
    tail -n 2 "$RUN/keeper.log" | sed 's/^/  /'
  else
    echo "keeper: stopped"
  fi
}

case "${1:-}" in
  start) start "${2:-}" "${3:-}" ;;
  stop) stop ;;
  status) status ;;
  logs) tail -n 30 -f "$RUN/keeper.log" ;;
  *) echo "Usage: $0 {start [FEEDS] [WEEKS]|stop|status|logs}"; exit 1 ;;
esac
