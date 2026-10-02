import assert from "node:assert/strict";
import { test } from "node:test";
import { type Hex, keccak256, toBytes } from "viem";
import { GPUS } from "../src/lib/gpus.ts";
import {
  GPU_BASE,
  indexPrice,
  paramsFor,
  periodSeed,
  publisherPrice,
  seedCommitment,
  seedLookahead,
} from "../src/lib/priceModel.ts";

const MASTER = keccak256(toBytes("test master")) as Hex;
const OTHER_MASTER = keccak256(toBytes("other master")) as Hex;
const PUB_B = "0x000000000000000000000000000000000000000b";
const PUB_C = "0x000000000000000000000000000000000000000c";

const resolver = (master: Hex, feed: Hex) => (q: bigint) => periodSeed(master, feed, q);

for (const gpu of Object.keys(GPU_BASE)) {
  const feed = keccak256(toBytes(gpu));
  const seedFor = resolver(MASTER, feed);
  const hourly = paramsFor(gpu, false);
  const spec = GPUS[gpu];

  test(`${gpu}: two years of hourly prices stay inside oracle bounds and under the 25% jump limit`, () => {
    let prev = 0;
    let insideSeriesRange = 0;
    const n = 24 * 365 * 2;
    for (let e = 0n; e < BigInt(n); e++) {
      const micro = publisherPrice(seedFor, hourly, e, PUB_B);
      assert.ok(micro >= spec.oracleMin && micro <= spec.oracleMax, `epoch ${e}: ${micro} out of bounds`);
      if (micro >= spec.floor && micro <= spec.cap) insideSeriesRange++;
      const p = Number(micro);
      if (prev > 0) assert.ok(Math.abs(p - prev) / prev < 0.25, `epoch ${e}: jump ${prev} -> ${p}`);
      prev = p;
    }
    assert.ok(insideSeriesRange / n > 0.97, `only ${((100 * insideSeriesRange) / n).toFixed(1)}% inside series range`);
  });

  test(`${gpu}: demo epochs stay under the 50% demo jump limit`, () => {
    const demo = paramsFor(`${gpu}_DEMO_1`, true);
    let prev = 0;
    for (let e = 0n; e < 20_000n; e++) {
      const p = Number(publisherPrice(seedFor, demo, e, PUB_B));
      if (prev > 0) assert.ok(Math.abs(p - prev) / prev < 0.5, `demo epoch ${e}: ${prev} -> ${p}`);
      prev = p;
    }
  });
}

test("deterministic: same seeds give identical prices", () => {
  const feed = keccak256(toBytes("H100"));
  const p = paramsFor("H100", false);
  for (const e of [0n, 1n, 167n, 168n, 10_000n]) {
    assert.equal(
      publisherPrice(resolver(MASTER, feed), p, e, PUB_B),
      publisherPrice(resolver(MASTER, feed), p, e, PUB_B),
    );
  }
});

test("a different master secret gives different prices", () => {
  const feed = keccak256(toBytes("H100"));
  const p = paramsFor("H100", false);
  assert.notEqual(
    publisherPrice(resolver(MASTER, feed), p, 500n, PUB_B),
    publisherPrice(resolver(OTHER_MASTER, feed), p, 500n, PUB_B),
  );
});

test("publishers deviate from the shared index by at most 0.8%", () => {
  const feed = keccak256(toBytes("H100"));
  const seedFor = resolver(MASTER, feed);
  const p = paramsFor("H100", false);
  for (let e = 0n; e < 2000n; e++) {
    const index = indexPrice(seedFor, p, e);
    for (const pub of [PUB_B, PUB_C]) {
      const dev = Math.abs(Number(publisherPrice(seedFor, p, e, pub)) / 1e6 / index - 1);
      assert.ok(dev <= 0.0081, `epoch ${e}: deviation ${dev}`);
    }
  }
});

test("scenarios scale the price (spike 1.45x, crash 0.6x)", () => {
  const feed = keccak256(toBytes("H100_DEMO_1"));
  const seedFor = resolver(MASTER, feed);
  const p = paramsFor("H100_DEMO_1", true);
  const base = Number(publisherPrice(seedFor, p, 42n, PUB_B, 0));
  assert.ok(Math.abs(Number(publisherPrice(seedFor, p, 42n, PUB_B, 1)) / base - 1.45) < 1e-6);
  assert.ok(Math.abs(Number(publisherPrice(seedFor, p, 42n, PUB_B, 2)) / base - 0.6) < 1e-6);
});

test("index is continuous across seed-period boundaries", () => {
  const feed = keccak256(toBytes("H100"));
  const seedFor = resolver(MASTER, feed);
  const p = paramsFor("H100", false);
  for (const boundary of [168n, 336n, 504n]) {
    const a = indexPrice(seedFor, p, boundary - 1n);
    const b = indexPrice(seedFor, p, boundary);
    // Allow for a scheduled regime shock (<= ~20%) landing on the boundary; otherwise moves are small.
    assert.ok(Math.abs(b - a) / a < 0.22, `boundary ${boundary}: ${a} -> ${b}`);
  }
});

test("a price in period P only uses seeds of periods P..P+lookahead (all committed before use)", () => {
  for (const [name, isDemo] of [
    ["H100", false],
    ["H100_DEMO_1", true],
  ] as const) {
    const feed = keccak256(toBytes(name));
    const p = paramsFor(name, isDemo);
    const ahead = BigInt(seedLookahead(p));
    for (let e = 0n; e < BigInt(p.periodEpochs) * 6n; e++) {
      const P = e / BigInt(p.periodEpochs);
      const guarded = (q: bigint) => {
        // Shock blocks may reference the period their block started in, which is never in the future.
        assert.ok(q <= P + ahead, `${name} epoch ${e} (period ${P}) used seed of period ${q}`);
        return periodSeed(MASTER, feed, q);
      };
      publisherPrice(guarded, p, e, PUB_B);
    }
  }
});

test("seed commitment matches the contract's keccak256(abi.encodePacked(seed))", () => {
  const seed = periodSeed(MASTER, keccak256(toBytes("H100")), 3n);
  assert.equal(seedCommitment(seed), keccak256(seed));
});
