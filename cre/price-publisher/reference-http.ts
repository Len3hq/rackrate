/** Real-price reference for the CRE workflow (see bots/src/lib/reference.ts for the index itself). On the Workflow DON
 * each node fetches the public daily snapshot over CRE's HTTP capability and the nodes agree on the median of their
 * computed values; inside a Confidential Workflow's enclave the snapshot is fetched once, directly. */
import { HTTPClient, type HTTPSendRequester, type Runtime, type TeeRuntime, consensusMedianAggregation } from "@chainlink/cre-sdk";
import { gunzipSync, strFromU8 } from "fflate";
import { type Offer, anchorDays, anchorLevel, referenceIndex, snapshotUrl, utcDate } from "../../bots/src/lib/reference.ts";

const http = new HTTPClient();

/** A gzip stream starts with these two bytes. */
const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/**
 * The snapshot is requested gzip-compressed (about 25 KB instead of up to 320 KB), which keeps it well under CRE's
 * 250 KB HTTP response limit, and is decompressed here.
 */
const SNAPSHOT_REQUEST = (url: string) => ({ url, method: "GET", multiHeaders: { "Accept-Encoding": { values: ["gzip"] } } });

/** A day's index from a snapshot response (0 when the snapshot is missing or quotes too few providers). */
export function indexFromResponse(res: { statusCode: number; body: Uint8Array }): number {
  if (res.statusCode !== 200) return 0;
  const raw = isGzip(res.body) ? gunzipSync(res.body) : res.body;
  const body = JSON.parse(strFromU8(raw)) as { offers?: Offer[] };
  return referenceIndex(body.offers ?? []) ?? 0;
}

/** One node's view of a day's reference index (0 when unavailable). */
export function fetchDayIndex(sender: HTTPSendRequester, url: string): number {
  return indexFromResponse(sender.sendRequest(SNAPSHOT_REQUEST(url)).result());
}

/** Fetches one snapshot URL and returns its index (0 when unavailable). */
type FetchIndex = (url: string) => number;

/**
 * A day's reference index, falling back to the previous day once if that day's snapshot is missing. Results are
 * memoized per run, so each snapshot is fetched once.
 */
function dayIndexWith(fetchIndex: FetchIndex, date: string, memo: Map<string, number | null>): number | null {
  if (memo.has(date)) return memo.get(date) ?? null;
  let t = Date.parse(`${date}T00:00:00Z`) / 1000;
  let value: number | null = null;
  for (let i = 0; i < 2 && value === null; i++, t -= 86_400) {
    const v = fetchIndex(snapshotUrl(utcDate(t)));
    if (v > 0) value = v;
  }
  memo.set(date, value);
  return value;
}

/** Reference level for an hour (USD per GPU-hour), or null if the reference is unavailable. */
function referenceLevelWith(fetchIndex: FetchIndex, epochStart: number, memo: Map<string, number | null>): number | null {
  const { prev, last, frac } = anchorDays(epochStart);
  const a = dayIndexWith(fetchIndex, prev, memo);
  const b = dayIndexWith(fetchIndex, last, memo);
  if (a === null || b === null) return a ?? b;
  return anchorLevel(a, b, frac);
}

/** Workflow DON: each node fetches, and the nodes agree on the median of their values. */
const donFetch = (runtime: Runtime<unknown>): FetchIndex => (url) =>
  http.sendRequest(runtime, fetchDayIndex, consensusMedianAggregation<number>())(url).result();

/** Enclave: one direct fetch (a TEE runs a single instance, so there is nothing to agree on). */
const teeFetch = (runtime: TeeRuntime<unknown>): FetchIndex => (url) =>
  indexFromResponse(http.sendRequest(runtime, SNAPSHOT_REQUEST(url)).result());

/** A day's reference index on the Workflow DON (median consensus across nodes). */
export function dayIndex(runtime: Runtime<unknown>, date: string, memo: Map<string, number | null>): number | null {
  return dayIndexWith(donFetch(runtime), date, memo);
}

/** Reference level for an hour on the Workflow DON. */
export function referenceLevel(runtime: Runtime<unknown>, epochStart: number, memo: Map<string, number | null>): number | null {
  return referenceLevelWith(donFetch(runtime), epochStart, memo);
}

/** Reference level for an hour, fetched inside a Confidential Workflow's enclave. */
export function teeReferenceLevel(runtime: TeeRuntime<unknown>, epochStart: number, memo: Map<string, number | null>): number | null {
  return referenceLevelWith(teeFetch(runtime), epochStart, memo);
}
