#!/usr/bin/env bash
# End-to-end test of the market maker on a local fork of Monad testnet (nothing is broadcast to testnet).
#
# Flow: fund a fresh maker -> quote every live weekly book -> a trader hedges into the bid and buys from the ask
#       through the deployed HedgeRouter -> the maker detects the fills and requotes -> a quiet pass sends nothing
#       -> cancel-all empties the books.
#
# Requires: anvil (Foundry 1.8+), `forge build` in contracts/, and contracts/.env with MONAD_RPC_URL(_PRIVATE)
# and DEPLOYER_PRIVATE_KEY (holds the rrUSD supply). Maker and trader keys are anvil's default test accounts.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; . ../contracts/.env; set +a

PORT=8547
export BOT_RPC_URL="http://127.0.0.1:${PORT}"
RPC=(--rpc-url "$BOT_RPC_URL")
# anvil default accounts #4 and #5 (public test keys, funded on the fork)
export MM_PRIVATE_KEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
MM=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
TRADER_KEY=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba
TRADER=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
STATE=.run/mm-state.json
DEP=../contracts/deployments/10143.json
j() { node -e "console.log(require('$DEP').$1)"; }
USD=$(j rrUSD); REGISTRY=$(j MarketRegistry); FACTORY=$(j SeriesFactory); HEDGE=$(j HedgeRouter)

mkdir -p .run
[ -f "$STATE" ] && mv "$STATE" "$STATE.bak-$$"   # never touch the live maker's state
cleanup() { rm -f "$STATE"; [ -f "$STATE.bak-$$" ] && mv "$STATE.bak-$$" "$STATE"; kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT

anvil --fork-url "${MONAD_RPC_URL_PRIVATE:-$MONAD_RPC_URL}" --port "$PORT" --block-time 1 >/dev/null 2>&1 &
until cast chain-id "${RPC[@]}" >/dev/null 2>&1; do sleep 1; done
echo "fork up"

cast send "$USD" "transfer(address,uint256)" "$MM" 100000000000 --private-key "$DEPLOYER_PRIVATE_KEY" "${RPC[@]}" >/dev/null
cast send "$USD" "transfer(address,uint256)" "$TRADER" 10000000000 --private-key "$DEPLOYER_PRIVATE_KEY" "${RPC[@]}" >/dev/null
echo "maker funded with 100,000 rrUSD, trader with 10,000 rrUSD"

books() {
  local n; n=$(cast call "$REGISTRY" "marketCount()(uint256)" "${RPC[@]}")
  for ((i = 0; i < n; i++)); do
    local s b; s=$(cast call "$REGISTRY" "allSeriesWithBooks(uint256)(address)" "$i" "${RPC[@]}")
    b=$(cast call "$REGISTRY" "bookOf(address)(address)" "$s" "${RPC[@]}")
    echo "$s $b"
  done
}
show() {
  books | while read -r s b; do
    printf '  %s  best bid/ask: %s\n' "$b" "$(cast call "$b" "bestBidAsk()(uint256,uint256)" "${RPC[@]}" | tr '\n' ' ')"
  done
}

echo "== pass 1: initial quotes"
node src/mm.ts --once
show

# Pick the second live book (next week's series) for the trades.
read -r SERIES BOOK < <(books | sed -n 2p)
echo "== trader hedges 1 GPU-week into the bid and buys \$100 of LONG from the ask on $BOOK"
cast send "$USD" "approve(address,uint256)" "$HEDGE" 1000000000000 --private-key "$TRADER_KEY" "${RPC[@]}" >/dev/null
cast send "$HEDGE" "hedge((address,address,uint256,uint256)[])" "[($SERIES,$BOOK,1000000,1)]" \
  --private-key "$TRADER_KEY" "${RPC[@]}" >/dev/null
cast send "$HEDGE" "buyLongs((address,uint256,uint256)[])" "[($BOOK,100000000,1)]" \
  --private-key "$TRADER_KEY" "${RPC[@]}" >/dev/null
SHORT=$(cast call "$SERIES" "short()(address)" "${RPC[@]}"); LONG=$(cast call "$SERIES" "long()(address)" "${RPC[@]}")
echo "  trader SHORT $(cast call "$SHORT" "balanceOf(address)(uint256)" "$TRADER" "${RPC[@]}"), LONG $(cast call "$LONG" "balanceOf(address)(uint256)" "$TRADER" "${RPC[@]}")"

echo "== pass 2: maker should requote only the traded book (fill)"
node src/mm.ts --once | tee /dev/stderr | grep -q "(fill)" || { echo "FAIL: fill not detected"; exit 1; }
show

echo "== pass 3: nothing changed, maker should send no transactions"
NONCE=$(cast nonce "$MM" "${RPC[@]}")
node src/mm.ts --once
[ "$(cast nonce "$MM" "${RPC[@]}")" = "$NONCE" ] || { echo "FAIL: idle pass sent transactions"; exit 1; }

echo "== cancel-all"
node src/mm.ts --cancel-all
show
echo "PASS"
