/**
 * Real H100 rental prices for the last 7 days: per day, the median of providers' published on-demand H100 SXM
 * prices (the same index the oracle follows since 2026-10-07), with the middle half of providers as a range, plus
 * each provider's price on the latest day.
 * Built from the open daily snapshots of gpurentalprices.com (CC BY 4.0) and cached for an hour.
 */
import { MIN_PROVIDERS, type Offer, REFERENCE_SOURCE, providerPrices, snapshotUrl, utcDate } from "@/lib/reference";
import type { ReferenceDay } from "@/lib/reference-data";

export const revalidate = 3600;

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}

type Day = ReferenceDay & { byProvider: Record<string, number> };

async function day(date: string): Promise<Day | null> {
  try {
    const res = await fetch(snapshotUrl(date), { next: { revalidate: 3600 }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { offers?: Offer[] };
    const byProvider = providerPrices(body.offers ?? []);
    const prices = Object.values(byProvider).sort((a, b) => a - b);
    if (prices.length < MIN_PROVIDERS) return null;
    return { date, index: quantile(prices, 0.5), low: quantile(prices, 0.25), high: quantile(prices, 0.75), providers: prices.length, byProvider };
  } catch {
    return null;
  }
}

export async function GET() {
  const today = Math.floor(Date.now() / 86_400_000) * 86_400;
  // Today's snapshot appears each morning UTC, so look back far enough to always find seven days.
  const found = await Promise.all(Array.from({ length: 10 }, (_, i) => day(utcDate(today - i * 86_400))));
  const days = found.filter((d): d is Day => d !== null).slice(0, 7).reverse();
  const latest = days.at(-1);
  const providers = latest
    ? Object.entries(latest.byProvider)
        .map(([provider, price]) => ({ provider, price }))
        .sort((a, b) => a.price - b.price)
    : [];
  return Response.json({ source: REFERENCE_SOURCE, days: days.map(({ byProvider: _, ...d }) => d), providers });
}
