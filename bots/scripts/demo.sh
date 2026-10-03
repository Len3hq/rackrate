#!/usr/bin/env bash
# Live demo on Monad testnet: a fresh 30-second H100 demo feed and a 20-epoch series (~10 minutes) with its own
# Kuru book. The market maker quotes it automatically, the app lists it as "Demo", and the keeper settles it.
#
#   bots/scripts/demo.sh start [EPOCHS]   # default 20 (10 minutes)
#   bots/scripts/demo.sh scenario spike|crash|reset
#   bots/scripts/demo.sh status
#   bots/scripts/demo.sh stop             # after settlement: back to the hourly feed only
#
# Publishers B and C serve the demo feed from the same processes as the hourly feed (restarted with both feeds
# and a 5-second check), so their keys never send from two processes at once. Owner actions use
# DEPLOYER_PRIVATE_KEY; a session costs roughly 0.5 MON of deployer gas plus publisher gas.
set -euo pipefail

cd "$(dirname "$0")/.."
SESSION=.demo-session.json

feed() { node -e 'console.log(require("./'"$SESSION"'").feedName)'; }

case "${1:-}" in
  start)
    node src/demo.ts start --epochs "${2:-20}"
    scripts/publishers.sh stop >/dev/null
    PUB_INTERVAL=5 scripts/publishers.sh start "H100,$(feed)"
    echo "demo running: the market maker quotes it within a minute; settle and claim from the app afterwards"
    ;;
  scenario) node src/demo.ts scenario "${2:?spike, crash or reset}" ;;
  status) node src/demo.ts status ;;
  stop)
    scripts/publishers.sh stop >/dev/null
    scripts/publishers.sh start H100
    ;;
  *) echo "Usage: $0 {start [EPOCHS]|scenario spike|crash|reset|status|stop}"; exit 1 ;;
esac
