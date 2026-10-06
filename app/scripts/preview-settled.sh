#!/usr/bin/env bash
# Interactive preview of the app after W41 settles, on a local fork of Monad testnet (nothing touches testnet).
#
# Copies the chain, moves the fork's clock past W41's window and grace period, lets the keeper settle it, then
# serves the app against that fork at http://localhost:3102 until you press Ctrl+C. Your real wallets and
# positions exist on the fork, so a wallet that held W41 can press Claim and see the payout.
#
#   app/scripts/preview-settled.sh
#
# To sign on the fork, point your wallet's Monad testnet RPC at http://127.0.0.1:8549 (Rabby: Settings > Custom
# RPC; MetaMask: edit the network's RPC URL), and switch it back afterwards. Viewing needs no wallet.
# Requires anvil, `forge build` in contracts/ and contracts/.env (MONAD_RPC_URL(_PRIVATE), DEPLOYER_PRIVATE_KEY).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(dirname "$APP_DIR")"
set -a; . "$ROOT/contracts/.env"; set +a

PORT=8549
APP_PORT=3102
LOGS=$(mktemp -d)
FORK_RPC="http://127.0.0.1:$PORT"
RPC=(--rpc-url "$FORK_RPC")
DEP="$ROOT/contracts/deployments/10143.json"

cleanup() { kill $(jobs -p) 2>/dev/null || true; lsof -t -i ":$APP_PORT" -i ":$PORT" 2>/dev/null | xargs kill 2>/dev/null || true; echo "preview stopped"; }
trap cleanup EXIT
lsof -t -i ":$APP_PORT" -i ":$PORT" 2>/dev/null | xargs kill 2>/dev/null || true

echo "building the app against the fork (the indexer is left out: it follows the real chain, not this copy)..."
(cd "$APP_DIR" && NEXT_PUBLIC_MONAD_RPC_URL="$FORK_RPC" NEXT_PUBLIC_INDEXER_URL="" pnpm build >"$LOGS/build.log" 2>&1)

anvil --fork-url "${MONAD_RPC_URL_PRIVATE:-$MONAD_RPC_URL}" --port "$PORT" --block-time 1 >"$LOGS/anvil.log" 2>&1 &
until cast chain-id "${RPC[@]}" >/dev/null 2>&1; do sleep 1; done

REGISTRY=$(node -e "console.log(require('$DEP').MarketRegistry)")
ORACLE=$(node -e "console.log(require('$DEP').RackOracle)")
W41=$(cast call "$REGISTRY" "allSeriesWithBooks(uint256)(address)" 0 "${RPC[@]}")
FEED=$(cast call "$W41" "feedId()(bytes32)" "${RPC[@]}")
END=$(cast call "$W41" "windowEnd()(uint256)" "${RPC[@]}" | awk '{print $1}')

finalize_all() { while cast send "$ORACLE" "finalize(bytes32,uint64)" "$FEED" 100 --private-key "$DEPLOYER_PRIVATE_KEY" "${RPC[@]}" >/dev/null 2>&1; do :; done; }
warp_to() { local now; now=$(cast block latest -f timestamp "${RPC[@]}"); cast rpc evm_increaseTime $(($1 - now)) "${RPC[@]}" >/dev/null; cast rpc evm_mine "${RPC[@]}" >/dev/null; }

export BOT_RPC_URL="$FORK_RPC"
echo "moving the fork past W41's window and its grace period, then settling..."
warp_to $((END + 86400 + 900))
finalize_all
(cd "$ROOT/bots" && node src/keeper.ts --once --weeks 0 2>&1 | grep -E "settled|coverage" || true)
(cd "$ROOT/bots" && node src/settlement.ts | sed -n '2,3p')

(cd "$APP_DIR" && pnpm exec next start -p "$APP_PORT" >"$LOGS/app.log" 2>&1) &
until curl -s -o /dev/null "http://localhost:$APP_PORT"; do sleep 1; done

cat <<EOF

Preview ready: http://localhost:$APP_PORT  (the fork's clock is now $(date -u -r "$(cast block latest -f timestamp "${RPC[@]}")" '+%b %d, %H:%M UTC'))

  Trade      the "Settled weeks" card lists W41 with its average and what LONG and SHORT paid
  Portfolio  a wallet that held W41 shows "Settled at ..." and a Claim button
             (signing needs your wallet's Monad testnet RPC set to $FORK_RPC; switch it back afterwards)

Countdowns use your computer's clock, not the fork's, so live weeks still read "starts in". Ctrl+C to stop.
EOF
wait
