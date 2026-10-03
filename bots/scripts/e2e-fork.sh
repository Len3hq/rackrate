#!/usr/bin/env bash
# End-to-end test of the publishers on a local fork of Monad testnet (nothing is broadcast to testnet).
#
# Flow: fresh demo session -> 3 publishers (one rogue) -> crash scenario -> settle -> time warp ->
#       seed reveals -> independent audit re-derives every honest print from revealed seeds.
#
# Requires: anvil (Foundry 1.8+), `forge build` in contracts/, and contracts/.env with MONAD_RPC_URL and
# DEPLOYER_PRIVATE_KEY (owner of the deployed contracts). Publisher keys are anvil's default test accounts.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; . ../contracts/.env; set +a

PORT=8546
LOGS=$(mktemp -d)
export BOT_RPC_URL="http://127.0.0.1:${PORT}"
export DEMO_SESSION_FILE="$LOGS/demo-session.json" # never the live session file
export PRICE_MASTER_SECRET="0x$(openssl rand -hex 32)"
# anvil default accounts #1-#3 (public test keys, funded on the fork)
export PUBLISHER_B_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export PUBLISHER_C_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export PUBLISHER_D_PRIVATE_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
PUBS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8,0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,0x90F79bf6EB2c4f870365E785982E1f101E93b906

cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT

anvil --fork-url "${MONAD_RPC_URL_PRIVATE:-$MONAD_RPC_URL}" --port "$PORT" --block-time 1 >"$LOGS/anvil.log" 2>&1 &
until cast chain-id --rpc-url "$BOT_RPC_URL" >/dev/null 2>&1; do sleep 1; done
echo "fork up (chain $(cast chain-id --rpc-url "$BOT_RPC_URL")), logs in $LOGS"

node src/demo.ts start --epochs 6 --publishers "$PUBS"
FEED=$(node -e 'console.log(require(process.env.DEMO_SESSION_FILE).feedName)')
FROM=$(node -e 'console.log(require(process.env.DEMO_SESSION_FILE).fromBlock)')
END=$(node -e 'console.log(require(process.env.DEMO_SESSION_FILE).endEpoch)')

for p in B C; do
  node src/publisher.ts --key "PUBLISHER_${p}_PRIVATE_KEY" --feeds "$FEED" --from-block "$FROM" --interval 3 >"$LOGS/pub$p.log" 2>&1 &
done
node src/publisher.ts --key PUBLISHER_D_PRIVATE_KEY --feeds "$FEED" --from-block "$FROM" --interval 3 --rogue >"$LOGS/pubD.log" 2>&1 &

sleep 75
node src/demo.ts scenario crash

ORACLE=$(node -e 'console.log(require("../contracts/deployments/10143.json").RackOracle)')
FEED_ID=$(node -e 'console.log(require(process.env.DEMO_SESSION_FILE).feedId)')
epoch_now() { cast call "$ORACLE" "currentEpoch(bytes32)(uint64)" "$FEED_ID" --rpc-url "$BOT_RPC_URL"; }
until [ "$(epoch_now)" -gt "$((END + 1))" ]; do sleep 5; done
sleep 15
node src/demo.ts status
echo "keeper pass: lists H100 weeks, creates their Kuru books, settles the finished demo series"
node src/keeper.ts --once --feeds H100 --weeks 4
node src/demo.ts status | tail -1

echo "warping fork time past the reveal time of every seed the window depends on..."
cast rpc evm_increaseTime 4500 --rpc-url "$BOT_RPC_URL" >/dev/null
sleep 60

echo "publisher errors: $(cat "$LOGS"/pub*.log | grep -c ': error:' || true)"
echo "benign race skips: $(cat "$LOGS"/pub*.log | grep -c 'skipped:' || true)"
grep -h ': error:' "$LOGS"/pub*.log || true
node src/audit.ts --feed "$FEED" --from-block "$FROM"
