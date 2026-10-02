/**
 * Rackrate market maker (test liquidity). Quotes a two-sided ladder of post-only limit orders on the Kuru book
 * of every live series, around the LONG token's fair value:
 *
 *   fair = (clamp(expected window average, floor, cap) - floor) x epochs
 *   expected average = (prices printed so far in the window
 *                       + trailing one-week mean price x epochs still to come) / epochs
 *
 * Each requote is one Kuru `batchUpdate` per book (cancel the old ladder, place the new one). A book is requoted
 * only when it has no quotes, fair value moved more than --threshold bps, or one of its orders
 * was filled, so an idle market costs no gas. Quoting stops one hour before a window ends.
 *
 * The maker only places resting orders and never takes liquidity, so it can't trade with itself. Bids are funded
 * with rrUSD and asks with LONG minted from the series (the matching SHORT stays in the maker wallet), both held
 * in Kuru's margin account and topped up as needed.
 *
 * Usage:
 *   node src/mm.ts                    # loop (default every 60 seconds)
 *   node src/mm.ts --once             # one pass
 *   node src/mm.ts --cancel-all       # pull every quote this maker has resting
 *
 * Uses MM_PRIVATE_KEY. Resting order ids are kept in bots/.run/mm-state.json (git-ignored).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Address, type Hex, decodeEventLog, maxUint256 } from "viem";
import { type Ctx, chainTime, ctxFromKeyEnv, errorMessage, send } from "./lib/chain.ts";
import { ROOT, loadAbi, loadDeployment, loadEnv, log } from "./lib/config.ts";
import { type Level, DEFAULT_LEVELS, type Quotes, buildQuotes, fairLong, shouldRequote } from "./lib/fairValue.ts";
import { erc20Abi, kuruMarginAccountAbi, kuruOrderBookAbi } from "./lib/kuru.ts";
import { HOURS_PER_WEEK } from "./lib/weeks.ts";

loadEnv();

const { values } = parseArgs({
  options: {
    interval: { type: "string", default: "60" },
    threshold: { type: "string", default: "150" }, // bps move in fair value that triggers a requote
    once: { type: "boolean", default: false },
    "cancel-all": { type: "boolean", default: false },
  },
});

const STOP_BEFORE_END = 3600n; // stop quoting one hour before the window ends
const REFERENCE_EPOCHS = HOURS_PER_WEEK; // reference price = mean of the last week of hourly prints
const FUNDING_BUFFER_BPS = 12_000n; // top up 20% above what the new quotes need
const STATE_FILE = resolve(ROOT, "bots", ".run", "mm-state.json");
const scope = "mm";

const dep = loadDeployment() as ReturnType<typeof loadDeployment> & {
  MarketRegistry: Address;
  KuruMarginAccount: Address;
};
const oracleAbi = loadAbi("RackOracle");
const factoryAbi = loadAbi("SeriesFactory");
const seriesAbi = loadAbi("Series");
const registryAbi = loadAbi("MarketRegistry");
const ctx: Ctx = ctxFromKeyEnv("MM_PRIVATE_KEY");
const me = ctx.account.address;
const margin = dep.KuruMarginAccount;
const usd = dep.rrUSD as Address;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

interface RestingOrder {
  id: number;
  size: string; // raw units at placement
  price: number;
  isBuy: boolean;
}
interface BookState {
  fair: string;
  quotedAt: number;
  orders: RestingOrder[];
}
type State = Record<Address, BookState>; // keyed by book

function loadState(): State {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State) : {};
}
function saveState(s: State): void {
  mkdirSync(resolve(STATE_FILE, ".."), { recursive: true });
  writeFileSync(`${STATE_FILE}.tmp`, `${JSON.stringify(s, null, 2)}\n`);
  renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}

// ---------------------------------------------------------------------------------------------------------------
// Chain reads
// ---------------------------------------------------------------------------------------------------------------

const read = <T>(address: Address, abi: unknown, functionName: string, args: readonly unknown[] = []) =>
  ctx.pub.readContract({ address, abi: abi as typeof oracleAbi, functionName, args }) as Promise<T>;

interface OnchainFeed {
  nextEpoch: bigint;
  firstEpoch: bigint;
  lastPrice: bigint;
}

interface Market {
  series: Address;
  book: Address;
  long: Address;
  label: string;
  fair: bigint;
  maxPayout: bigint;
  quoting: boolean; // false once the window is about to end
}

async function liveMarkets(now: bigint): Promise<Market[]> {
  const n = await read<bigint>(dep.SeriesFactory, factoryAbi, "seriesCount");
  const out: Market[] = [];
  for (let i = 0n; i < n; i++) {
    const series = await read<Address>(dep.SeriesFactory, factoryAbi, "allSeries", [i]);
    const book = await read<Address>(dep.MarketRegistry, registryAbi, "bookOf", [series]);
    if (BigInt(book) === 0n) continue;
    const [settled, isDemo, windowEnd, feedId, startEpoch, endEpoch, floor, cap, long] = await Promise.all([
      read<boolean>(series, seriesAbi, "settled"),
      read<boolean>(series, seriesAbi, "isDemo"),
      read<bigint>(series, seriesAbi, "windowEnd"),
      read<Hex>(series, seriesAbi, "feedId"),
      read<bigint>(series, seriesAbi, "startEpoch"),
      read<bigint>(series, seriesAbi, "endEpoch"),
      read<bigint>(series, seriesAbi, "floor"),
      read<bigint>(series, seriesAbi, "cap"),
      read<Address>(series, seriesAbi, "long"),
    ]);
    if (settled || isDemo || now >= windowEnd) continue;
    const symbol = await read<string>(long, erc20Abi, "symbol");

    const f = await read<OnchainFeed>(dep.RackOracle, oracleAbi, "getFeed", [feedId]);
    // Reference price for the epochs still to come: the mean of the last week of prints (or of all prints while the
    // feed is younger). A weekly average doesn't follow intraday moves, so neither does the quote; in simulation this
    // cuts requotes from ~4.9 to ~1.1 per book per day versus a 24h mean. Falls back to the last print.
    if (f.lastPrice === 0n || f.nextEpoch <= f.firstEpoch) continue; // nothing printed yet
    const refFrom = f.nextEpoch - REFERENCE_EPOCHS > f.firstEpoch ? f.nextEpoch - REFERENCE_EPOCHS : f.firstEpoch;
    const [refSum, refCount] = await read<[bigint, bigint, bigint]>(dep.RackOracle, oracleAbi, "windowStats", [
      feedId,
      refFrom,
      f.nextEpoch - 1n,
    ]);
    const reference = refCount > 0n ? refSum / refCount : f.lastPrice;
    let printedSum = 0n;
    let printedCount = 0n;
    const elapsedTo = endEpoch < f.nextEpoch - 1n ? endEpoch : f.nextEpoch - 1n;
    if (elapsedTo >= startEpoch && startEpoch >= f.firstEpoch) {
      [printedSum, printedCount] = await read<[bigint, bigint, bigint]>(dep.RackOracle, oracleAbi, "windowStats", [
        feedId,
        startEpoch,
        elapsedTo,
      ]);
    }
    const firstOpen = f.nextEpoch > startEpoch ? f.nextEpoch : startEpoch;
    const remaining = endEpoch >= firstOpen ? endEpoch - firstOpen + 1n : 0n;
    const epochs = endEpoch - startEpoch + 1n;
    const fair = fairLong({ floor, cap, epochs, printedSum, printedCount, remaining, spot: reference });
    out.push({
      series,
      book,
      long,
      label: symbol,
      fair,
      maxPayout: (cap - floor) * epochs,
      quoting: now < windowEnd - STOP_BEFORE_END,
    });
  }
  return out;
}

/** Our orders that are still resting untouched, and whether any of them traded since placement. */
async function checkOrders(book: Address, orders: RestingOrder[]): Promise<{ live: RestingOrder[]; filled: boolean }> {
  const live: RestingOrder[] = [];
  let filled = false;
  for (const o of orders) {
    const [owner, size] = await read<[Address, bigint]>(book, kuruOrderBookAbi, "s_orders", [o.id]);
    if (owner.toLowerCase() !== me.toLowerCase() || size === 0n) {
      filled = true; // fully filled (Kuru deletes the order)
      continue;
    }
    if (size !== BigInt(o.size)) filled = true; // partially filled
    live.push({ ...o, size: size.toString() });
  }
  return { live, filled };
}

// ---------------------------------------------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------------------------------------------

const quoteNotional = (price: number, size: bigint) => (BigInt(price) * size + 9_999n) / 10_000n; // rrUSD raw, rounded up
const bidNotional = (q: Quotes["bids"]) => q.reduce((s, b) => s + quoteNotional(b.price, b.size), 0n);
const askSize = (q: Quotes["asks"]) => q.reduce((s, a) => s + a.size, 0n);
const lockedQuote = (orders: RestingOrder[]) =>
  orders.filter((o) => o.isBuy).reduce((s, o) => s + quoteNotional(o.price, BigInt(o.size)), 0n);
const lockedBase = (orders: RestingOrder[]) => orders.filter((o) => !o.isBuy).reduce((s, o) => s + BigInt(o.size), 0n);

async function ensureAllowance(token: Address, spender: Address, needed: bigint): Promise<void> {
  const current = await read<bigint>(token, erc20Abi, "allowance", [me, spender]);
  if (current >= needed) return;
  await send(ctx, { address: token, abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] });
}

async function depositToMargin(token: Address, amount: bigint): Promise<void> {
  await ensureAllowance(token, margin, amount);
  await send(ctx, { address: margin, abi: kuruMarginAccountAbi, functionName: "deposit", args: [me, token, amount] });
}

const marginBalance = (token: Address) => read<bigint>(margin, kuruMarginAccountAbi, "getBalance", [me, token]);
const walletBalance = (token: Address) => read<bigint>(token, erc20Abi, "balanceOf", [me]);

/** Make sure the margin account holds `needed` more of `token` than is free now, with a buffer. */
async function topUp(token: Address, needed: bigint, mintFrom?: Address): Promise<void> {
  const free = await marginBalance(token);
  if (free >= needed) return;
  const amount = (needed * FUNDING_BUFFER_BPS) / 10_000n - free;
  if (mintFrom) {
    const have = await walletBalance(token);
    if (have < amount) {
      const units = ((amount - have + 999_999n) / 1_000_000n) * 1_000_000n; // whole tokens
      const cost = await read<bigint>(mintFrom, seriesAbi, "collateralForMint", [units]);
      if ((await walletBalance(usd)) < cost) throw new Error(`not enough rrUSD to mint ${units} LONG (${cost} needed)`);
      await ensureAllowance(usd, mintFrom, cost);
      await send(ctx, { address: mintFrom, abi: seriesAbi, functionName: "mint", args: [units] });
      log(scope, `minted ${Number(units) / 1e6} LONG/SHORT pairs of ${mintFrom}`);
    }
  } else if ((await walletBalance(token)) < amount) {
    throw new Error(`not enough rrUSD in the maker wallet (${amount} needed for margin)`);
  }
  await depositToMargin(token, amount);
  log(scope, `deposited ${Number(amount) / 1e6} of ${token} into the Kuru margin account`);
}

// ---------------------------------------------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------------------------------------------

async function batchUpdate(
  book: Address,
  quotes: Quotes,
  cancel: RestingOrder[],
): Promise<{ placed: RestingOrder[]; gasUsed: bigint }> {
  const hash = await send(ctx, {
    address: book,
    abi: kuruOrderBookAbi,
    functionName: "batchUpdate",
    args: [
      quotes.bids.map((b) => b.price),
      quotes.bids.map((b) => b.size),
      quotes.asks.map((a) => a.price),
      quotes.asks.map((a) => a.size),
      cancel.map((o) => o.id),
      true, // post-only: never take liquidity
    ],
  });
  const receipt = await ctx.pub.getTransactionReceipt({ hash });
  const placed: RestingOrder[] = [];
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== book.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: kuruOrderBookAbi, data: l.data, topics: l.topics });
      if (ev.eventName !== "OrderCreated" || ev.args.owner.toLowerCase() !== me.toLowerCase()) continue;
      placed.push({ id: ev.args.orderId, size: ev.args.size.toString(), price: ev.args.price, isBuy: ev.args.isBuy });
    } catch {
      // other Kuru events
    }
  }
  return { placed, gasUsed: receipt.gasUsed };
}

const usdStr = (micro: bigint) => `$${(Number(micro) / 1e6).toFixed(2)}`;
const ladderStr = (q: Quotes) =>
  `bids ${q.bids.map((b) => `${Number(b.size) / 1e6}@${(b.price / 1e4).toFixed(2)}`).join(", ") || "-"} | asks ${
    q.asks.map((a) => `${Number(a.size) / 1e6}@${(a.price / 1e4).toFixed(2)}`).join(", ") || "-"
  }`;

async function tick(levels: Level[]): Promise<void> {
  const state = loadState();
  const now = await chainTime(ctx.pub);
  const markets = await liveMarkets(now);
  const liveBooks = new Set(markets.map((m) => m.book));

  // Pull quotes from books we no longer quote (window ending, settled, or no longer listed).
  for (const [book, st] of Object.entries(state) as [Address, BookState][]) {
    const m = markets.find((x) => x.book === book);
    if (liveBooks.has(book) && m?.quoting) continue;
    const { live } = await checkOrders(book, st.orders);
    if (live.length > 0) {
      await batchUpdate(book, { bids: [], asks: [] }, live);
      log(scope, `${book}: pulled ${live.length} quotes (window closing or settled)`);
    }
    delete state[book];
    saveState(state);
  }

  // Decide which books to requote.
  const plans: { m: Market; quotes: Quotes; live: RestingOrder[]; why: string }[] = [];
  for (const m of markets.filter((x) => x.quoting)) {
    const st = state[m.book];
    const { live, filled } = st ? await checkOrders(m.book, st.orders) : { live: [], filled: false };
    let why = "";
    if (!st || live.length === 0) why = "no quotes";
    else if (filled) why = "fill";
    else if (shouldRequote(BigInt(st.fair), m.fair, Number(values.threshold))) why = `fair moved ${usdStr(BigInt(st.fair))} -> ${usdStr(m.fair)}`;
    if (!why) continue;
    plans.push({ m, quotes: buildQuotes(m.fair, m.maxPayout, levels), live, why });
  }
  if (plans.length === 0) return;

  // Fund the margin account: rrUSD is shared by every book, LONG is per series. Orders being cancelled in the
  // same batch release their funds first, so only the difference has to be free.
  let usdNeeded = 0n;
  for (const p of plans) {
    const delta = bidNotional(p.quotes.bids) - lockedQuote(p.live);
    if (delta > 0n) usdNeeded += delta;
  }
  await topUp(usd, usdNeeded);
  for (const p of plans) {
    const delta = askSize(p.quotes.asks) - lockedBase(p.live);
    if (delta > 0n) await topUp(p.m.long, delta, p.m.series);
  }

  for (const p of plans) {
    const { placed, gasUsed } = await batchUpdate(p.m.book, p.quotes, p.live);
    state[p.m.book] = { fair: p.m.fair.toString(), quotedAt: Date.now(), orders: placed };
    saveState(state);
    log(scope, `${p.m.label}: fair ${usdStr(p.m.fair)} (${p.why}); ${ladderStr(p.quotes)} [test liquidity, gas ${gasUsed}]`);
  }
}

async function cancelAll(): Promise<void> {
  const state = loadState();
  for (const [book, st] of Object.entries(state) as [Address, BookState][]) {
    const { live } = await checkOrders(book, st.orders);
    if (live.length > 0) await batchUpdate(book, { bids: [], asks: [] }, live);
    log(scope, `${book}: cancelled ${live.length} quotes`);
    delete state[book];
    saveState(state);
  }
}

log(scope, `maker ${me}, Kuru margin ${margin} [test liquidity]`);
if (values["cancel-all"]) {
  await cancelAll();
} else if (values.once) {
  await tick(DEFAULT_LEVELS);
} else {
  for (;;) {
    try {
      await tick(DEFAULT_LEVELS);
    } catch (err) {
      log(scope, `tick failed, retrying next interval: ${errorMessage(err)}`);
    }
    await new Promise((r) => setTimeout(r, Number(values.interval) * 1000));
  }
}
