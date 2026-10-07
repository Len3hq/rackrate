/** Fetch-based snapshot loading for the reference index (Node bots and the web app; CRE uses its HTTP capability). */
import { type Offer, referenceIndex, snapshotUrl } from "./reference.ts";

/** A cached loader over fetch, for Node (bots) and the web app. Failed or missing days are retried next call. */
export function fetchLoader(fetchFn: typeof fetch = fetch): (date: string) => Promise<number | null> {
  const cache = new Map<string, number>();
  return async (date) => {
    const hit = cache.get(date);
    if (hit !== undefined) return hit;
    try {
      const res = await fetchFn(snapshotUrl(date), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { offers?: Offer[] };
      const v = referenceIndex(body.offers ?? []);
      if (v !== null) cache.set(date, v);
      return v;
    } catch {
      return null;
    }
  };
}
