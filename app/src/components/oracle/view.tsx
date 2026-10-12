"use client";

import { CheckCircle, Circle } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { EPOCH_STATUS, FEEDS, PUBLISHERS, useOracle } from "@/lib/data";
import { INDEXER_URL, type PublisherStatsRow, useOraclePrints, usePublisherStats, useRecentSubmissions } from "@/lib/indexer";
import { deployment } from "@/lib/generated";
import { shortAddr, usd, utcHour } from "@/lib/format";
import { explorer } from "@/lib/wagmi";
import { PriceChart } from "../price-chart";
import { Pill, Skeleton } from "../ui";

const RANGES = [
  { label: "24h", hours: 24 },
  { label: "3d", hours: 72 },
  { label: "7d", hours: 168 },
];

export function OracleView() {
  const [hours, setHours] = useState(72);
  // Stats, feed rules and the last 24 hours with per-publisher ticks always come from the chain.
  const oracle = useOracle(24);
  const d = oracle.data;
  // The chart's longer history comes from the indexer in one query; without it (or if it fails), from the chain.
  const firstEpoch = d ? Math.max(0, d.nextEpoch - hours) : undefined;
  const prints = useOraclePrints(FEEDS.H100, firstEpoch);
  const useChain = !INDEXER_URL || prints.isError;
  const chainHistory = useOracle(hours, useChain && hours !== 24);

  const points = useMemo(() => {
    if (!d) return undefined;
    if (useChain) return hours === 24 ? d.points : chainHistory.data?.points;
    if (!prints.data) return undefined;
    const byEpoch = new Map(prints.data.map((p) => [Number(p.epoch), p]));
    const out = [];
    for (let e = d.nextEpoch - hours; e < d.nextEpoch; e++) {
      if (e < 0) continue;
      const p = byEpoch.get(e);
      // An hour finalized onchain but not yet indexed shows as a gap until the indexer catches up.
      out.push({ time: d.genesis + e * d.epochLength, status: p?.status ?? 0, price: p && p.status === 1 ? Number(p.price) / 1e6 : null });
    }
    return out;
  }, [d, useChain, hours, chainHistory.data, prints.data]);

  const recent = d ? [...d.points].reverse().slice(0, 24) : [];
  const printed = points ? points.filter((p) => p.status === 1).length : 0;

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-6 md:py-14">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">H100 index oracle</h1>
      <p className="mt-2 max-w-[70ch] text-ink-2">
        One price per hour, finalized onchain from independent publishers. Since Oct 7, 2026 (18:00 UTC) it follows the median of GPU clouds&apos; published H100 prices, with small modelled intraday moves; earlier hours were simulated. Anyone can re-derive every print once its seeds are revealed.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Last print" value={d ? `${usd(d.lastPrice, 4)}/hr` : null} />
        <Stat label="24h average" value={d ? (d.avg24h ? `${usd(d.avg24h, 4)}/hr` : "-") : null} />
        <Stat label="7d average" value={d ? (d.avg7d ? `${usd(d.avg7d, 4)}/hr` : "-") : null} />
        <Stat label={`Printed, last ${hours}h`} value={points ? `${printed} of ${points.length}` : null} />
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-card md:p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Hourly index, $/GPU-hour</h2>
          <div className="flex rounded-full bg-surface-2 p-1 text-sm" role="tablist">
            {RANGES.map((r) => (
              <button key={r.hours} role="tab" aria-selected={hours === r.hours} onClick={() => setHours(r.hours)} className={`relative rounded-full px-3 py-1 ${hours === r.hours ? "text-ink" : "text-muted hover:text-ink"}`}>
                {hours === r.hours && <motion.span layoutId="range" className="absolute inset-0 -z-0 rounded-full bg-surface shadow-sm" />}
                <span className="relative">{r.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">{points ? <PriceChart key={hours} points={points} height={300} /> : <Skeleton className="h-[300px] w-full" />}</div>
        {oracle.isError && <p className="text-sm text-muted">Could not reach Monad testnet. Retrying automatically.</p>}
      </section>

      <Scorecard nextEpoch={d?.nextEpoch} />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] gap-4 border-b border-line px-5 py-3 text-xs text-muted">
            <span>Hour (UTC)</span>
            <span>Status</span>
            <span className="text-right">Price</span>
            <span className="flex gap-3">{PUBLISHERS.map((p) => <span key={p.address} className="w-5 text-center" title={p.name}>{p.name === "Chainlink CRE" ? "A" : p.name.slice(-1)}</span>)}</span>
          </div>
          {!d && <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>}
          {recent.map((p) => (
            <div key={p.epoch} className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-center gap-4 border-b border-line px-5 py-2.5 text-sm last:border-b-0">
              <span className="text-ink-2">{utcHour(p.time).replace(" UTC", "")}</span>
              <span><Pill tone={p.status === 1 ? "mint" : p.status === 0 ? "neutral" : "rose"}>{EPOCH_STATUS[p.status]}</Pill></span>
              <span className="text-right font-mono tnum">{p.price !== null ? usd(p.price, 4) : "-"}</span>
              <span className="flex gap-3">
                {p.submitted.map((s, j) => (
                  <span key={j} className="grid w-5 place-items-center">{s ? <CheckCircle size={16} weight="fill" className="text-mint" /> : <Circle size={16} className="text-muted" />}</span>
                ))}
              </span>
            </div>
          ))}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface p-5 text-sm shadow-card">
            <h2 className="font-medium">Feed rules</h2>
            {d ? (
              <dl className="mt-3 space-y-2">
                <Rule k="Median of at least" v={`${d.minPublishers} submissions`} />
                <Rule k="Accepted range" v={`${usd(d.minPrice)} to ${usd(d.maxPrice)}`} />
                <Rule k="Jump limit per hour" v={`${d.maxJumpBps / 100}%`} />
                <Rule k="Missing hours" v="Recorded as gaps" />
              </dl>
            ) : (
              <Skeleton className="mt-3 h-24 w-full" />
            )}
            <a href={`${explorer}/address/${deployment.RackOracle}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-accent hover:underline">RackOracle contract →</a>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Short publisher letter, as in the hourly table's columns. */
const letter = (name: string) => (name === "Chainlink CRE" ? "A" : name.slice(-1));
const pct = (v: number, digits = 1) => `${v.toFixed(digits)}%`;

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129_600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/**
 * Each publisher's track record, derived by the indexer (Envio): as every hour finalizes, each allowlisted publisher
 * is scored on whether it submitted and how far its price was from the final median.
 */
/** Window for the recent uptime figure, in hourly epochs. */
const RECENT_HOURS = 168;

function Scorecard({ nextEpoch }: { nextEpoch?: number }) {
  const stats = usePublisherStats(FEEDS.H100);
  const byAddress = new Map((stats.data ?? []).map((r) => [r.publisher, r]));
  const off = !INDEXER_URL || stats.isError;

  // Last 7 days: hours the indexer has seen finalize, and which of them each publisher priced.
  const recent = useRecentSubmissions(FEEDS.H100, nextEpoch === undefined ? undefined : Math.max(0, nextEpoch - RECENT_HOURS));
  const recentFor = (address: string): Recent | undefined => {
    if (!recent.data) return undefined;
    const finalized = new Set(recent.data.OraclePrint.map((p) => p.epoch));
    const a = address.toLowerCase();
    const priced = recent.data.Submission.filter((x) => x.publisher === a && finalized.has(x.epoch)).length;
    // A publisher allowlisted part-way through the window is only counted for the hours it could have priced.
    const eligible = Math.min(finalized.size, byAddress.get(a)?.hoursEligible ?? finalized.size);
    return { priced, eligible };
  };

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-5">
        <h2 className="font-medium">Publisher scorecard</h2>
        <p className="text-xs text-muted">
          {off ? "Track records need the indexer, which is unavailable right now." : "Every finalized hour, scored against the final price. Indexed by Envio."}
        </p>
      </div>
      <div className="mt-4 hidden grid-cols-[1.6fr_1fr_1fr_1fr_1fr_1fr] gap-4 border-y border-line px-5 py-3 text-xs text-muted md:grid">
        <span>Publisher</span>
        <span className="text-right">Hours priced, 7d</span>
        <span className="text-right" title="Average distance of its price from the hour's final median">Avg. from final</span>
        <span className="text-right">Worst</span>
        <span className="text-right" title="Seeds are committed before their period and revealed after it, so every price can be re-derived">Seeds committed / revealed</span>
        <span className="text-right">Last price</span>
      </div>
      <ul className="mt-3 md:mt-0">
        {PUBLISHERS.map((p) => (
          <ScoreRow
            key={p.address}
            name={p.name}
            kind={p.kind}
            address={p.address}
            row={byAddress.get(p.address.toLowerCase())}
            recent={recentFor(p.address)}
            loading={!off && (stats.isPending || recent.isPending)}
          />
        ))}
      </ul>
    </section>
  );
}

interface Recent {
  priced: number;
  eligible: number;
}

function ScoreRow(props: { name: string; kind: string; address: string; row?: PublisherStatsRow; recent?: Recent; loading: boolean }) {
  const { name, kind, address, row, recent, loading } = props;
  const uptime = row && row.hoursEligible > 0 ? (row.hoursSubmitted / row.hoursEligible) * 100 : null;
  const recentUptime = recent && recent.eligible > 0 ? (recent.priced / recent.eligible) * 100 : null;
  const avg = row && row.hoursScored > 0 ? Number(row.deviationPpmSum) / row.hoursScored / 1e4 : null;
  const cells: { label: string; value: string | null; note?: string }[] = [
    {
      label: "Hours priced, 7d",
      value: recentUptime === null ? null : pct(recentUptime),
      note: uptime === null ? undefined : `all time ${pct(uptime)} (${row!.hoursSubmitted} of ${row!.hoursEligible})`,
    },
    { label: "Avg. from final", value: avg === null ? null : pct(avg, 2) },
    { label: "Worst", value: row && row.hoursScored > 0 ? pct(row.maxDeviationPpm / 1e4, 2) : null },
    { label: "Seeds committed / revealed", value: row ? `${row.seedsCommitted} / ${row.seedsRevealed}` : null },
    { label: "Last price", value: row?.lastSubmittedAt ? ago(row.lastSubmittedAt) : null },
  ];
  return (
    <li className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line px-5 py-4 text-sm last:border-b-0 md:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_1fr] md:items-center md:py-3">
      <span className="col-span-2 md:col-span-1">
        <span className="font-medium">{letter(name)} </span>
        {name}
        <span className="block text-xs text-muted">
          {kind} ·{" "}
          <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">{shortAddr(address)}</a>
        </span>
      </span>
      {cells.map((c) => (
        <span key={c.label} className="md:text-right">
          <span className="block text-xs text-muted md:hidden">{c.label}</span>
          {loading ? (
            <Skeleton className="h-5 w-16 md:ml-auto" />
          ) : (
            <>
              <span className="font-mono tnum">{c.value ?? "-"}</span>
              {c.note && <span className="block text-xs text-muted">{c.note}</span>}
            </>
          )}
        </span>
      ))}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="text-xs text-muted">{label}</p>
      {value === null ? <Skeleton className="mt-2 h-6 w-24" /> : <p className="mt-1 font-mono text-lg tnum">{value}</p>}
    </div>
  );
}

function Rule({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
