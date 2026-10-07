/**
 * Rackrate market maker (test liquidity). Quotes a two-sided ladder of post-only limit orders on the Kuru book
 * of every live series, around the LONG token's fair value:
 *
 *   fair = (clamp(expected window average, floor, cap) - floor) x epochs
 *   expected average = (prices printed so far in the window
 *                       + reference price x epochs still to come) / epochs
 *
 * The reference for hours still to come is the real H100 price level (lib/reference.ts) for hours the oracle prices
 * from real providers' prices (hourly H100 from 2026-10-07 18:00 UTC), and the trailing one-week mean of prints otherwise.
 *
 * Each requote is one Kuru `batchUpdate` per book (cancel the old ladder, place the new one). A book is requoted
 * only when it has no quotes, fair value moved more than --threshold bps, or one of its orders
 * was filled, so an idle market costs no gas. Quoting stops one hour before a weekly window ends, or two epochs
 * before a demo series ends.
 *
 * The maker only places resting orders and never takes liquidity, so it can't trade with itself. Bids are funded
 * with rrUSD and asks with LONG minted from the series (the matching SHORT stays in the maker wallet), both held
 * in Kuru's margin account and topped up as needed.
 *
 * Usage:
 *   node src/mm.ts                    # loop (default every 60 seconds)
 *   node src/mm.ts --once             # one pass
 *   node src/mm.ts --cancel-all       # pull every quote this maker has resting
 *   node src/mm.ts --recover          # rebuild the order state from the chain (e.g. after losing the state file)
 *
 * Uses MM_PRIVATE_KEY. Resting order ids are kept in bots/.run/mm-state.json (git-ignored).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Address, type Hex, decodeEventLog, keccak256, maxUint256, toBytes } from "viem";
import { type Ctx, chainTime, ctxFromKeyEnv, errorMessage, send } from "./lib/chain.ts";
import { ROOT, loadAbi, loadDeployment, loadEnv, log } from "./lib/config.ts";
import { type Level, DEFAULT_LEVELS, type Quotes, buildQuotes, fairLong, shouldRequote } from "./lib/fairValue.ts";
import { erc20Abi, kuruMarginAccountAbi, kuruOrderBookAbi } from "./lib/kuru.ts";
import { ANCHOR_START, REFERENCE_FEEDS, anchorStartEpoch, referenceAt } from "./lib/reference.ts";
import { fetchLoader } from "./lib/referenceFetch.ts";
import { HOURS_PER_WEEK } from "./lib/weeks.ts";

loadEnv();

const { values } = parseArgs({
  options: {
    interval: { type: "string", default: "60" },
    threshold: { type: "string", default: "150" }, // bps move in fair value that triggers a requote
    once: { type: "boolean", default: false },
    "cancel-all": { type: "boolean", default: false },
    recover: { type: "boolean", default: false },
  },
});

const STOP_BEFORE_END = 3600n; // stop quoting one hour before a weekly window ends (two epochs for demo series)
const REFERENCE_EPOCHS = HOURS_PER_WEEK; // reference price = mean of the last week of hourly prints
const FUNDING_BUFFER_BPS = 12_000n; // top up 20% above what the new quotes need
// Tests point MM_STATE_FILE elsewhere so they never share state with the live maker.
const STATE_FILE = process.env.MM_STATE_FILE || resolve(ROOT, "bots", ".run", "mm-state.json");
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
  scanFrom?: number; // lowest order id that can still be one of ours (chain reconciliation starts here)
}
type State = Record<Address, BookState>; // keyed by book

function loadState(): State {
  const text = existsSync(STATE_FILE) ? readFileSync(STATE_FILE, "utf8").trim() : "";
  return text ? (JSON.parse(text) as State) : {};
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
  epochLength: number;
  genesis: bigint;
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

/** Feeds priced from real providers' prices, by feed id. */
const REAL_FEED_IDS = new Set([...REFERENCE_FEEDS].map((name) => keccak256(toBytes(name)).toLowerCase()));
const anchorStart = Number(process.env.ANCHOR_START ?? ANCHOR_START);
const loadReference = fetchLoader();
/** Last real level seen, reused if the data source is briefly unreachable so quotes don't flap. */
let lastRealLevel: number | null = null;

async function liveMarkets(now: bigint): Promise<Market[]> {
  const realLevel = (await referenceAt(Number(now), loadReference)) ?? lastRealLevel;
  lastRealLevel = realLevel;
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
    if (settled || now >= windowEnd) continue;
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
    // Hours the oracle will price from real prices are expected at today's real level; earlier ones at the mean.
    let spot = reference;
    if (!isDemo && REAL_FEED_IDS.has(feedId.toLowerCase()) && realLevel !== null && remaining > 0n) {
      const from = anchorStartEpoch(BigInt(f.genesis), BigInt(f.epochLength), anchorStart);
      const realHours = from > endEpoch ? 0n : endEpoch - (from > firstOpen ? from : firstOpen) + 1n;
      const realMicro = BigInt(Math.round(realLevel * 1e6));
      spot = (reference * (remaining - realHours) + realMicro * realHours) / remaining;
    }
    const fair = fairLong({ floor, cap, epochs, printedSum, printedCount, remaining, spot });
    out.push({
      series,
      book,
      long,
      label: symbol,
      fair,
      maxPayout: (cap - floor) * epochs,
      quoting: now < windowEnd - (isDemo ? 2n * BigInt(f.epochLength) : STOP_BEFORE_END),
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

  for (const m of markets.filter((x) => x.quoting)) await reconcile(state, m.book, m.label);

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
  // Each book is funded and requoted on its own, so one book that cannot be funded (e.g. a newly listed week
  // while the wallet is low) never stops the others from being quoted.
  for (const p of plans) {
    try {
      const delta = askSize(p.quotes.asks) - lockedBase(p.live);
      if (delta > 0n) await topUp(p.m.long, delta, p.m.series);
      const { placed, gasUsed } = await batchUpdate(p.m.book, p.quotes, p.live);
      state[p.m.book] = { fair: p.m.fair.toString(), quotedAt: Date.now(), orders: placed };
      saveState(state);
      log(scope, `${p.m.label}: fair ${usdStr(p.m.fair)} (${p.why}); ${ladderStr(p.quotes)} [test liquidity, gas ${gasUsed}]`);
    } catch (err) {
      log(scope, `${p.m.label}: skipped this tick: ${errorMessage(err)}`);
    }
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

const SCAN_CHUNK = 50;
const RECONCILE_MS = 10 * 60 * 1000;
const lastReconcile = new Map<Address, number>();

/**
 * This maker's resting orders on a book, read from the chain. Kuru numbers each book's orders from 1 and never
 * reuses ids; cancelled and filled orders read as empty slots, so the scan always covers every id up to `maxKnown`
 * and stops at the first fully empty batch beyond it.
 */
async function scanOwn(book: Address, from: number, maxKnown: number): Promise<RestingOrder[]> {
  const orders: RestingOrder[] = [];
  for (let start = Math.max(1, from); ; start += SCAN_CHUNK) {
    const ids = Array.from({ length: SCAN_CHUNK }, (_, i) => start + i);
    const res = await ctx.pub.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ address: book, abi: kuruOrderBookAbi, functionName: "s_orders", args: [id] }) as const),
    });
    let empty = 0;
    res.forEach((o, i) => {
      const [owner, size, , , , price, , isBuy] = o as readonly [Address, bigint, number, number, number, number, number, boolean];
      if (BigInt(owner) === 0n) empty++;
      else if (owner.toLowerCase() === me.toLowerCase() && size > 0n) orders.push({ id: ids[i], size: size.toString(), price, isBuy });
    });
    if (empty === SCAN_CHUNK && start > maxKnown) break;
  }
  return orders;
}

/**
 * Folds any of this maker's resting orders that the state file does not know about (e.g. placed by a process that
 * was stopped before it could save) into the book's state and forces a requote, which cancels them.
 */
async function reconcile(state: State, book: Address, label: string): Promise<void> {
  const st = state[book];
  if (!st || Date.now() - (lastReconcile.get(book) ?? 0) < RECONCILE_MS) return;
  const ids = st.orders.map((o) => o.id);
  const from = st.scanFrom ?? 1; // first reconcile of a book scans it fully
  const onChain = await scanOwn(book, from, ids.length ? Math.max(...ids) : 0);
  lastReconcile.set(book, Date.now());
  const known = new Set(ids);
  const extra = onChain.filter((o) => !known.has(o.id));
  if (extra.length > 0) {
    st.orders = [...st.orders, ...extra];
    st.fair = "0"; // requote: the batch update cancels every tracked order, including these
    log(scope, `${label}: found ${extra.length} untracked resting orders, replacing them`);
  }
  st.scanFrom = onChain.length ? Math.min(...onChain.map((o) => o.id)) : Math.max(from, ...ids, 0) + 1;
  saveState(state);
}

/** Rebuilds the state file from the chain (e.g. after losing it). The next tick cancels and requotes. */
async function recover(): Promise<void> {
  const state = loadState();
  const now = await chainTime(ctx.pub);
  for (const m of await liveMarkets(now)) {
    const known = state[m.book]?.orders.map((o) => o.id) ?? [];
    const orders = await scanOwn(m.book, 1, known.length ? Math.max(...known) : 0);
    state[m.book] = { fair: "0", quotedAt: 0, orders, scanFrom: orders.length ? Math.min(...orders.map((o) => o.id)) : undefined };
    log(scope, `${m.label}: recovered ${orders.length} resting orders`);
  }
  saveState(state);
}

log(scope, `maker ${me}, Kuru margin ${margin} [test liquidity]`);
if (values.recover) {
  await recover();
} else if (values["cancel-all"]) {
  await cancelAll();
} else if (values.once) {
  await tick(DEFAULT_LEVELS);
} else {
  // Stop only between ticks: a tick interrupted after an order transaction but before the state file is saved
  // would leave untracked orders on the book.
  // A maker starting without a state file (a new host, or a lost volume) first adopts the orders it already has
  // resting onchain, so it replaces them instead of quoting a second ladder beside them.
  if (Object.keys(loadState()).length === 0) await recover();
  let stopping = false;
  let wake: (() => void) | undefined;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      stopping = true;
      wake?.();
    });
  }
  while (!stopping) {
    try {
      await tick(DEFAULT_LEVELS);
    } catch (err) {
      log(scope, `tick failed, retrying next interval: ${errorMessage(err)}`);
    }
    if (stopping) break;
    await new Promise<void>((r) => {
      wake = r;
      setTimeout(r, Number(values.interval) * 1000);
    });
  }
  log(scope, "stopped cleanly");
}
