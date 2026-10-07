/**
 * Real-world reference for the hourly H100 index: the median of GPU cloud providers' published on-demand H100 SXM
 * prices, from the open daily snapshots of gpurentalprices.com (CC BY 4.0). Rackrate takes each provider's median
 * on-demand price and then the median across providers; the hourly index follows that value (see priceModel.ts).
 *
 * Shared by the publisher bots, the market maker, the Chainlink CRE workflow and the web app, so every component
 * derives the same number from the same snapshot. Daily snapshots are append-only, so a given day's value never
 * changes. This module has no I/O: callers fetch snapshots their own way (fetch, or CRE's HTTP capability).
 */

export const REFERENCE_SOURCE = {
  name: "gpurentalprices.com",
  url: "https://gpurentalprices.com",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
};

/** Daily snapshot of every provider offer, by UTC date (YYYY-MM-DD). The repository keeps a rolling window of days. */
export const snapshotUrl = (date: string) =>
  `https://raw.githubusercontent.com/adriannutiu/gpu-rental-prices/main/data/snapshots/${date}.json`;

/** First hour priced from the reference: Monday 2026-10-12 00:00 UTC, the start of 2026-W42. */
export const ANCHOR_START = Date.UTC(2026, 9, 12) / 1000;
/** Epochs over which the hourly index moves from the last simulated print to the reference, so no hour jumps far. */
export const ANCHOR_RAMP_EPOCHS = 6;
/** Feeds priced from the reference (hourly feeds only; demo feeds stay simulated for their scenarios). */
export const REFERENCE_FEEDS = new Set(["H100"]);
/** Fewest providers a day must quote before its median counts. */
export const MIN_PROVIDERS = 5;

/** The fields of a snapshot offer that the index uses. */
export interface Offer {
  provider: string;
  gpu: string;
  kind: string;
  usd_hr: number;
}

const ON_DEMAND = new Set(["on-demand", "secure"]);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Each provider's median on-demand H100 SXM price, in USD per GPU-hour. */
export function providerPrices(offers: readonly Offer[]): Record<string, number> {
  const by: Record<string, number[]> = {};
  for (const o of offers) {
    if (o.gpu !== "h100-sxm" || !ON_DEMAND.has(o.kind) || !(o.usd_hr > 0)) continue;
    (by[o.provider] ??= []).push(o.usd_hr);
  }
  return Object.fromEntries(Object.entries(by).map(([p, v]) => [p, median(v)]));
}

/** The day's index: the median across providers, or null when too few providers quote. */
export function referenceIndex(offers: readonly Offer[]): number | null {
  const prices = Object.values(providerPrices(offers));
  return prices.length >= MIN_PROVIDERS ? median(prices) : null;
}

/** UTC date string for a unix time in seconds. */
export const utcDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * The two reference days an hour is priced from, newest first: the days two and one before the hour's UTC day, so
 * both snapshots exist (they are written each morning) before any hour of that day is published. `frac` is how far
 * through its UTC day the hour starts (0 to 23/24).
 */
export function anchorDays(epochStart: number): { prev: string; last: string; frac: number } {
  const day = Math.floor(epochStart / 86_400) * 86_400;
  return { prev: utcDate(day - 2 * 86_400), last: utcDate(day - 86_400), frac: (epochStart - day) / 86_400 };
}

/** Moves smoothly through the day from the earlier day's value to the later one (geometric interpolation). */
export function anchorLevel(prev: number, last: number, frac: number): number {
  return Math.exp(Math.log(prev) + (Math.log(last) - Math.log(prev)) * frac);
}

/** The first epoch priced from the reference, for a feed with the given genesis and epoch length. */
export function anchorStartEpoch(genesis: bigint, epochLength: bigint, startTime = ANCHOR_START): bigint {
  const start = BigInt(startTime);
  return start <= genesis ? 0n : (start - genesis + epochLength - 1n) / epochLength;
}

/**
 * Resolves the reference value for a day with a fallback: when a day's snapshot is missing or quotes too few
 * providers, the closest earlier day within a week is used. `load` returns a day's index or null.
 */
export async function resolveDay(date: string, load: (date: string) => Promise<number | null>): Promise<number | null> {
  let t = Date.parse(`${date}T00:00:00Z`) / 1000;
  for (let i = 0; i < 7; i++, t -= 86_400) {
    const v = await load(utcDate(t));
    if (v !== null) return v;
  }
  return null;
}

/** The reference level for an hour, or null if no snapshot within a week of its days is available. */
export async function referenceAt(epochStart: number, load: (date: string) => Promise<number | null>): Promise<number | null> {
  const { prev, last, frac } = anchorDays(epochStart);
  const [a, b] = await Promise.all([resolveDay(prev, load), resolveDay(last, load)]);
  if (a === null || b === null) return a ?? b;
  return anchorLevel(a, b, frac);
}
