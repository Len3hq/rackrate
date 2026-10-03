#!/usr/bin/env bash
# Run the oracle publisher bots (B and C) in the background against Monad testnet.
#
#   bots/scripts/publishers.sh start [FEEDS]   # default FEEDS=H100 (e.g. H100,H200,B200)
#   bots/scripts/publishers.sh stop
#   bots/scripts/publishers.sh status
#   bots/scripts/publishers.sh logs
#
# Keys, PRICE_MASTER_SECRET and RPC come from contracts/.env. Logs and PIDs go to bots/.run/ (git-ignored).
# On macOS each bot runs under `caffeinate -i` so idle sleep doesn't pause it (closing the lid still does).
set -euo pipefail

cd "$(dirname "$0")/.."
RUN=.run
mkdir -p "$RUN"
INTERVAL="${PUB_INTERVAL:-60}" # seconds; hourly epochs only need a check per minute (demo.sh uses 5)

start() {
  local feeds="${1:-H100}"
  for p in B C; do
    if [ -f "$RUN/pub$p.pid" ] && kill -0 "$(cat "$RUN/pub$p.pid")" 2>/dev/null; then
      echo "publisher $p already running (pid $(cat "$RUN/pub$p.pid"))"
      continue
    fi
    local cmd=(node src/publisher.ts --key "PUBLISHER_${p}_PRIVATE_KEY" --feeds "$feeds" --interval "$INTERVAL")
    # B finalizes backlog; C runs 20 s behind B and skips it, so C usually lands last and its estimate
    # already covers finalizing the epoch, and the two never race to finalize.
    if [ "$p" = C ]; then cmd+=(--skip-finalize --delay 20); fi
    if command -v caffeinate >/dev/null; then cmd=(caffeinate -i "${cmd[@]}"); fi
    # Supervisor loop: restart the bot if it ever exits (e.g. an unexpected crash), after a short pause.
    nohup bash -c 'while true; do "$@"; echo "$(date -u +%FT%TZ) [supervisor] publisher exited ($?), restarting in 15s"; sleep 15; done' \
      _ "${cmd[@]}" >>"$RUN/pub$p.log" 2>&1 &
    echo $! >"$RUN/pub$p.pid"
    echo "publisher $p started (pid $!, feeds $feeds), log: bots/$RUN/pub$p.log"
  done
}

stop() {
  for p in B C; do
    if [ -f "$RUN/pub$p.pid" ]; then
      pkill -P "$(cat "$RUN/pub$p.pid")" 2>/dev/null || true # the bot under the supervisor
      kill "$(cat "$RUN/pub$p.pid")" 2>/dev/null && echo "publisher $p stopped" || echo "publisher $p not running"
      rm -f "$RUN/pub$p.pid"
    fi
  done
  pkill -f "src/publisher.ts --key PUBLISHER_[BC]_PRIVATE_KEY" 2>/dev/null || true
}

status() {
  for p in B C; do
    if [ -f "$RUN/pub$p.pid" ] && kill -0 "$(cat "$RUN/pub$p.pid")" 2>/dev/null; then
      echo "publisher $p: running (pid $(cat "$RUN/pub$p.pid"))"
      tail -n 2 "$RUN/pub$p.log" | sed 's/^/  /'
    else
      echo "publisher $p: stopped"
    fi
  done
}

logs() { tail -n 30 -f "$RUN"/pub*.log; }

case "${1:-}" in
  start) start "${2:-}" ;;
  stop) stop ;;
  status) status ;;
  logs) logs ;;
  *) echo "Usage: $0 {start [FEEDS]|stop|status|logs}"; exit 1 ;;
esac
