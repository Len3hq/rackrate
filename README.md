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
| `docs/` | Architecture, oracle and settlement specs |

## Quick start (contracts)

Requires [Foundry](https://getfoundry.sh) **v1.8+** (Monad execution support).

```sh
cd contracts
forge install
forge build
forge test
```

## Network

| | |
|---|---|
| Network | Monad Testnet |
| Chain ID | 10143 |
| RPC | https://testnet-rpc.monad.xyz |
| Explorer | https://testnet.monadvision.com · https://testnet.monadscan.com |
| Faucet | https://faucet.monad.xyz |

Deployed contract addresses will be listed here.

## Honest limits (testnet)

- The price index is **simulated**, not real market data.
- Two of the three oracle publishers are operated by the team.
- Liquidity on the order books comes from a team-run test market maker. **It is not organic volume.**

## Attribution

- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) (MIT)
- [forge-std](https://github.com/foundry-rs/forge-std) (MIT/Apache-2.0)

## AI tool disclosure

This project was built with the assistance of AI coding tools (Claude Code). All code is reviewed and tested by the team.

## License

[MIT](LICENSE)
