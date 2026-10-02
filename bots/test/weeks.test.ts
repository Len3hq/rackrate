import assert from "node:assert/strict";
import { test } from "node:test";
import { isoWeek, upcomingMondays } from "../src/lib/weeks.ts";

const ts = (iso: string) => BigInt(Date.parse(iso) / 1000);

test("upcoming Mondays are 00:00 UTC Mondays strictly after now", () => {
  const mondays = upcomingMondays(ts("2026-10-02T13:00:00Z"), 4); // a Friday
  assert.deepEqual(
    mondays.map((m) => new Date(Number(m) * 1000).toISOString()),
    ["2026-10-05T00:00:00.000Z", "2026-10-12T00:00:00.000Z", "2026-10-19T00:00:00.000Z", "2026-10-26T00:00:00.000Z"],
  );
  // Exactly at Monday 00:00, the current week has started; the next listed week is the following one.
  assert.equal(new Date(Number(upcomingMondays(ts("2026-10-05T00:00:00Z"), 1)[0]) * 1000).toISOString(), "2026-10-12T00:00:00.000Z");
});

test("ISO week numbers match the ISO-8601 calendar", () => {
  // Reference values from Python's datetime.isocalendar().
  const cases: [string, number, number][] = [
    ["2026-10-05", 2026, 41],
    ["2026-10-12", 2026, 42],
    ["2026-12-28", 2026, 53],
    ["2027-01-04", 2027, 1],
    ["2025-12-29", 2026, 1],
  ];
  for (const [d, year, week] of cases) assert.deepEqual(isoWeek(ts(`${d}T00:00:00Z`)), { year, week }, d);
});
