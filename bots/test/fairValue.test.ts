import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuotes, expectedAverage, fairLong, shouldRequote } from "../src/lib/fairValue.ts";

const week = { floor: 1_000_000n, cap: 5_000_000n, epochs: 168n };

test("future week: fair LONG = (spot - floor) x 168", () => {
  const w = { ...week, printedSum: 0n, printedCount: 0n, remaining: 168n, spot: 3_750_000n };
  assert.equal(expectedAverage(w), 3_750_000n);
  assert.equal(fairLong(w), 2_750_000n * 168n); // $462 per GPU-week
});

test("half-elapsed week blends realized prints with spot", () => {
  // 84 hours printed at $3.00, 84 remaining at spot $4.00 => expected average $3.50
  const w = { ...week, printedSum: 3_000_000n * 84n, printedCount: 84n, remaining: 84n, spot: 4_000_000n };
  assert.equal(expectedAverage(w), 3_500_000n);
  assert.equal(fairLong(w), 2_500_000n * 168n);
});

test("fair value is clamped to the payout range", () => {
  const high = { ...week, printedSum: 0n, printedCount: 0n, remaining: 168n, spot: 9_000_000n };
  const low = { ...high, spot: 500_000n };
  assert.equal(fairLong(high), 4_000_000n * 168n); // max payout $672
  assert.equal(fairLong(low), 0n);
});

test("quotes straddle fair value on $0.01 ticks and never exceed max payout", () => {
  const fair = 462_000_000n; // $462.00 per GPU-week
  const q = buildQuotes(fair, 672_000_000n);
  assert.deepEqual(q.bids.map((b) => b.price), [4_550_700, 4_435_200]); // $455.07, $443.52
  assert.deepEqual(q.asks.map((a) => a.price), [4_689_300, 4_804_800]); // $468.93, $480.48
  for (const p of [...q.bids, ...q.asks]) assert.equal(p.price % 100, 0, "on tick");
  const nearCap = buildQuotes(670_000_000n, 672_000_000n);
  assert.ok(nearCap.asks.every((a) => a.price <= 6_720_000), "asks capped at $672");
  assert.equal(buildQuotes(0n, 672_000_000n).bids.length, 0, "no zero bids");
});

test("requote only on meaningful moves", () => {
  assert.equal(shouldRequote(462_000_000n, 466_000_000n, 150), false); // +0.87%
  assert.equal(shouldRequote(462_000_000n, 470_000_000n, 150), true); // +1.73%
  assert.equal(shouldRequote(0n, 1n, 150), true);
});
