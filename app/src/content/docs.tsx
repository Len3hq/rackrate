import Link from "next/link";
import { deployment } from "@/lib/generated";
import { LiveBooks } from "./live-books";

const EXPLORER = "https://testnet.monadvision.com/address/";
const A = ({ addr }: { addr: string }) => (
  <a href={`${EXPLORER}${addr}`} target="_blank" rel="noreferrer">
    <code>{addr}</code>
  </a>
);

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  body: React.ReactNode;
}

export const DOCS: DocPage[] = [
  {
    slug: "",
    title: "Introduction",
    description: "What Rackrate is and who it is for.",
    body: (
      <>
        <p>
          Rackrate lists <strong>weekly forwards on the rental price of an H100 GPU</strong>. Each week settles on the average of 168 hourly index prices, from Monday 00:00 UTC to the next Monday. Positions are fully collateralized tokens that trade on Kuru, an onchain order book on Monad.
        </p>
        <h2>Who it is for</h2>
        <ul>
          <li>
            <strong>GPU owners</strong> (cloud providers, miners turned AI hosts, anyone renting out H100s) who want next week&apos;s revenue fixed today. See <Link href="/docs/hedging">Hedging GPU revenue</Link>.
          </li>
          <li>
            <strong>AI teams</strong> who know they will need compute next week and want to cap what it costs. See <Link href="/docs/buying-compute">Locking compute costs</Link>.
          </li>
          <li>
            <strong>Traders</strong> with a view on where GPU rental prices are going.
          </li>
        </ul>
        <h2>Try it in three minutes</h2>
        <ol>
          <li>
            Add Monad testnet to a browser wallet (Rabby, MetaMask, Phantom) and get a little testnet MON for gas from the{" "}
            <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">
              Monad faucet
            </a>
            .
          </li>
          <li>
            Open <Link href="/trade">Trade</Link>, connect, and press <strong>Get 10,000 test rrUSD</strong>. rrUSD is a free test dollar.
          </li>
          <li>Pick one or more weeks, enter how many GPUs, approve rrUSD once, and confirm the hedge or purchase.</li>
          <li>
            Watch the position in <Link href="/portfolio">Portfolio</Link>, where you can also close it early and see your history. After the week ends and settles, claim the payout there.
          </li>
        </ol>
        <h2>Demo weeks</h2>
        <p>
          A real week takes seven days to settle. For demonstrations the team can run a <strong>demo week</strong>: a fresh 30-second index and a series of 20 epochs that settles in about ten minutes. While one is running it appears on <Link href="/trade">Trade</Link> as &quot;H100 demo week&quot;, with its own order book, and it settles and pays out exactly like a weekly series.
        </p>
        <h2>On testnet</h2>
        <p>
          Everything runs on Monad testnet. From 2026-W42 the H100 index follows <strong>real rental prices</strong> published by GPU clouds (earlier weeks used a simulated index), the publishers are operated by the team, and order book liquidity comes from a team-run test market maker. See <Link href="/docs/testnet">Testnet limits</Link>.
        </p>
      </>
    ),
  },
  {
    slug: "how-it-works",
    title: "How it works",
    description: "Series, LONG and SHORT tokens, and how payouts are calculated.",
    body: (
      <>
        <h2>A series is one week</h2>
        <p>
          Every week has its own <strong>series</strong> with a price range: a <strong>floor</strong> of $1 and a <strong>cap</strong> of $5 per GPU-hour for H100. A series covers 168 hourly epochs starting Monday 00:00 UTC.
        </p>
        <h2>Minting a pair</h2>
        <p>
          Depositing the full range, <code>(cap − floor) × 168 = $672</code> in rrUSD, mints one <strong>LONG</strong> and one <strong>SHORT</strong> token. One token covers one GPU for the whole week. Tokens have 6 decimals, so you can hold fractions of a GPU-week.
        </p>
        <p>A LONG and SHORT of the same week together are always worth exactly $672. Before settlement you can redeem a pair for its collateral at any time.</p>
        <h2>Payouts at settlement</h2>
        <p>With A as the weekly average of the hourly index, clamped to the range:</p>
        <pre>
          <code>{`LONG pays  (A − floor) × 168
SHORT pays (cap − A)   × 168`}</code>
        </pre>
        <p>
          If the H100 averages $3.40 for the week, each LONG pays $403.20 and each SHORT pays $268.80. The two always add up to the $672 deposited, so the contract can never owe more than it holds.
        </p>
        <h2>Prices and implied rates</h2>
        <p>
          LONG trades on Kuru against rrUSD. A LONG price converts to an implied rental rate as <code>floor + price ÷ 168</code>. A LONG at $466 implies $3.77 per GPU-hour. The trade screen shows both numbers, every price level on each week&apos;s book, and its recent fills.
        </p>
        <h2>Closing early</h2>
        <p>
          Positions do not have to be held to settlement. <strong>Close</strong> in <Link href="/portfolio">Portfolio</Link> redeems matched LONG and SHORT pairs for $672 each, sells any extra LONG into the week&apos;s order book, and buys back LONG to match any extra SHORT. Each step is quoted before you sign.
        </p>
        <h2>One transaction for many weeks</h2>
        <p>
          The <strong>HedgeRouter</strong> contract builds multi-week positions in a single transaction. Each leg is fill-or-kill with your minimum price, so either every week fills or nothing happens. The router is stateless and never holds funds between transactions.
        </p>
      </>
    ),
  },
  {
    slug: "hedging",
    title: "Hedging GPU revenue",
    description: "For GPU owners: fix next week's rental income today.",
    body: (
      <>
        <p>You rent out GPUs and want next week&apos;s income settled now, whatever happens to rental prices.</p>
        <h2>What the hedge does</h2>
        <p>For each week and GPU, the HedgeRouter:</p>
        <ol>
          <li>takes $672 of rrUSD from you and mints one LONG and one SHORT,</li>
          <li>sells the LONG into the week&apos;s Kuru order book at the best bids,</li>
          <li>sends you the SHORT and the sale proceeds.</li>
        </ol>
        <p>
          You end up holding SHORT, which pays more when rental rates fall. Combined with the rent you actually earn, your week is locked at about <code>floor + proceeds ÷ 168</code> per GPU-hour.
        </p>
        <h2>Worked example</h2>
        <p>
          You hedge one GPU for a week and the LONG sells for $466. Your net outlay is $672 − $466 = $206, and your locked rate is $1 + $466 ÷ 168 ≈ <strong>$3.77/hr</strong>.
        </p>
        <ul>
          <li>Rates fall to an average of $2.50: you earn $420 renting, SHORT pays $420, minus the $206 outlay, so $634.</li>
          <li>Rates rise to $4.50: you earn $756 renting, SHORT pays $84, minus $206, so $634 again.</li>
        </ul>
        <p>Either way the week nets $634, which is about $3.77 × 168.</p>
        <h2>Outside the range</h2>
        <p>The hedge only covers prices between the $1 floor and the $5 cap. If the average lands outside the range, the part beyond it is not hedged. The trade screen and payoff explorer show this.</p>
        <h2>In the app</h2>
        <ol>
          <li>
            On <Link href="/trade">Trade</Link>, choose <strong>Hedge revenue</strong>.
          </li>
          <li>Select the weeks and the number of GPUs (up to two decimals).</li>
          <li>Check the quote: collateral in, proceeds received now and the locked rate per GPU-hour. Quotes simulate the real transaction against the live books.</li>
          <li>Approve rrUSD once, then confirm. A 0.5% slippage limit applies to every week.</li>
        </ol>
      </>
    ),
  },
  {
    slug: "buying-compute",
    title: "Locking compute costs",
    description: "For AI teams: cap the cost of next week's GPU-hours.",
    body: (
      <>
        <p>You will rent H100s next week and want to cap the cost now.</p>
        <h2>What the purchase does</h2>
        <p>
          The HedgeRouter spends your rrUSD at the best asks on each week&apos;s order book and sends you LONG. LONG pays <code>(A − floor) × 168</code>, so it pays more when rental rates rise, offsetting the higher rent you pay.
        </p>
        <h2>Worked example</h2>
        <p>
          You buy one LONG for $480, an implied $1 + $480 ÷ 168 ≈ <strong>$3.86/hr</strong>. If the week averages $4.50, renting costs $756 and LONG pays $588, so you paid $480 + $756 − $588 = $648, about $3.86 × 168. If it averages $3.00, renting costs $504 and LONG pays $336: again $648.
        </p>
        <h2>In the app</h2>
        <ol>
          <li>
            On <Link href="/trade">Trade</Link>, choose <strong>Lock compute cost</strong>.
          </li>
          <li>Select weeks and how much rrUSD to spend on each.</li>
          <li>The quote shows LONG received and the effective rate per GPU-hour. Approve once, then confirm.</li>
        </ol>
      </>
    ),
  },
  {
    slug: "oracle",
    title: "The oracle",
    description: "How the hourly H100 index is published, checked and finalized.",
    body: (
      <>
        <p>
          Settlement uses <strong>RackOracle</strong>, a multi-publisher price feed on Monad. No existing oracle network publishes GPU rental prices on Monad, and the commercial GPU indices do not allow republishing or settlement use, so Rackrate runs its own, built from openly licensed price data.
        </p>
        <h2>Publishers</h2>
        <p>Three allowlisted publishers submit a price every hour:</p>
        <ul>
          <li>
            <strong>A, Chainlink CRE.</strong> A Chainlink Runtime Environment workflow fetches the real price data over CRE&apos;s HTTP capability, computes the price and delivers a report to the <code>CreReceiver</code> contract. Until Chainlink grants deploy access, it runs in CRE simulation mode, with each report delivered onchain through Chainlink&apos;s test forwarder.
          </li>
          <li>
            <strong>B and C, bots.</strong> Two independent processes with separate keys.
          </li>
        </ul>
        <h2>Finalizing an hour</h2>
        <ul>
          <li>The price for an hour is the <strong>median</strong> of at least two submissions.</li>
          <li>It must fall inside fixed bounds ($0.50 to $20 for H100) and within a 25% jump of the previous price. After three jump rejections in a row the next valid median is accepted, so a genuine regime change cannot freeze the feed.</li>
          <li>Hours finalize strictly in order. An hour without enough valid data is recorded as a <strong>gap</strong> and is never filled in.</li>
          <li>Feed parameters are fixed when the feed is created. Nobody, including the team, can change the rules for a live series.</li>
        </ul>
        <h2>Real prices, auditable hours</h2>
        <p>
          From 2026-W42 (Monday, October 12) the H100 index follows <strong>real prices</strong>. Each day Rackrate takes every GPU cloud&apos;s published on-demand H100 SXM price, uses each provider&apos;s median, and then the <strong>median across providers</strong>. The data comes from the open daily snapshots of{" "}
          <a href="https://gpurentalprices.com">gpurentalprices.com</a> (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>), which record each provider&apos;s own pricing page or API.
        </p>
        <ul>
          <li>An hour is priced from the two previous days&apos; values, moving smoothly between them through the day, so every publisher works from the same published snapshots.</li>
          <li>Listed prices change rarely, so the model adds only small intraday texture: a daily demand cycle and slow noise, about 2 to 3% in all.</li>
          <li>That texture comes from secret per-period seeds. Each seed is <strong>committed onchain before any price uses it</strong> and revealed afterwards, so hours cannot be predicted in advance but anyone can re-derive every submission from the revealed seeds and the public snapshots. The repository includes an audit script that does exactly that.</li>
        </ul>
        <p>
          Weeks before W42, and demo weeks, use a fully simulated index from the same committed seeds.
        </p>
        <p>
          See every hour on the <Link href="/oracle">Oracle</Link> page.
        </p>
      </>
    ),
  },
  {
    slug: "settlement",
    title: "Settlement",
    description: "When and how a week settles, including missing hours.",
    body: (
      <>
        <p>
          After the last hour of a week is finalized, anyone can call <code>settle()</code> on the series. The keeper bot does this automatically, and the Portfolio page has a Settle button too.
        </p>
        <h2>The gap rule</h2>
        <table>
          <thead>
            <tr>
              <th>Hours printed</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>90% or more</td>
              <td>Settles immediately on the average of the printed hours.</td>
            </tr>
            <tr>
              <td>Fewer than 90%</td>
              <td>Waits a 24-hour grace period, then settles on the average of whatever printed.</td>
            </tr>
            <tr>
              <td>None</td>
              <td>Settles at the middle of the range ($3).</td>
            </tr>
          </tbody>
        </table>
        <p>Missing hours are never guessed. The rule guarantees that every week settles and that funds are never stuck.</p>
        <h2>Claiming</h2>
        <p>
          Once settled, LONG and SHORT holders call <code>claim()</code> (the Claim button in Portfolio) and receive rrUSD. Rounding always favours the contract by at most one unit, so it can never pay out more than it holds.
        </p>
      </>
    ),
  },
  {
    slug: "contracts",
    title: "Contracts",
    description: "Deployed addresses on Monad testnet.",
    body: (
      <>
        <p>All contracts are verified on Monad testnet. Source code is MIT licensed in the repository.</p>
        <table>
          <thead>
            <tr>
              <th>Contract</th>
              <th>Address</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["RackOracle", "Multi-publisher hourly price feed"],
                ["SeriesFactory", "Creates weekly series"],
                ["HedgeRouter", "One-transaction hedges and purchases"],
                ["MarketRegistry", "Creates and records each week's Kuru book"],
                ["CreReceiver", "Chainlink CRE report receiver (publisher A)"],
                ["rrUSD", "Test dollar with a daily faucet"],
              ] as const
            ).map(([k, what]) => (
              <tr key={k}>
                <td>
                  <strong>{k}</strong>
                  <br />
                  <span className="text-xs text-muted">{what}</span>
                </td>
                <td>
                  <A addr={deployment[k]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Live weekly books</h2>
        <LiveBooks />
        <h2>Kuru</h2>
        <p>
          Books are created through Kuru&apos;s router <A addr={deployment.KuruRouter} /> with fixed parameters: price precision 1e4 ($0.01 tick), size precision 1e6 (one unit per token unit), minimum size 0.01 GPU-week and zero fees on testnet.
        </p>
        <h2>History and fills</h2>
        <p>
          Portfolio history and recent trades come from an <a href="https://envio.dev" target="_blank" rel="noreferrer">Envio HyperIndex</a> indexer of these contracts and the Kuru books. Balances, positions and quotes are always read from the chain itself, so the app keeps working if the indexer is unavailable.
        </p>
      </>
    ),
  },
  {
    slug: "testnet",
    title: "Testnet limits",
    description: "What is real, what is modelled, and what is run by the team.",
    body: (
      <>
        <ul>
          <li>
            <strong>Testnet only.</strong> All tokens are test assets with no monetary value. LONG and SHORT are commodity derivatives, which is why Rackrate is not offered on mainnet.
          </li>
          <li>
            <strong>Real level, modelled hours.</strong> From 2026-W42 the index follows the median of GPU clouds&apos; published H100 prices, which update daily; the hour-to-hour movement within a day is modelled. These are listed on-demand prices, not negotiated contract prices. Weeks before W42 and demo weeks use a simulated index.
          </li>
          <li>
            <strong>Team-run publishers.</strong> All three publishers are operated by the team. In production the publishers would be GPU hosts signing their own rental rates.
          </li>
          <li>
            <strong>CRE in simulation mode.</strong> The Chainlink workflow runs on the team&apos;s server until CRE deploy access is granted. Switching to Chainlink&apos;s network needs no contract redeploy.
          </li>
          <li>
            <strong>Test liquidity.</strong> Quotes on the books come from a team-run market maker that only places resting orders. It is not organic volume.
          </li>
          <li>
            <strong>Partial hedges outside the range.</strong> Prices below $1 or above $5 per hour are not covered.
          </li>
        </ul>
      </>
    ),
  },
];

export const docHref = (slug: string) => (slug ? `/docs/${slug}` : "/docs");
