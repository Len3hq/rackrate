/**
 * Fair value of a series' LONG token and the market maker's quote ladder (pure functions, unit-tested).
 *
 * Units: prices are micro-dollars (6 dp). One LONG token (1e6 raw units) covers 1 GPU for every epoch of the
 * window. Kuru prices use price precision 1e4 with a $0.01 tick (100 Kuru units), and sizes equal raw units.
 */

export interface WindowState {
  floor: bigint; // micro-dollars per GPU-hour
  cap: bigint;
  epochs: bigint; // epochs in the window
  printedSum: bigint; // sum of printed prices so far in the window
  printedCount: bigint; // number of printed epochs so far
  remaining: bigint; // epochs not yet finalized
  spot: bigint; // reference index price for the epochs still to come (the bot uses the trailing one-week mean)
}

/** Expected settlement average: realized prints blended with the reference price for the remaining epochs. */
export function expectedAverage(w: WindowState): bigint {
  const n = w.printedCount + w.remaining;
  if (n === 0n) return w.spot;
  return (w.printedSum + w.remaining * w.spot) / n;
}

/** Expected LONG payout per whole token, in micro-dollars: (clamp(avg) - floor) x epochs. */
export function fairLong(w: WindowState): bigint {
  let avg = expectedAverage(w);
  if (avg < w.floor) avg = w.floor;
  if (avg > w.cap) avg = w.cap;
  return (avg - w.floor) * w.epochs;
}

export interface Level {
  spreadBps: number; // distance from fair value on each side
  size: bigint; // LONG raw units per side
}

export const DEFAULT_LEVELS: Level[] = [
  { spreadBps: 150, size: 5_000_000n },
  { spreadBps: 400, size: 10_000_000n },
];

const KURU_PRICE_PER_MICRO = 100n; // micro-dollar price -> Kuru price units (1e4 precision): divide by 100
const TICK = 100n; // $0.01 in Kuru price units

export interface Quotes {
  bids: { price: number; size: bigint }[]; // Kuru price units, descending
  asks: { price: number; size: bigint }[]; // ascending
}

/**
 * Two-sided ladder around fair value. Bids round down and asks round up to the tick, so quotes never cross fair
 * value; bids at or below zero are dropped and asks never exceed the maximum payout.
 */
export function buildQuotes(fairMicro: bigint, maxPayoutMicro: bigint, levels: Level[] = DEFAULT_LEVELS): Quotes {
  const fairKuru = fairMicro / KURU_PRICE_PER_MICRO;
  const maxKuru = (maxPayoutMicro / KURU_PRICE_PER_MICRO / TICK) * TICK;
  const bids: Quotes["bids"] = [];
  const asks: Quotes["asks"] = [];
  for (const l of levels) {
    const bid = ((fairKuru * BigInt(10_000 - l.spreadBps)) / 10_000n / TICK) * TICK;
    const askRaw = (fairKuru * BigInt(10_000 + l.spreadBps)) / 10_000n;
    let ask = ((askRaw + TICK - 1n) / TICK) * TICK;
    if (ask > maxKuru) ask = maxKuru;
    if (bid >= TICK) bids.push({ price: Number(bid), size: l.size });
    if (ask > bid && ask >= TICK) asks.push({ price: Number(ask), size: l.size });
  }
  return { bids, asks };
}

/** Whether a resting quote should be refreshed. */
export function shouldRequote(prevFair: bigint, fair: bigint, thresholdBps: number): boolean {
  if (prevFair === 0n) return fair !== 0n;
  const diff = fair > prevFair ? fair - prevFair : prevFair - fair;
  return diff * 10_000n > prevFair * BigInt(thresholdBps);
}
