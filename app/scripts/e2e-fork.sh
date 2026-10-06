#!/usr/bin/env bash
# Browser end-to-end test of the web app on a local fork of Monad testnet (nothing is broadcast to testnet).
#
#   weekly: faucet, approve, a two-week hedge, a purchase, then closing both positions from Portfolio
#           (one by buying LONG back and redeeming, one by redeeming and selling the extra LONG).
#   demo:   a 10-epoch demo session with publishers and the market maker (no keeper, so the app settles it);
#           hedge it in the app, wait for the window to end, then settle and claim from Portfolio.
#
#   app/scripts/e2e-fork.sh            # both phases (~8 minutes)
#   app/scripts/e2e-fork.sh weekly     # or: demo, settle
#
#   settle: positions in the real W41 series, then the fork's clock moves past the window end and the grace
#           period; the keeper settles it, Trade lists it under Settled weeks, and Portfolio's Claim pays out
#           exactly what the contract owes.
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
  elif [ "$phase" = settle ]; then
    # Rehearses W41's settlement on the real series: positions now, then time moves past the window end.
    # anvil account #9 trades; the deployer key only pays gas for permissionless oracle finalization.
    export BOT_RPC_URL="$FORK_RPC"
    KEY9=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6
    ACC9=0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
    REGISTRY=$(node -e "console.log(require('$DEP').MarketRegistry)"); ORACLE=$(node -e "console.log(require('$DEP').RackOracle)")
    W41=$(cast call "$REGISTRY" "allSeriesWithBooks(uint256)(address)" 0 "${RPC[@]}")
    W41_BOOK=$(cast call "$REGISTRY" "bookOf(address)(address)" "$W41" "${RPC[@]}")
    FEED=$(cast call "$W41" "feedId()(bytes32)" "${RPC[@]}")
    cast send "$USD" "transfer(address,uint256)" "$ACC9" 5000000000 --private-key "$DEPLOYER_PRIVATE_KEY" "${RPC[@]}" >/dev/null
    cast send "$USD" "approve(address,uint256)" "$ROUTER" 5000000000 --private-key "$KEY9" "${RPC[@]}" >/dev/null
    cast send "$ROUTER" "hedge((address,address,uint256,uint256)[])" "[($W41,$W41_BOOK,1000000,1)]" --private-key "$KEY9" "${RPC[@]}" >/dev/null
    cast send "$ROUTER" "buyLongs((address,uint256,uint256)[])" "[($W41_BOOK,100000000,1)]" --private-key "$KEY9" "${RPC[@]}" >/dev/null
    echo "account #9 hedged 1 GPU-week of W41 and bought \$100 of LONG"

    finalize_all() { while cast send "$ORACLE" "finalize(bytes32,uint64)" "$FEED" 100 --private-key "$DEPLOYER_PRIVATE_KEY" "${RPC[@]}" >/dev/null 2>&1; do :; done; }
    warp_to() { local now; now=$(cast block latest -f timestamp "${RPC[@]}"); cast rpc evm_increaseTime $(($1 - now)) "${RPC[@]}" >/dev/null; cast rpc evm_mine "${RPC[@]}" >/dev/null; }
    END=$(cast call "$W41" "windowEnd()(uint256)" "${RPC[@]}" | awk '{print $1}')
    warp_to $((END + 900)); finalize_all
    echo "warped past the window end; oracle finalized through epoch $(cast call "$W41" "endEpoch()(uint64)" "${RPC[@]}")"
    (cd "$ROOT/bots" && node src/settlement.ts | sed -n '2,5p')
    (cd "$ROOT/bots" && node src/keeper.ts --once --weeks 0 2>&1 | grep -E "settled|coverage" ) | tee "$LOGS/keeper1.log"
    grep -q "coverage below 90%" "$LOGS/keeper1.log" || { echo "FAIL: expected the keeper to wait for the grace period"; exit 1; }
    warp_to $((END + 86400 + 900)); finalize_all
    (cd "$ROOT/bots" && node src/keeper.ts --once --weeks 0 2>&1 | grep -E "settled|coverage") | tee "$LOGS/keeper2.log"
    grep -qi "$W41: settled at" "$LOGS/keeper2.log" || { echo "FAIL: keeper did not settle W41 after the grace period"; exit 1; }
    (cd "$ROOT/bots" && node src/settlement.ts | sed -n '2,3p')

    LONG=$(cast call "$W41" "long()(address)" "${RPC[@]}"); SHORT=$(cast call "$W41" "short()(address)" "${RPC[@]}")
    L=$(cast call "$LONG" "balanceOf(address)(uint256)" "$ACC9" "${RPC[@]}" | awk '{print $1}'); S=$(cast call "$SHORT" "balanceOf(address)(uint256)" "$ACC9" "${RPC[@]}" | awk '{print $1}')
    LP=$(cast call "$W41" "longPayoutPerUnit()(uint256)" "${RPC[@]}" | awk '{print $1}'); SP=$(cast call "$W41" "shortPayoutPerUnit()(uint256)" "${RPC[@]}" | awk '{print $1}')
    EXPECTED=$(node -e "console.log(((BigInt('$L')*BigInt('$LP'))/1000000n + (BigInt('$S')*BigInt('$SP'))/1000000n).toString())")
    BEFORE=$(cast call "$USD" "balanceOf(address)(uint256)" "$ACC9" "${RPC[@]}" | awk '{print $1}')
    TEST_ACCOUNT=$ACC9 node "$APP_DIR/scripts/e2e-ui.mjs" settle "$LOGS"
    AFTER=$(cast call "$USD" "balanceOf(address)(uint256)" "$ACC9" "${RPC[@]}" | awk '{print $1}')
    GOT=$(node -e "console.log((BigInt('$AFTER')-BigInt('$BEFORE')).toString())")
    echo "claim paid $GOT, contract owed $EXPECTED (LONG $L x $LP + SHORT $S x $SP, 6 decimals)"
    [ "$GOT" = "$EXPECTED" ] || { echo "FAIL: claimed amount differs"; exit 1; }
  else
    node "$APP_DIR/scripts/e2e-ui.mjs" weekly "$LOGS"
  fi
done
echo "PASS (screenshots in $LOGS)"
