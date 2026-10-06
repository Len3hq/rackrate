#!/usr/bin/env bash
# Browser end-to-end test of the web app on a local fork of Monad testnet (nothing is broadcast to testnet).
#
#   weekly: faucet, approve, a two-week hedge, a purchase, then closing both positions from Portfolio
#           (one by buying LONG back and redeeming, one by redeeming and selling the extra LONG).
#   demo:   a 10-epoch demo session with publishers and the market maker (no keeper, so the app settles it);
#           hedge it in the app, wait for the window to end, then settle and claim from Portfolio.
#
#   app/scripts/e2e-fork.sh            # both phases (~8 minutes)
#   app/scripts/e2e-fork.sh weekly     # or: demo
#
# Requires anvil (Foundry 1.8+), Google Chrome, `forge build` in contracts/, and contracts/.env with
# MONAD_RPC_URL(_PRIVATE) and DEPLOYER_PRIVATE_KEY. Test keys are anvil's public default accounts.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(dirname "$APP_DIR")"
set -a; . "$ROOT/contracts/.env"; set +a

PHASES=("${@:-weekly demo}")
PHASES=(${PHASES[@]})
PORT=8549
APP_PORT=3102
LOGS=$(mktemp -d)
export FORK_RPC="http://127.0.0.1:$PORT" APP_URL="http://localhost:$APP_PORT"
RPC=(--rpc-url "$FORK_RPC")
DEP="$ROOT/contracts/deployments/10143.json"
USD=$(node -e "console.log(require('$DEP').rrUSD)")

cleanup() { kill $(jobs -p) 2>/dev/null || true; lsof -t -i ":$APP_PORT" -i ":$PORT" 2>/dev/null | xargs kill 2>/dev/null || true; pkill -f "node src/(publisher|mm).ts.*(H100_DEMO|--interval 15)" 2>/dev/null || true; }
trap cleanup EXIT
# Both ports are dedicated to this test; clear anything a previous, interrupted run left behind.
lsof -t -i ":$APP_PORT" -i ":$PORT" 2>/dev/null | xargs kill 2>/dev/null || true
# The fork's bots keep their own state files, so the live bots' files are never read or written.
export MM_STATE_FILE="$LOGS/mm-state.json" DEMO_SESSION_FILE="$LOGS/demo-session.json"

# Build first: the upstream RPC only serves recent state, so the fork should be as fresh as possible when used.
echo "building the app against the fork..."
(cd "$APP_DIR" && NEXT_PUBLIC_MONAD_RPC_URL="$FORK_RPC" pnpm build >"$LOGS/build.log" 2>&1)

anvil --fork-url "${MONAD_RPC_URL_PRIVATE:-$MONAD_RPC_URL}" --port "$PORT" --block-time 1 >"$LOGS/anvil.log" 2>&1 &
until cast chain-id "${RPC[@]}" >/dev/null 2>&1; do sleep 1; done
echo "fork up, logs in $LOGS"
# Anvil loads upstream state lazily, and state first touched minutes later can fail with "Required data
# unavailable" (a fork artifact). Touch the test accounts and their rrUSD slots now so they are cached.
ROUTER=$(node -e "console.log(require('$DEP').HedgeRouter)")
for a in 0x976EA74026E726554dB657fA54763abd0C3a0aa9 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955; do
  cast balance "$a" "${RPC[@]}" >/dev/null && cast nonce "$a" "${RPC[@]}" >/dev/null && cast code "$a" "${RPC[@]}" >/dev/null
  cast call "$USD" "balanceOf(address)(uint256)" "$a" "${RPC[@]}" >/dev/null
  cast call "$USD" "lastClaim(address)(uint256)" "$a" "${RPC[@]}" >/dev/null
  cast call "$USD" "allowance(address,address)(uint256)" "$a" "$ROUTER" "${RPC[@]}" >/dev/null
done

(cd "$APP_DIR" && pnpm exec next start -p "$APP_PORT" >"$LOGS/app.log" 2>&1) &
until curl -s -o /dev/null "$APP_URL"; do sleep 1; done

for phase in "${PHASES[@]}"; do
  echo "== $phase"
  if [ "$phase" = demo ]; then
    # anvil accounts #1-#2 publish, #4 makes the market, #7 trades (the weekly phase uses #6).
    export BOT_RPC_URL="$FORK_RPC" PRICE_MASTER_SECRET="0x$(openssl rand -hex 32)"
    export PUBLISHER_B_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
    export PUBLISHER_C_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
    export MM_PRIVATE_KEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
    cast send "$USD" "transfer(address,uint256)" 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 200000000000 --private-key "$DEPLOYER_PRIVATE_KEY" "${RPC[@]}" >/dev/null
    # The weekly phase covers the faucet; here the trader is funded directly.
    cast send "$USD" "transfer(address,uint256)" 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955 5000000000 --private-key "$DEPLOYER_PRIVATE_KEY" "${RPC[@]}" >/dev/null
    # Start the maker first: with a fresh key its first pass funds every weekly book (a few minutes), which then
    # overlaps the demo setup instead of eating into the demo window.
    (cd "$ROOT/bots" && node src/mm.ts --interval 15 >"$LOGS/mm.log" 2>&1) &
    (cd "$ROOT/bots" && node src/demo.ts start --epochs 10)
    FEED=$(node -e "console.log(require('$DEMO_SESSION_FILE').feedName)")
    for p in B C; do
      (cd "$ROOT/bots" && node src/publisher.ts --key "PUBLISHER_${p}_PRIVATE_KEY" --feeds "$FEED" --interval 3 >"$LOGS/pub$p.log" 2>&1) &
    done
    TEST_ACCOUNT=0x14dC79964da2C08b23698B3D3cc7Ca32193d9955 node "$APP_DIR/scripts/e2e-ui.mjs" demo "$LOGS"
  else
    node "$APP_DIR/scripts/e2e-ui.mjs" weekly "$LOGS"
  fi
done
echo "PASS (screenshots in $LOGS)"
