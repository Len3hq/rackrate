# Rackrate

**Lock in the future price of AI compute, one week at a time.**

Rackrate is a market for fully collateralized, cash-settled weekly forwards on GPU rental prices (H100, H200, B200), built on Monad.

- **GPU owners** sell forward and lock in their rental revenue.
- **AI startups** buy forward and lock in their compute costs.
- Every contract is **fully collateralized**, with no leverage and no liquidations. The maximum loss is known before you trade.
- Contracts trade on **Kuru's onchain order book** and settle on the weekly average of an hourly price index from a **multi-publisher oracle**, with one publisher orchestrated by **Chainlink CRE**.

> **Status: work in progress — Monad Metropolis hackathon (Track 01: Onchain Finance & Trading).**
> **Testnet only.** From 2026-W42 (Monday, Oct 12) the hourly H100 index follows real GPU clouds' published on-demand H100 prices (median across providers, from [gpurentalprices.com](https://gpurentalprices.com) data, CC BY 4.0), with small modelled moves within each day. Earlier weeks and demo weeks use a simulated index.

## How it works

1. **Price index.** Three publishers post an hourly GPU rental price. The oracle takes the median, rejects stale, out-of-bounds or jumping prints, and records gaps rather than guessing.
2. **Weekly series.** Each (GPU, week) series has a price floor and cap. Depositing `(cap − floor) × hours` in test dollars mints one **LONG** and one **SHORT** token.
3. **Settlement.** After the week ends:
   - LONG pays `(average − floor) × hours`.
   - SHORT pays `(cap − average) × hours`.

   The two payouts always add up to the deposited collateral.
4. **Trading.** LONG trades on a Kuru order book against the test dollar. Its price implies the market's forward rate for that week.
5. **One-transaction hedges.** `HedgeRouter` turns a multi-week hedge into one atomic transaction on Kuru:
   - **GPU owner (`hedge`):** mints each week, keeps SHORT and sells LONG, which locks in revenue.
   - **AI startup (`buyLongs`):** buys LONG for each week, which locks in cost.
   - Every leg is fill-or-kill with a minimum price, so the whole ladder executes or nothing does.

## Repository layout

| Path | Contents |
|---|---|
| `contracts/` | Solidity (Foundry): test dollar, oracle, series factory, hedge router, Kuru interfaces |
| `cre/` | Chainlink CRE workflow (oracle publisher A) and its hourly runner |
| `bots/` | Publisher bots, demo ticker, keeper, market maker |
| `indexer/` | Envio HyperIndex indexer: markets, Kuru fills, wallet history, oracle hours |
| `app/` | Next.js web app: landing page, trading, portfolio, oracle explorer and docs |
| `docs/` | Architecture notes and the [decisions log](docs/DECISIONS.md) |

## Web app

`app/` is a Next.js 16 site with light and dark themes:
- **Landing page:** the live forward curve, an interactive payoff explorer, and the oracle's latest publishers.
- **Trade:** hedge revenue or lock compute cost across several weeks in one transaction.
- **Portfolio:** faucet, positions, redeem, settle and claim.
- **Oracle:** every hourly print, gap and publisher submission.
- **Docs.**

It reads the chain directly (batched multicalls through viem and wagmi), and works with any browser wallet discovered through EIP-6963. Quotes are exact: the app simulates the real `HedgeRouter` transaction against the live Kuru books, overriding rrUSD balance and allowance in the simulation, so quotes show before you connect or approve.

```sh
pnpm install
pnpm -C app dev                     # http://localhost:3000
pnpm -C app sync-abis               # after changing contracts: refresh ABIs and addresses from contracts/out
app/scripts/e2e-fork.sh             # browser end-to-end test on a local fork (needs anvil and Chrome; ~8 min)
app/scripts/e2e-fork.sh settle      # rehearse W41's settlement: time moves past the window, keeper settles, app claims
```

The end-to-end test drives the real UI with a test wallet against a fork of Monad testnet. It covers faucet, approval, a two-week hedge, a purchase, closing both positions (buy-back plus redeem, and redeem plus sell), and a demo week that is hedged, settled and claimed in the app.

Open positions can be closed before settlement from Portfolio. Close redeems matched pairs, sells extra LONG into the book from the wallet, and buys back LONG to match extra SHORT. A live demo week (about 10 minutes, see below) appears on Trade alongside the weekly markets.

## Quick start (contracts)

Requires [Foundry](https://getfoundry.sh) **v1.8+** (Monad execution support).

```sh
cd contracts
forge install
forge build
forge test

# End-to-end smoke test against the deployed testnet contracts (local fork, nothing is broadcast)
RUN_FORK_TESTS=true MONAD_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-path "test/fork/*"
```

## Oracle publishers (bots)

Requires Node 22.6+ and pnpm. Run `forge build` in `contracts/` first (the bots read ABIs from its output).

```sh
pnpm install
pnpm -C bots test          # price-model and real-price reference unit tests
pnpm -C bots typecheck

# Live publishers B and C on the hourly feeds, in the background (keys and PRICE_MASTER_SECRET from contracts/.env)
bots/scripts/publishers.sh start H100      # or H100,H200,B200
bots/scripts/publishers.sh status          # also: logs, stop

# Real prices: from 2026-W42 the publishers price H100 hours from the day's real reference (bots/src/lib/reference.ts),
# fetched once a day from public snapshots. After changing that file, refresh the web app's copy:
pnpm -C app sync-reference

# Allowlist the publisher wallets on feeds (owner only, once)
cd contracts && PUBLISH_FEEDS=H100 forge script script/SetPublishers.s.sol --rpc-url $MONAD_RPC_URL --broadcast

# Live demo week: a fresh 30-second feed and a 20-epoch series (~10 minutes) with its own Kuru book.
# B and C publish it alongside H100; the market maker quotes it; it shows on Trade as "H100 demo week".
bots/scripts/demo.sh start            # ~0.5 MON of deployer gas
bots/scripts/demo.sh scenario crash   # or spike / reset
bots/scripts/demo.sh status
bots/scripts/demo.sh stop             # after it settles: publishers back to H100 only

# Independent audit: re-derive every submitted price from the seeds revealed onchain
pnpm -C bots exec node src/audit.ts --feed <feed name> --from-block <block>

# Full end-to-end test on a local fork (nothing is broadcast)
bots/scripts/e2e-fork.sh
```

Each publisher commits a hash of its per-period seed onchain **before** the seed is used, and reveals the seed afterwards. Anyone can then re-derive every price it submitted.

## Indexer (Envio HyperIndex)

`indexer/` indexes Rackrate on Monad testnet through Envio's HyperSync. It records:
- every series, with volume, last price, open pairs and settlement;
- every fill on the weekly Kuru books, whose books are discovered automatically from `MarketCreated`;
- a per-wallet history of hedges, buys, sells, redemptions and claims;
- every finalized oracle hour;
- running protocol totals (volume, fills, GPU-weeks hedged, distinct traders).

The app uses it, when `NEXT_PUBLIC_INDEXER_URL` is set, for:
- Portfolio history;
- recent trades on each book;
- the landing page's volume and hedge totals;
- the oracle chart's 3-day and 7-day history (one query instead of many chain reads).

Without it, or while it is unreachable, the same views fall back to chain reads. Locally, put `NEXT_PUBLIC_INDEXER_URL=http://localhost:8082/v1/graphql` in `app/.env.local`.

```sh
cp indexer/.env.example indexer/.env      # add a free HyperSync token from https://envio.dev/app/api-tokens
pnpm -C indexer test                      # handler tests with simulated events (no network, no Docker)
indexer/scripts/local.sh start            # local run (needs Docker): GraphQL at http://localhost:8082/v1/graphql
indexer/scripts/local.sh status           # also: logs, stop
```

## Keeper and weekly markets

The keeper keeps the market running:
- It lists each upcoming weekly series (Monday 00:00 UTC to Monday 00:00 UTC, 168 hourly epochs, four weeks ahead).
- It creates each series' Kuru order book through `MarketRegistry`. Anyone can call it, it has no owner, and the market parameters are fixed in the contract.
- It settles finished series.

```sh
bots/scripts/keeper.sh start H100 4    # also: status, logs, stop
pnpm -C bots settlement                # each week's coverage, when it can settle, and the result once settled
pnpm -C bots exec node src/keeper.ts --once
```

Live H100 weeks on testnet (find them onchain with `SeriesFactory.allSeries` and `MarketRegistry.bookOf`):

| Week | Window (UTC) | LONG token | Kuru book |
|---|---|---|---|
| 2026-W41 | Oct 5 to Oct 12 | `rrH100W41L` | [`0xAb59…0f7c`](https://testnet.monadvision.com/address/0xAb591619699EE9d690627016B15781ca55f50f7c) |
| 2026-W42 | Oct 12 to Oct 19 | `rrH100W42L` | [`0x0bBb…7b27`](https://testnet.monadvision.com/address/0x0bBb8aC8189EeFB3AB41045c550fb19640fA7b27) |
| 2026-W43 | Oct 19 to Oct 26 | `rrH100W43L` | [`0x027d…2f5F`](https://testnet.monadvision.com/address/0x027d0B4A4e3B07b74002eDc7A5F7262068432f5F) |
| 2026-W44 | Oct 26 to Nov 2 | `rrH100W44L` | [`0xAdc2…40B0`](https://testnet.monadvision.com/address/0xAdc2970ba0F47fA73Df99Ee825Ec7e1Cb36140B0) |

## Market maker (test liquidity)

A team-run maker keeps every live weekly book quoted, so the hedge and buy screens have liquidity to trade against. Its wallet is [`0xfbF0…6232`](https://testnet.monadvision.com/address/0xfbF0102a17Ed91E55AA28bdbF7b69a41c9546232).
- **Fair value** of a LONG token is `(clamp(expected average, floor, cap) − floor) × epochs`.
- The **expected average** blends the prices already printed in the window with the trailing one-week mean for the hours still to come.
- **Quotes:** two levels per side, ±1.5% (5 GPU-weeks) and ±4% (10 GPU-weeks), as post-only limit orders. Each book is updated with one Kuru `batchUpdate`.
- **When it requotes:** only when fair value moves more than 1.5% or an order fills. It stops quoting an hour before a window ends.
- **Funding:** bids use rrUSD and asks use LONG minted from the series, both held in Kuru's margin account. The maker only places resting orders and never takes liquidity, so it can't trade with itself.

```sh
bots/scripts/mm.sh start               # also: status, logs, stop, cancel (pull every quote)
pnpm -C bots exec node src/mm.ts --recover   # rebuild the maker's order state from the chain
bots/scripts/mm-fork.sh                # end-to-end on a local fork: quote, trader fills via HedgeRouter, requote
```

## Chainlink CRE publisher

Publisher A of the oracle is a [Chainlink CRE](https://docs.chain.link/cre) workflow (`cre/price-publisher`). Each hour it:
1. reads the feed state through Multicall3;
2. from 2026-W42, fetches the day's real H100 prices through **CRE's HTTP capability** (each node computes the median across providers; the nodes agree on the median of their results);
3. computes the price with the **same model files** the bots use (`bots/src/lib/priceModel.ts`, `reference.ts`), with the secret master seed held in CRE Secrets;
4. sends a signed report through Chainlink's forwarder to `CreReceiver`.

`CreReceiver` is the allowlisted publisher address. It executes the report's batch of oracle actions (commit seeds, submit price, reveal seeds), each in isolation.

```sh
cd cre/price-publisher && bun install && bun test   # unit tests of the real-price fetch, with the SDK's HTTP mock
cre/scripts/run.sh once      # one simulation with real onchain writes (cre workflow simulate --broadcast)
cre/scripts/run.sh start     # hourly, in the background (also: status, logs, stop)
```

**Status:**
- The workflow runs in **simulation mode** (`--broadcast`, through Chainlink's MockKeystoneForwarder) while CRE deploy access is pending.
- Moving it to Chainlink's network is a deploy plus `CreReceiver.setForwarder(<KeystoneForwarder>)`. No contract redeploy is needed.

## Hosting

| Component | Where | Build | Start |
|---|---|---|---|
| Publisher B | Railway | `bots/Dockerfile` | `node src/publisher.ts --key PUBLISHER_B_PRIVATE_KEY --feeds H100 --interval 60` |
| Publisher C | Railway | `bots/Dockerfile` | `node src/publisher.ts --key PUBLISHER_C_PRIVATE_KEY --feeds H100 --interval 60 --skip-finalize --delay 20` |
| Keeper | Railway | `bots/Dockerfile` | `node src/keeper.ts --feeds H100 --weeks 4 --interval 300` |
| Market maker | Railway, volume at `/data` | `bots/Dockerfile` | `node src/mm.ts --interval 60` |
| Web app | Railway (root directory `app`) or Vercel | Next.js | `npm start` |
| Indexer | Envio Cloud (root directory `indexer`) | `config.yaml` | managed |
| CRE publisher | Railway, simulation mode until CRE deploy access | `cre/Dockerfile` | image default (`scripts/run.sh loop`, hourly) |

Notes:
- The bots image ships the ABIs from `app/src/lib/generated.ts`, so it needs no Solidity toolchain.
- **Secrets** are service variables, never in the repo: `BOT_RPC_URL`, `PRICE_MASTER_SECRET` and each service's key (`PUBLISHER_B_PRIVATE_KEY`, `PUBLISHER_C_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY` for the keeper, `MM_PRIVATE_KEY`). The market maker also gets `MM_STATE_FILE=/data/mm-state.json`.
- The **CRE publisher** takes `CRE_MONAD_RPC_URL`, `CRE_PRICE_MASTER_SECRET` (the same value as `PRICE_MASTER_SECRET`) and `CRE_ETH_PRIVATE_KEY` (the simulator key that pays for the forwarder transaction). It signs in with `CRE_API_KEY` once CRE deploy access is granted; until then with `CRE_CREDENTIALS` (`base64 -i ~/.cre/cre.yaml` after `cre login`) and a volume at `/root/.cre`, where the CLI keeps the login it renews.
- **One process per key.** Stop a bot on any other host before starting it on Railway, or the two will collide on nonces. A market maker that starts without a state file adopts its resting orders from the chain first.

## Network

| | |
|---|---|
| Network | Monad Testnet |
| Chain ID | 10143 |
| RPC | https://testnet-rpc.monad.xyz |
| Explorer | https://testnet.monadvision.com · https://testnet.monadscan.com |
| Faucet | https://faucet.monad.xyz |

### Deployed contracts (Monad testnet, verified)

| Contract | Address |
|---|---|
| rrUSD (test dollar) | [`0x7C3358F8833B2a2113636b5e2707dB8354eD5DfE`](https://testnet.monadvision.com/address/0x7C3358F8833B2a2113636b5e2707dB8354eD5DfE) |
| RackOracle | [`0x495231539161D0e8e3f9b509e70Cc5aB2b4120dc`](https://testnet.monadvision.com/address/0x495231539161D0e8e3f9b509e70Cc5aB2b4120dc) |
| SeriesFactory | [`0x750d1B8550704a8452C8db17Ba53352C8c28aDF4`](https://testnet.monadvision.com/address/0x750d1B8550704a8452C8db17Ba53352C8c28aDF4) |
| HedgeRouter | [`0xE5eB6018cedC90204a7b27fF5dF083Dfa781226C`](https://testnet.monadvision.com/address/0xE5eB6018cedC90204a7b27fF5dF083Dfa781226C) |
| CreReceiver (Chainlink CRE publisher) | [`0xcBC04cA6f77f5aD7d583DB4DfC34C65A49dD4310`](https://testnet.monadvision.com/address/0xcBC04cA6f77f5aD7d583DB4DfC34C65A49dD4310) |
| MarketRegistry | [`0x7BFefe8EeFC2F73148950dd876870AB4FEC774e5`](https://testnet.monadvision.com/address/0x7BFefe8EeFC2F73148950dd876870AB4FEC774e5) |

Oracle feeds: `H100`, `H200`, `B200` (hourly) and `H100_DEMO`, `H200_DEMO`, `B200_DEMO` (30-second demo epochs). The feed ID is `keccak256(name)`. The full deployment record is in [`contracts/deployments/10143.json`](contracts/deployments/10143.json).

## Honest limits (testnet)

- From 2026-W42 the index **level is real** (GPU clouds' published on-demand H100 prices, which change daily at most); the movement **within a day is modelled** (about ±2–3%). These are listed prices, not negotiated contract rates. Weeks before W42 and demo weeks use a simulated index.
- All oracle publishers (two bots and a Chainlink CRE workflow) are operated by the team. On mainnet, the publishers would be GPU hosts signing their own rental rates.
- The CRE workflow currently runs in Chainlink's simulation mode on the team's server, pending CRE deploy access.
- Liquidity on the order books comes from a team-run test market maker. **It is not organic volume.**

## Attribution

- H100 price data: [gpurentalprices.com](https://gpurentalprices.com), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Rackrate derives its index from it (median of each provider's on-demand H100 SXM price, then the median across providers).
- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) (MIT)
- [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0)
- [viem](https://github.com/wevm/viem) (MIT)
- [Chainlink CRE SDK](https://www.npmjs.com/package/@chainlink/cre-sdk) (BUSL-1.1), used as a dependency of the workflow and not vendored. The `IReceiver` interface follows the CRE documentation.
- [Kuru](https://docs.kuru.io) onchain order book (testnet). `contracts/src/interfaces/IKuru.sol` declares only the function signatures Rackrate calls, taken from Kuru's public documentation.
- [React Bits](https://reactbits.dev) components (Threads, CountUp, SpotlightCard) in `app/src/components/reactbits/`, used as part of the app under their MIT + Commons Clause license (see the `LICENSE.md` in that folder). They are not covered by this repository's MIT license.
- Design guidance from [Taste Skill](https://github.com/Leonxlnx/taste-skill) (MIT).
- Next.js, React, Tailwind CSS, Motion, wagmi, TanStack Query, OGL, Phosphor Icons and the Geist typefaces (open source licenses).
- [Envio HyperIndex](https://envio.dev) (`envio` package, used as a dependency under Envio's EULA, not vendored).
- Photographs from Wikimedia Commons: CSIRO ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0)), Carl Lender ([CC BY 2.0](https://creativecommons.org/licenses/by/2.0)), Derrick Coetzee (CC0). The site credits them in its footer.

## AI tool disclosure

This project was built with the assistance of AI coding tools (Claude Code). All code is reviewed and tested by the team.

## License

[MIT](LICENSE)
