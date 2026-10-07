import assert from "node:assert/strict";
import { test } from "node:test";
import { type Hex, keccak256, toBytes } from "viem";
import { GPUS } from "../src/lib/gpus.ts";
import { type Anchor, anchoredPrice, indexPrice, levelAt, paramsFor, periodSeed, publisherPrice } from "../src/lib/priceModel.ts";
import {
  ANCHOR_RAMP_EPOCHS,
  ANCHOR_START,
  type Offer,
  anchorDays,
  anchorLevel,
  anchorStartEpoch,
  providerPrices,
  referenceAt,
  referenceIndex,
  resolveDay,
} from "../src/lib/reference.ts";

const offer = (provider: string, usd_hr: number, kind = "on-demand", gpu = "h100-sxm"): Offer => ({ provider, gpu, kind, usd_hr });

test("index: each provider's median on-demand H100 SXM price, then the median across providers", () => {
  const offers = [
    offer("lambda", 3.99),
    offer("lambda", 4.29),
    offer("runpod", 3.49, "secure"),
    offer("runpod", 2.69, "community"), // spot-like, ignored
    offer("aws", 6.88),
    offer("hyperstack", 3.2),
    offer("hyperstack", 2.72, "reserved"), // ignored
    offer("tensordock", 2.25),
    offer("azure", 2.04, "spot"), // ignored
    offer("datacrunch", 3.774),
    offer("lambda", 1.2, "on-demand", "a100-80gb"), // other GPU, ignored
  ];
  assert.deepEqual(providerPrices(offers), { lambda: (3.99 + 4.29) / 2, runpod: 3.49, aws: 6.88, hyperstack: 3.2, tensordock: 2.25, datacrunch: 3.774 });
  assert.equal(referenceIndex(offers), (3.49 + 3.774) / 2);
});

test("index needs at least five providers", () => {
  assert.equal(referenceIndex([offer("a", 3), offer("b", 3), offer("c", 3), offer("d", 3)]), null);
  assert.equal(referenceIndex([offer("a", 3), offer("b", 3), offer("c", 3), offer("d", 3), offer("e", 4)]), 3);
});

test("an hour is priced from the two days before its UTC day, moving through the day", () => {
  const t = Date.UTC(2026, 9, 12, 18) / 1000;
  assert.deepEqual(anchorDays(t), { prev: "2026-10-10", last: "2026-10-11", frac: 0.75 });
  assert.ok(Math.abs(anchorLevel(3, 3.3, 0) - 3) < 1e-12);
  assert.ok(Math.abs(anchorLevel(3, 3.3, 1) - 3.3) < 1e-12);
});

test("real-price mode starts at the first epoch on or after the switch time", () => {
  const genesis = BigInt(ANCHOR_START - 100 * 3600);
  assert.equal(anchorStartEpoch(genesis, 3600n), 100n);
  assert.equal(anchorStartEpoch(genesis + 1n, 3600n), 100n); // rounds up to the first full hour after the start
  assert.equal(anchorStartEpoch(BigInt(ANCHOR_START + 10), 3600n), 0n);
});

test("a missing day falls back to the closest earlier day", async () => {
  const days: Record<string, number> = { "2026-10-08": 3.4 };
  assert.equal(await resolveDay("2026-10-10", async (d) => days[d] ?? null), 3.4);
  assert.equal(await resolveDay("2026-10-20", async (d) => days[d] ?? null), null); // more than a week back
  const t = Date.UTC(2026, 9, 12, 6) / 1000;
  assert.equal(await referenceAt(t, async (d) => ({ "2026-10-10": 3, "2026-10-11": 3.3 })[d] ?? null), anchorLevel(3, 3.3, 0.25));
});

// ---------------------------------------------------------------- the anchored model
const MASTER = keccak256(toBytes("test master")) as Hex;
const FEED = keccak256(toBytes("H100"));
const seedFor = (q: bigint) => periodSeed(MASTER, FEED, q);
const P = paramsFor("H100", false);
// A feed whose epochs start on UTC hours (genesis at midnight), switching to real prices at a midnight epoch.
const GENESIS = Date.UTC(2026, 8, 1) / 1000;
const FROM = 1008n;
const anchor = (e: bigint, level: number): Anchor => ({ from: FROM, level, epochStart: GENESIS + Number(e) * 3600 });

test("real-price hours stay within about 3.5% of the real level", () => {
  let maxDev = 0;
  for (let e = FROM + 10n; e < FROM + 24n * 120n; e++) {
    const dev = Math.abs(anchoredPrice(seedFor, P, e, anchor(e, 3.49)) / 3.49 - 1);
    maxDev = Math.max(maxDev, dev);
  }
  assert.ok(maxDev < 0.035, `max deviation ${maxDev}`);
  assert.ok(maxDev > 0.01, `texture too flat: ${maxDev}`);
});

test("real-price hours peak in US working hours (daily cycle)", () => {
  let at18 = 0;
  let at06 = 0;
  for (let d = 10n; d < 110n; d++) {
    at18 += anchoredPrice(seedFor, P, FROM + d * 24n + 18n, anchor(FROM + d * 24n + 18n, 3.49));
    at06 += anchoredPrice(seedFor, P, FROM + d * 24n + 6n, anchor(FROM + d * 24n + 6n, 3.49));
  }
  assert.ok(at18 > at06 * 1.015, `${at18 / 100} vs ${at06 / 100}`);
});

test("the switch ramps from the last simulated print without tripping the 25% jump limit", () => {
  // Worst case: the simulated model ends far from the real level. Every hourly step must stay well under 25%.
  for (const level of [2.0, 3.49, 5.2]) {
    let prev = levelAt(seedFor, P, FROM - 1n, anchor(FROM - 1n, level));
    assert.equal(prev, indexPrice(seedFor, P, FROM - 1n)); // before the switch: the simulated model, untouched
    for (let e = FROM; e < FROM + 24n; e++) {
      const v = levelAt(seedFor, P, e, anchor(e, level));
      assert.ok(Math.abs(v / prev - 1) < 0.2, `level ${level}, epoch ${e}: ${prev} -> ${v}`);
      prev = v;
    }
    const settled = levelAt(seedFor, P, FROM + BigInt(ANCHOR_RAMP_EPOCHS), anchor(FROM + BigInt(ANCHOR_RAMP_EPOCHS), level));
    assert.equal(settled, anchoredPrice(seedFor, P, FROM + BigInt(ANCHOR_RAMP_EPOCHS), anchor(FROM + BigInt(ANCHOR_RAMP_EPOCHS), level)));
  }
});

test("real-price publishers agree within 0.3% and stay inside the H100 oracle bounds", () => {
  const spec = GPUS.H100;
  for (let e = FROM + 6n; e < FROM + 500n; e++) {
    const a = anchor(e, 3.49);
    const b = Number(publisherPrice(seedFor, P, e, "0xb", 0, a));
    const c = Number(publisherPrice(seedFor, P, e, "0xc", 0, a));
    assert.ok(Math.abs(b / c - 1) < 0.0061, `epoch ${e}: ${b} vs ${c}`);
    assert.ok(BigInt(b) > spec.oracleMin && BigInt(b) < spec.oracleMax);
  }
});

test("an anchor never changes prices before the switch", () => {
  for (const e of [0n, 500n, FROM - 1n]) {
    assert.equal(publisherPrice(seedFor, P, e, "0xb", 0, anchor(e, 3.49)), publisherPrice(seedFor, P, e, "0xb"));
  }
});

test("the web app's copy of the reference module is in sync (pnpm -C app sync-reference)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/lib/reference.ts", import.meta.url), "utf8");
  const copy = readFileSync(new URL("../../app/src/lib/reference.ts", import.meta.url), "utf8");
  assert.equal(copy.slice(copy.indexOf("\n\n") + 2), src);
});
