/** Real-price reference for the CRE workflow: each node fetches the public daily snapshot over CRE's HTTP capability
 * and the nodes agree on the median of their computed values (see bots/src/lib/reference.ts for the index itself). */
import { HTTPClient, type HTTPSendRequester, type Runtime, consensusMedianAggregation, json } from "@chainlink/cre-sdk";
import { type Offer, anchorDays, anchorLevel, referenceIndex, snapshotUrl, utcDate } from "../../bots/src/lib/reference.ts";

const http = new HTTPClient();

/** One node's view of a day's reference index (0 when the snapshot is missing or quotes too few providers). */
export function fetchDayIndex(sender: HTTPSendRequester, url: string): number {
  const res = sender.sendRequest({ url, method: "GET" }).result();
  if (res.statusCode !== 200) return 0;
  const body = json(res) as { offers?: Offer[] };
  return referenceIndex(body.offers ?? []) ?? 0;
}

/**
 * A day's reference index agreed across nodes (median), falling back to the previous day once if that day's
 * snapshot is missing. Results are memoized per run, so each snapshot is fetched once.
 */
export function dayIndex(runtime: Runtime<unknown>, date: string, memo: Map<string, number | null>): number | null {
  if (memo.has(date)) return memo.get(date) ?? null;
  let t = Date.parse(`${date}T00:00:00Z`) / 1000;
  let value: number | null = null;
  for (let i = 0; i < 2 && value === null; i++, t -= 86_400) {
    const v = http.sendRequest(runtime, fetchDayIndex, consensusMedianAggregation<number>())(snapshotUrl(utcDate(t))).result();
    if (v > 0) value = v;
  }
  memo.set(date, value);
  return value;
}

/** Reference level for an hour (USD per GPU-hour), or null if the reference is unavailable. */
export function referenceLevel(runtime: Runtime<unknown>, epochStart: number, memo: Map<string, number | null>): number | null {
  const { prev, last, frac } = anchorDays(epochStart);
  const a = dayIndex(runtime, prev, memo);
  const b = dayIndex(runtime, last, memo);
  if (a === null || b === null) return a ?? b;
  return anchorLevel(a, b, frac);
}
