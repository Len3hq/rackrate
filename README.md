# Rackrate

**Lock in the future price of AI compute, one week at a time.**

Rackrate is a market for fully collateralized, cash-settled weekly forwards on GPU rental prices (H100, H200, B200), built on Monad.

- **GPU owners** sell forward and lock in their rental revenue.
- **AI startups** buy forward and lock in their compute costs.
- Every contract is **fully collateralized**, with no leverage and no liquidations. The maximum loss is known before you trade.
- Contracts trade on **Kuru's onchain order book** and settle on the weekly average of an hourly price index from a **multi-publisher oracle**, with one publisher orchestrated by **Chainlink CRE**.

> **Status: work in progress — Monad Metropolis hackathon (Track 01: Onchain Finance & Trading).**
> **Testnet only. The price index on testnet is simulated for demonstration and is not market data.**

## How it works

1. **Price index.** Three publishers post an hourly GPU rental price. The oracle takes the median, rejects stale, out-of-bounds or jumping prints, and records gaps rather than guessing.
2. **Weekly series.** Each (GPU, week) series has a price floor and cap. Depositing `(cap − floor) × hours` in test dollars mints one **LONG** and one **SHORT** token.
3. **Settlement.** After the week ends:
   - LONG pays `(average − floor) × hours`.
   - SHORT pays `(cap − average) × hours`.

   The two payouts always add up to the deposited collateral.
4. **Trading.** LONG trades on a Kuru order book against the test dollar. Its price implies the market's forward rate for that week.

## Repository layout

| Path | Contents |
|---|---|
| `contracts/` | Solidity (Foundry): test dollar, oracle, series factory, hedge router |
| `cre/` | Chainlink CRE workflow (oracle publisher) |
| `bots/` | Publisher bots, demo ticker, keeper, market maker |
| `indexer/` | Envio HyperIndex |
| `app/` | Next.js frontend (Privy) |
| `docs/` | Architecture notes and the [decisions log](docs/DECISIONS.md) |

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
pnpm -C bots test          # price-model unit tests
pnpm -C bots typecheck

# Publish prices to the hourly feeds (keys and PRICE_MASTER_SECRET from contracts/.env)
pnpm -C bots publisher --key PUBLISHER_B_PRIVATE_KEY --feeds H100,H200,B200

# Demo session: a fresh 30-second feed and a series that settles in ~10 minutes
pnpm -C bots demo start --gpu H100
pnpm -C bots demo scenario crash    # or spike / reset
pnpm -C bots demo status
pnpm -C bots demo settle

# Independent audit: re-derive every submitted price from the seeds revealed onchain
pnpm -C bots exec node src/audit.ts --feed <feed name> --from-block <block>

# Full end-to-end test on a local fork (nothing is broadcast)
bots/scripts/e2e-fork.sh
```

Each publisher commits a hash of its per-period seed onchain **before** the seed is used, and reveals the seed afterwards. Anyone can then re-derive every price it submitted.

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

Oracle feeds: `H100`, `H200`, `B200` (hourly) and `H100_DEMO`, `H200_DEMO`, `B200_DEMO` (30-second demo epochs). The feed ID is `keccak256(name)`. The full deployment record is in [`contracts/deployments/10143.json`](contracts/deployments/10143.json).

## Honest limits (testnet)

- The price index is **simulated**, not real market data.
- All oracle publishers (two bots and a Chainlink CRE workflow) are operated by the team. On mainnet, the publishers would be GPU hosts signing their own rental rates.
- Liquidity on the order books comes from a team-run test market maker. **It is not organic volume.**

## Attribution

- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) (MIT)
- [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0)
- [viem](https://github.com/wevm/viem) (MIT)

## AI tool disclosure

This project was built with the assistance of AI coding tools (Claude Code). All code is reviewed and tested by the team.

## License

[MIT](LICENSE)
