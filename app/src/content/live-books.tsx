"use client";

import { liveWeekly, useMarkets } from "@/lib/data";
import { utcDay } from "@/lib/format";
import { Skeleton } from "@/components/ui";

const EXPLORER = "https://testnet.monadvision.com/address/";

/** Weekly series and their Kuru books, read live from SeriesFactory and MarketRegistry. */
export function LiveBooks() {
  const markets = useMarkets();
  const weeks = liveWeekly(markets.data, Math.floor(Date.now() / 1000));
  if (!markets.data) return <Skeleton className="mt-4 h-32 w-full" />;
  return (
    <table>
      <thead>
        <tr>
          <th>Week</th>
          <th>Series</th>
          <th>Kuru book</th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((m) => (
          <tr key={m.series}>
            <td>
              <strong>{m.week}</strong>
              <br />
              <span className="text-xs text-muted">{utcDay(m.start)} to {utcDay(m.end)}</span>
            </td>
            <td>
              <a href={`${EXPLORER}${m.series}`} target="_blank" rel="noreferrer"><code>{m.series.slice(0, 10)}…</code></a>
            </td>
            <td>
              <a href={`${EXPLORER}${m.book}`} target="_blank" rel="noreferrer"><code>{m.book?.slice(0, 10)}…</code></a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
