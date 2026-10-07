// Unit tests for the CRE real-price reference, with the SDK's test runtime and HTTP mock. Run: bun test
import { expect } from "bun:test";
import { HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test";
import { gzipSync } from "fflate";
import { anchorLevel, referenceIndex, snapshotUrl } from "../../bots/src/lib/reference.ts";
import { dayIndex, referenceLevel } from "./reference-http.ts";

/** A day's snapshot: offers from seven providers, plus noise the index must ignore. */
const snapshot = (scale: number) => ({
  date: "x",
  offers: [
    ...[["a", 2.5], ["b", 3.0], ["c", 3.2], ["d", 3.49], ["e", 3.6], ["f", 4.0], ["g", 11.0]].map(([p, v]) => ({
      provider: p,
      gpu: "h100-sxm",
      kind: "on-demand",
      usd_hr: (v as number) * scale,
    })),
    { provider: "a", gpu: "h100-sxm", kind: "spot", usd_hr: 0.5 },
    { provider: "b", gpu: "a100-80gb", kind: "on-demand", usd_hr: 1.2 },
  ],
});

const body = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
/** The same body gzip-compressed, as GitHub serves it when asked for gzip. */
const gzBody = (o: unknown) => Buffer.from(gzipSync(Buffer.from(JSON.stringify(o)))).toString("base64");

test("a day's index is the provider median, agreed over the HTTP capability", () => {
  const http = HttpActionsMock.testInstance();
  const seen: string[] = [];
  http.sendRequest = (req) => {
    seen.push(req.url);
    return { statusCode: 200, body: body(snapshot(1)) };
  };
  const rt = newTestRuntime();
  const v = dayIndex(rt, "2026-10-10", new Map());
  expect(v).toBeCloseTo(referenceIndex(snapshot(1).offers) as number, 9);
  expect(v).toBeCloseTo(3.49, 9);
  expect(seen).toEqual([snapshotUrl("2026-10-10")]);
});

test("a missing day falls back to the day before", () => {
  const http = HttpActionsMock.testInstance();
  http.sendRequest = (req) =>
    req.url.endsWith("2026-10-10.json") ? { statusCode: 404, body: body({}) } : { statusCode: 200, body: body(snapshot(1)) };
  const v = dayIndex(newTestRuntime(), "2026-10-10", new Map());
  expect(v).toBeCloseTo(3.49, 9);
});

test("an hour's level moves through the day between the two previous days", () => {
  const http = HttpActionsMock.testInstance();
  // 2026-10-12 06:00 UTC is priced from 2026-10-10 (x1.0) and 2026-10-11 (x1.1).
  http.sendRequest = (req) => ({ statusCode: 200, body: body(snapshot(req.url.endsWith("2026-10-11.json") ? 1.1 : 1)) });
  const t = Date.UTC(2026, 9, 12, 6) / 1000;
  const v = referenceLevel(newTestRuntime(), t, new Map());
  expect(v).toBeCloseTo(anchorLevel(3.49, 3.49 * 1.1, 0.25), 9);
});

test("no snapshot at all returns null", () => {
  const http = HttpActionsMock.testInstance();
  http.sendRequest = () => ({ statusCode: 404, body: body({}) });
  expect(referenceLevel(newTestRuntime(), Date.UTC(2026, 9, 12) / 1000, new Map())).toBeNull();
});

test("snapshots are requested gzip-compressed and decompressed in the workflow", () => {
  const http = HttpActionsMock.testInstance();
  let asked: string[] = [];
  http.sendRequest = (req) => {
    asked = req.multiHeaders["Accept-Encoding"]?.values ?? [];
    return { statusCode: 200, body: gzBody(snapshot(1)) };
  };
  expect(dayIndex(newTestRuntime(), "2026-10-10", new Map())).toBeCloseTo(3.49, 9);
  expect(asked).toEqual(["gzip"]);
});
