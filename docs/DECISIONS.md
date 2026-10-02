# Architecture decisions

A log of the important design decisions behind Rackrate and why they were made. Only decisions that shape the system are recorded here, not routine implementation details. Newest entries go at the bottom.

---

### 001 — Run our own multi-publisher GPU price oracle
**Date:** 2026-10-01
**Decision:** Rackrate settles against its own oracle (`RackOracle`) rather than an existing price feed.
**Why:**
- No oracle network publishes GPU rental prices on Monad.
- The commercial indices (Ornn OCPI, Silicon Data) and marketplace APIs (Vast.ai) forbid building or republishing an index from their data without a license.
- A multi-publisher design is also the production path: GPU hosts signing their own rental rates.

**Consequences:**
- On testnet the index is **simulated** and labeled as such everywhere.
- One publisher runs on Chainlink CRE; the others are bots.

### 002 — Median of publishers, finalized in order, gaps recorded but never filled
**Date:** 2026-10-01
**Decision:**
- Each epoch's price is the median of at least `minPublishers` submissions, then checked against fixed bounds and a jump limit.
- Epochs finalize strictly in order. An epoch without enough valid data is recorded as a gap; it is never interpolated.
- After 3 consecutive jump rejections the next valid median is accepted, so a genuine regime change can't freeze a feed.
- A feed's bounds, timing and jump limit are immutable once created.

**Why:**
- Settlement must not depend on a single publisher or on invented data.
- In-order finalization plus cumulative sums gives O(1) window averages for settlement.
- Immutable feed parameters stop the admin from changing the rules mid-series.

**Consequences:**
- **Outlier resistance needs at least 3 publishers.** With 2, the median is their average, and one bad price moves it.
- Finalizing an empty epoch costs about 47.5k gas. See 006.

### 003 — Fully collateralized range forwards (LONG/SHORT), no leverage
**Date:** 2026-10-01
**Decision:**
- Each weekly series has a price floor and cap. Minting deposits `(cap − floor) × epochs` and creates equal LONG and SHORT tokens.
- At settlement, LONG pays `(avg − floor) × epochs` and SHORT pays `(cap − avg) × epochs`.

**Why:**
- The target users are hedgers (GPU owners, AI startups), not leveraged speculators.
- Full collateral removes liquidations, margin calls and any dependence on real-time oracle accuracy.
- The maximum loss is known before trading.
- This is the clearest difference from the GPU perps that already exist on Hyperliquid, Injective and Bitget.

**Consequences:**
- Outside [floor, cap] a hedge is only partial, which must be disclosed in the UI.
- Tokens have 6 decimals: 1e6 units = 1 GPU for the whole window.
- Rounding always favours the contract: mint rounds up, payouts round down.

### 004 — Settlement gap rule
**Date:** 2026-10-01
**Decision:**
- If at least 90% of a window's epochs printed, settle on their average.
- Otherwise wait a grace period, then settle on whatever printed.
- If nothing printed at all, settle at the midpoint of the range.

**Why:** settlement must always complete and be predictable, without guessing prices for missing hours or freezing user funds.

### 005 — Testnet only, with a test collateral token
**Date:** 2026-10-01
**Decision:**
- Deploy only to Monad testnet.
- Use `rrUSD`, a 6-decimal test dollar with a rate-limited public faucet. A disclosed initial supply goes to the deployer to seed market-maker liquidity.

**Why:** LONG/SHORT are commodity derivatives, and Metropolis rules make participants responsible for the legal status of tokens. Testnet avoids a public offering while showing the full mechanism.

### 006 — Fresh demo feed per demo session
**Date:** 2026-10-02
**Decision:** each demo session creates a new 30-second demo feed with its own publishers, instead of reusing one long-lived demo feed.
**Why:**
- An idle feed builds up a backlog of unfinalized epochs.
- At ~47.5k gas per empty epoch, one idle day on a 30-second feed (~2,880 epochs) would cost about 14 MON to catch up.
- A fresh feed has no backlog.
- Hourly feeds are unaffected, since publishers print every epoch.

### 007 — Deterministic, stateless simulated index with committed seeds
**Date:** 2026-10-02
**Decision:**
- The simulated price for any epoch is a pure function of secret per-period seeds, the feed and the epoch. It combines a daily cycle, smooth multi-day noise and occasional regime shocks. Each publisher adds a ±0.8% deviation; scenarios scale it.
- Per-period seeds are derived from one secret master. Each seed is committed onchain before any price uses it, and revealed afterwards.
- A price in period P uses seeds up to P + lookahead (2 periods for hourly feeds, 6 for 30-second demo feeds), so publishers commit that far ahead.

**Why:**
- Publishers, the Chainlink CRE workflow and auditors must compute identical prices without shared state.
- Prices must be unpredictable before reveal (otherwise traders could compute future settlement), yet fully re-derivable afterwards.
- An early version committed only one period ahead. That was enough for hourly feeds, but on demo feeds a price relied on seeds committed later than it was used. The test suite now checks the lookahead property directly.

**Consequences:**
- `bots/src/audit.ts` re-derives every submission from public chain data.
- Regime shocks are limited to every other 72-hour block, so single-epoch moves stay under the 25% jump limit.

### 008 — Bots in TypeScript on Node's native type stripping, with viem
**Date:** 2026-10-02
**Decision:** run the bots as plain `.ts` files on Node 22.6+ (no build step), using viem, with ABIs loaded from Foundry's build output.
**Why:**
- No compile step to drift from the source.
- viem has first-class Monad testnet support.
- Loading ABIs from `contracts/out` keeps the bots in sync with the contracts.

**Consequences:**
- `forge build` must run before the bots.
- Code must use only erasable TypeScript syntax (no enums or namespaces).

### 009 — Publisher gas strategy for Monad's gas-limit billing
**Date:** 2026-10-02
**Decision:**
- Publishers send transactions with exact estimates plus 15%, with no standing buffer.
- A submit that reverts onchain (it ran out of gas because another publisher's submit landed first, making it the epoch's finalizer) is retried once with finalize headroom.
- Exactly one publisher (B) finalizes backlogs. The other (C) runs 20 seconds behind B and skips finalization.

**Why:**
- Monad bills the full gas *limit*, even for reverted transactions.
- On the first live run, a standing 150k-gas buffer more than doubled the cost of every submit (285k billed vs ~118k needed).
- Two publishers finalizing the same backlog meant one always reverted and paid in full.

**Consequences:**
- Running cost is roughly halved.
- Staggering means C normally lands last, so its estimate already covers finalizing the epoch.
- The rare race costs one reverted transaction and a retry.

### 010 — Kuru integration: wallet-direct market orders through a stateless router
**Date:** 2026-10-02
**Decision:**
- Each series' LONG token gets its own Kuru LONG/rrUSD market. Parameters:
  - price precision 1e4 with a $0.01 tick;
  - size precision = 10^LONG decimals (1e6, so size units equal token units);
  - minimum size 0.01 GPU-window;
  - zero fees on testnet.
- `HedgeRouter` executes multi-week hedges and purchases in one transaction using Kuru market orders with `_isMargin = false` and fill-or-kill, plus caller-set minimums.
- Makers (the market-maker bot) quote with limit orders funded from Kuru's margin account.

**Why:**
- Probing Kuru's real testnet contracts on a fork showed that wallet-direct market orders settle straight with the caller. A stateless, ownerless router can therefore trade for the user without ever holding funds or using Kuru's margin system.
- Fill-or-kill makes a ladder all-or-nothing.
- The probe also showed that Kuru takes market-buy budgets in price-precision units, not raw token units. The router converts this and rejects inexact amounts rather than silently rounding.

**Consequences:**
- Kuru's SDK repository has no license, so its ABI files are not vendored. A minimal interface declares only the functions Rackrate calls.
- Fork tests run the full lifecycle on Kuru's real contracts: a 3-week hedge ladder, a buy ladder, and settlement with claims. The revenue-lock property is fuzz-tested.
- Kuru's own UI and WebSocket API are mainnet-only, so Rackrate builds its own trading screens.

### 011 — Chainlink CRE as publisher A, running in simulation mode until deploy access
**Date:** 2026-10-02
**Decision:**
- A CRE workflow (TypeScript) computes the hourly price with the same `priceModel.ts` the bots use, holding the master seed in CRE Secrets.
- It reads chain state through two Multicall3 calls and delivers one signed report per run to `CreReceiver`.
- `CreReceiver` is the allowlisted publisher. It accepts reports only from the configured forwarder (optionally also checking the workflow owner) and executes each action in the batch in isolation.
- Until Chainlink grants deploy access, the workflow runs hourly as `cre workflow simulate --broadcast` through Chainlink's MockKeystoneForwarder, paid by a dedicated simulator wallet.

**Why:**
- A third, independent publisher makes the median resistant to one bad price.
- CRE is the orchestration layer the Chainlink bounty asks for.
- Sharing the model file keeps all three publishers on identical math.
- Batched reads stay within CRE's limit of 15 reads per execution.
- Isolated actions stop one race (an epoch already finalized by another publisher) from discarding the rest of the report. The first live run hit exactly this case.
- Using a dedicated simulator wallet avoids nonce clashes with the bots.

**Consequences:**
- The forwarder is owner-updatable, so moving to Chainlink's network is a workflow deploy plus `setForwarder`, with no contract redeploy.
- Gas allowances per action were measured from a transaction trace (~282k used vs 650k billed on the first run) and set with a margin. A normal hourly run bills about 260k gas.
- CRE only publishes to hourly feeds; demo feeds stay with the bots.
- Simulation runs on the team's machine, so until deployment this publisher is not decentralized. The README states this.
- In a deployed, non-confidential workflow, node operators could see the master seed. That's acceptable for a simulated testnet index, but a real-data mainnet version should source prices differently.
