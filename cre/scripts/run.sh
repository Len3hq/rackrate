#!/usr/bin/env bash
# Runs the Rackrate CRE price-publisher workflow in simulation mode with real onchain writes
# (`cre workflow simulate --broadcast`) once per hour, until CRE deploy access is granted.
#
#   cre/scripts/run.sh once     # one run now
#   cre/scripts/run.sh start    # background: one run every hour at HH:01:30
#   cre/scripts/run.sh stop | status | logs
#
# Secrets come from contracts/.env: PRICE_MASTER_SECRET (exposed to the simulator as CRE_PRICE_MASTER_SECRET),
# CRE_SIMULATOR_PRIVATE_KEY (pays gas for the forwarder transaction) and the RPC URL.
set -euo pipefail

cd "$(dirname "$0")/.."
RUN=.run
mkdir -p "$RUN"
CRE_BIN="${CRE_BIN:-$(command -v cre || echo "$HOME/.cre/bin/cre")}"
OFFSET=90 # seconds after the hour: after publishers B (~+10 s) and C (~+30 s), so this run usually lands last

load_env() {
  # Locally the values come from contracts/.env; a hosted runner (cre/Dockerfile) sets the CRE_* variables itself.
  if [ -f ../contracts/.env ]; then
    set -a
    # shellcheck disable=SC1091
    . ../contracts/.env
    set +a
    export CRE_MONAD_RPC_URL="${MONAD_RPC_URL_PRIVATE:-$MONAD_RPC_URL}"
    export CRE_PRICE_MASTER_SECRET="$PRICE_MASTER_SECRET"
    export CRE_ETH_PRIVATE_KEY="${CRE_SIMULATOR_PRIVATE_KEY#0x}"
  fi
  export CRE_ETH_PRIVATE_KEY="${CRE_ETH_PRIVATE_KEY#0x}"
  : "${CRE_MONAD_RPC_URL:?missing}" "${CRE_PRICE_MASTER_SECRET:?missing}" "${CRE_ETH_PRIVATE_KEY:?missing}"
}

once() {
  load_env
  echo "$(date -u +%FT%TZ) [cre-runner] simulate --broadcast"
  "$CRE_BIN" workflow simulate price-publisher --non-interactive --trigger-index 0 \
    --target staging-settings --broadcast 2>&1 | grep -E "USER LOG|Simulation Result|rror|failed" || true
}

loop() {
  echo "$(date -u +%FT%TZ) [cre-runner] started, one run every hour at HH:01:30 UTC"
  while true; do
    now=$(date -u +%s)
    next=$(((now / 3600 + 1) * 3600 + OFFSET))
    sleep $((next - now))
    once || echo "$(date -u +%FT%TZ) [cre-runner] run failed, will retry next hour"
  done
}

start() {
  if [ -f "$RUN/cre.pid" ] && kill -0 "$(cat "$RUN/cre.pid")" 2>/dev/null; then
    echo "cre runner already running (pid $(cat "$RUN/cre.pid"))"
    return
  fi
  local cmd=(bash "$0" loop)
  if command -v caffeinate >/dev/null; then cmd=(caffeinate -i "${cmd[@]}"); fi
  nohup "${cmd[@]}" >>"$RUN/cre.log" 2>&1 &
  echo $! >"$RUN/cre.pid"
  echo "cre runner started (pid $!), log: cre/$RUN/cre.log"
}

stop() {
  if [ -f "$RUN/cre.pid" ]; then
    pkill -P "$(cat "$RUN/cre.pid")" 2>/dev/null || true
    kill "$(cat "$RUN/cre.pid")" 2>/dev/null && echo "cre runner stopped" || echo "cre runner not running"
    rm -f "$RUN/cre.pid"
  fi
}

status() {
  if [ -f "$RUN/cre.pid" ] && kill -0 "$(cat "$RUN/cre.pid")" 2>/dev/null; then
    echo "cre runner: running (pid $(cat "$RUN/cre.pid"))"
    tail -n 3 "$RUN/cre.log" 2>/dev/null | sed 's/^/  /'
  else
    echo "cre runner: stopped"
  fi
}

case "${1:-}" in
  once) once ;;
  loop) loop ;;
  start) start ;;
  stop) stop ;;
  status) status ;;
  logs) tail -n 40 -f "$RUN/cre.log" ;;
  *) echo "Usage: $0 {once|start|stop|status|logs}"; exit 1 ;;
esac
