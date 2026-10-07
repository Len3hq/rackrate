/**
 * Deterministic GPU rental index model (testnet).
 *
 * Two modes. Simulated: a fully modelled index around a fixed base, used by demo feeds and by hourly feeds before
 * 2026-W42. Real-price: from 2026-W42 the hourly H100 feed's level follows real providers' published prices
 * (reference.ts) and the model only adds small intraday texture (see `anchoredPrice`).
 *
 * Design goals:
 *  - Stateless: the price for any epoch is a pure function of (secret seeds, feed, epoch), so publishers,
 *    the Chainlink CRE workflow and auditors all compute identical values without shared state.
 *  - Unpredictable until revealed: randomness comes from per-period seeds derived from a secret master.
 *    Each period's seed is committed onchain before use and revealed afterwards, so anyone can recompute
 *    every print once the seeds are public.
 *  - Market-like: a daily cycle, smooth multi-day noise and occasional regime shocks, kept well inside
 *    the oracle bounds and under the oracle's jump limit.
 */
import { type Hex, encodePacked, keccak256 } from "viem";
import { ANCHOR_RAMP_EPOCHS } from "./reference.ts";

export interface ModelParams {
  /** Starting level in USD per GPU-hour. */
  base: number;
  /** Model hours represented by one oracle epoch (1 for hourly feeds; >1 compresses time on demo feeds). */
  hoursPerEpoch: number;
  /** Epochs per seed period (one commit–reveal per period). */
  periodEpochs: number;
}

/** Starting levels calibrated to publicly reported 2026 on-demand medians (approximate). */
export const GPU_BASE: Record<string, number> = { H100: 3.0, H200: 3.8, B200: 5.6 };

export const SCENARIO = { reset: 0, spike: 1, crash: 2 } as const;
const SCENARIO_MULT: Record<number, number> = { 0: 1, 1: 1.45, 2: 0.6 };

/** A scenario logged during epoch E applies to epochs after E; the latest one wins. */
export function scenarioKindAt(scenarios: readonly { epoch: bigint; kind: number }[], epoch: bigint): number {
  let kind = 0;
  for (const s of scenarios) if (s.epoch < epoch) kind = s.kind;
  return kind;
}

export function gpuOf(feedName: string): string {
  return feedName.split("_")[0];
}

export function paramsFor(feedName: string, isDemo: boolean): ModelParams {
  const base = GPU_BASE[gpuOf(feedName)];
  if (base === undefined) throw new Error(`No base price for feed ${feedName}`);
  return isDemo ? { base, hoursPerEpoch: 2, periodEpochs: 20 } : { base, hoursPerEpoch: 1, periodEpochs: 168 };
}

/** Longest noise scale in model hours. A price at time t uses noise knots up to t + this far ahead. */
const MAX_SCALE_HOURS = 168;

/**
 * How many periods ahead a price can depend on. A price in period P uses seeds of periods P..P+lookahead,
 * so publishers commit that many periods ahead (commit before use) and prints in period P become fully
 * re-derivable once periods up to P+lookahead are revealed.
 */
export function seedLookahead(p: ModelParams): number {
  return Math.ceil(MAX_SCALE_HOURS / (p.periodEpochs * p.hoursPerEpoch)) + 1;
}

export function periodOf(epoch: bigint, periodEpochs: number): bigint {
  return epoch / BigInt(periodEpochs);
}

/** Per-period seed derived from the secret master. Only these derived seeds are ever revealed. */
export function periodSeed(master: Hex, feedId: Hex, period: bigint): Hex {
  return keccak256(encodePacked(["bytes32", "bytes32", "uint64"], [master, feedId, period]));
}

/** Matches RackOracle: keccak256(abi.encodePacked(seed)). */
export function seedCommitment(seed: Hex): Hex {
  return keccak256(encodePacked(["bytes32"], [seed]));
}

export type SeedResolver = (period: bigint) => Hex;

function u01(seed: Hex, tag: string, i: bigint): number {
  const h = BigInt(keccak256(encodePacked(["bytes32", "string", "int256"], [seed, tag, i])));
  return Number(h >> 192n) / 2 ** 64;
}

/** Smooth value noise in [-1, 1]; each knot uses the seed of the period its time falls in. */
function valueNoise(seedFor: SeedResolver, p: ModelParams, tHours: number, scale: number, tag: string): number {
  const k = Math.floor(tHours / scale);
  const f = tHours / scale - k;
  const s = f * f * (3 - 2 * f);
  const knot = (i: number) => {
    const epoch = BigInt(Math.floor((i * scale) / p.hoursPerEpoch));
    return 2 * u01(seedFor(periodOf(epoch, p.periodEpochs)), tag, BigInt(i)) - 1;
  };
  const a = knot(k);
  const b = knot(k + 1);
  return a + (b - a) * s;
}

/** Shared index level (USD per GPU-hour) at an epoch. */
export function indexPrice(seedFor: SeedResolver, p: ModelParams, epoch: bigint): number {
  const t = Number(epoch) * p.hoursPerEpoch;
  const block = Math.floor(t / 72);
  const blockEpoch = BigInt(Math.floor((block * 72) / p.hoursPerEpoch));
  // Regime shocks only on even 72-hour blocks, so a shock always returns to zero before the next one:
  // every transition is 0 -> shock or shock -> 0, keeping single-epoch moves under the 25% jump limit.
  const u = u01(seedFor(periodOf(blockEpoch, p.periodEpochs)), "shock", BigInt(block));
  const shock = block % 2 !== 0 ? 0 : u < 0.12 ? -0.18 : u > 0.88 ? 0.16 : 0;

  const logPrice =
    Math.log(p.base) +
    0.05 * Math.sin((2 * Math.PI * t) / 24) +
    0.1 * valueNoise(seedFor, p, t, 24, "daily") +
    0.12 * valueNoise(seedFor, p, t, MAX_SCALE_HOURS, "weekly") +
    shock;
  return Math.exp(logPrice);
}

/**
 * Real-price mode (hourly feeds from 2026-W42): the hour's level comes from real providers' prices (reference.ts),
 * and the model only adds intraday texture, sized like real listed prices move: a demand cycle peaking around
 * 18:00 UTC (US working hours) and slow noise, about +/-2-3% in all. The seeds still drive the noise, so prints stay
 * unpredictable until revealed and re-derivable afterwards.
 */
export interface Anchor {
  /** First epoch priced from the reference. */
  from: bigint;
  /** Reference level for this epoch, USD per GPU-hour (reference.ts `referenceAt`). */
  level: number;
  /** Unix time (seconds) at which this epoch starts. */
  epochStart: number;
}

/** Anchored index level (USD per GPU-hour) at an epoch, before the ramp from the simulated model. */
export function anchoredPrice(seedFor: SeedResolver, p: ModelParams, epoch: bigint, a: Anchor): number {
  const t = Number(epoch) * p.hoursPerEpoch;
  const hourUtc = (a.epochStart % 86_400) / 3_600;
  const logPrice =
    Math.log(a.level) +
    0.012 * Math.sin((2 * Math.PI * (hourUtc - 12)) / 24) +
    0.012 * valueNoise(seedFor, p, t, 6, "intraday") +
    0.01 * valueNoise(seedFor, p, t, 48, "drift");
  return Math.exp(logPrice);
}

/**
 * Index level at an epoch in either mode. Over the first ANCHOR_RAMP_EPOCHS of real-price mode the level moves
 * geometrically from the last simulated print to the anchored level, so no single hour trips the oracle's jump limit.
 */
export function levelAt(seedFor: SeedResolver, p: ModelParams, epoch: bigint, anchor?: Anchor): number {
  if (!anchor || epoch < anchor.from) return indexPrice(seedFor, p, epoch);
  const target = anchoredPrice(seedFor, p, epoch, anchor);
  const step = Number(epoch - anchor.from) + 1;
  if (anchor.from === 0n || step >= ANCHOR_RAMP_EPOCHS) return target;
  const last = indexPrice(seedFor, p, anchor.from - 1n);
  const w = step / ANCHOR_RAMP_EPOCHS;
  return Math.exp(Math.log(last) * (1 - w) + Math.log(target) * w);
}

/**
 * One publisher's submitted price in micro-dollars (6 decimals): the shared index plus a small
 * publisher-specific deviation, times any active demo scenario multiplier. With an anchor (real-price mode) the
 * deviation is smaller, matching how closely real price sources agree.
 */
export function publisherPrice(
  seedFor: SeedResolver,
  p: ModelParams,
  epoch: bigint,
  publisher: string,
  scenarioKind = 0,
  anchor?: Anchor,
): bigint {
  const seed = seedFor(periodOf(epoch, p.periodEpochs));
  const real = anchor !== undefined && epoch >= anchor.from;
  const deviation = (real ? 0.003 : 0.008) * (2 * u01(seed, `pub:${publisher.toLowerCase()}`, epoch) - 1);
  const mult = SCENARIO_MULT[scenarioKind] ?? 1;
  const price = levelAt(seedFor, p, epoch, anchor) * (1 + deviation) * mult;
  return BigInt(Math.round(price * 1e6));
}
