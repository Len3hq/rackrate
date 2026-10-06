"use client";

import { useQuery } from "@tanstack/react-query";
import { type Address, type ContractFunctionParameters, type Hex, type PublicClient, erc20Abi, keccak256, toBytes, zeroAddress } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { deployment, marketRegistryAbi, rRUSDAbi, rackOracleAbi, seriesAbi, seriesFactoryAbi } from "./generated";
import { bookPrice, kuruBookAbi } from "./kuru";

export const FEEDS = { H100: keccak256(toBytes("H100")) } as const;

/**
 * Calldata per Multicall3 request. viem's default (1 KB) splits a week of oracle reads into dozens of RPC calls,
 * which trips the public RPC's rate limit; 64 KB keeps every page load to a handful of requests.
 */
const MULTICALL_BYTES = 65_536;

/** The publishers on the hourly H100 feed (all team-operated on testnet). */
export const PUBLISHERS: { name: string; kind: string; address: Address }[] = [
  { name: "Chainlink CRE", kind: "CRE workflow", address: deployment.CreReceiver as Address },
  { name: "Publisher B", kind: "Bot", address: "0x5F6fd1CB79a710162610d90185CfEC37D1B9D3b2" },
  { name: "Publisher C", kind: "Bot", address: "0xC29da9FeE200628a45bfe31028D7752f3bbCB774" },
];

export const MARKET_MAKER: Address = "0xfbF0102a17Ed91E55AA28bdbF7b69a41c9546232";

export interface Market {
  series: Address;
  book: Address | null;
  long: Address;
  short: Address;
  symbol: string; // LONG symbol, e.g. rrH100W42L
  week: string; // "2026-W42"
  gpu: string;
  isDemo: boolean;
  feedId: Hex;
  startEpoch: bigint;
  endEpoch: bigint;
  epochs: number;
  floor: number; // $/GPU-hour
  cap: number;
  start: number; // unix seconds
  end: number;
  settled: boolean;
  settlementPrice: number | null; // $/GPU-hour
  longPayout: number; // $ per whole LONG once settled
  shortPayout: number;
  collateralPerUnit: number; // $ to mint one LONG+SHORT pair
  bid: number | null; // $ per LONG
  ask: number | null;
}

/** Implied $/GPU-hour of a LONG price: floor + price / epochs. */
export const impliedRate = (m: Pick<Market, "floor" | "epochs">, longPrice: number | null) =>
  longPrice === null ? null : m.floor + longPrice / m.epochs;

function weekLabel(start: number): string {
  // ISO week of a Monday 00:00 UTC timestamp.
  const d = new Date(start * 1000);
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3));
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

type Feed = { genesis: bigint; epochLength: number; nextEpoch: bigint; firstEpoch: bigint; lastPrice: bigint };

async function loadMarkets(client: PublicClient): Promise<Market[]> {
  const factory = deployment.SeriesFactory as Address;
  const count = await client.readContract({ address: factory, abi: seriesFactoryAbi, functionName: "seriesCount" });
  if (count === 0n) return [];
  const addrs = (await client.multicall({
    batchSize: MULTICALL_BYTES,
    allowFailure: false,
    contracts: Array.from({ length: Number(count) }, (_, i) => ({
      address: factory,
      abi: seriesFactoryAbi,
      functionName: "allSeries",
      args: [BigInt(i)],
    })),
  })) as Address[];

  const fields = ["long", "short", "isDemo", "feedId", "startEpoch", "endEpoch", "floor", "cap", "settled", "settlementPrice", "longPayoutPerUnit", "shortPayoutPerUnit", "collateralPerUnit"] as const;
  const perSeries = fields.length + 1;
  const raw = await client.multicall({
    batchSize: MULTICALL_BYTES,
    allowFailure: false,
    contracts: addrs.flatMap((s) => [
      ...fields.map((f) => ({ address: s, abi: seriesAbi, functionName: f })),
      { address: deployment.MarketRegistry as Address, abi: marketRegistryAbi, functionName: "bookOf", args: [s] },
    ]),
  });

  const rows = addrs.map((s, i) => {
    const r = raw.slice(i * perSeries, (i + 1) * perSeries) as unknown[];
    return {
      series: s,
      long: r[0] as Address,
      short: r[1] as Address,
      isDemo: r[2] as boolean,
      feedId: r[3] as Hex,
      startEpoch: r[4] as bigint,
      endEpoch: r[5] as bigint,
      floor: Number(r[6]) / 1e6,
      cap: Number(r[7]) / 1e6,
      settled: r[8] as boolean,
      settlementPrice: (r[8] as boolean) ? Number(r[9]) / 1e6 : null,
      longPayout: Number(r[10]) / 1e6,
      shortPayout: Number(r[11]) / 1e6,
      collateralPerUnit: Number(r[12]) / 1e6,
      book: (r[13] as Address) === zeroAddress ? null : (r[13] as Address),
    };
  });

  const feedIds = [...new Set(rows.map((r) => r.feedId))];
  const books = rows.filter((r) => r.book) as (typeof rows[number] & { book: Address })[];
  const extra = await client.multicall({
    batchSize: MULTICALL_BYTES,
    allowFailure: true,
    contracts: [
      ...feedIds.map((f) => ({ address: deployment.RackOracle as Address, abi: rackOracleAbi, functionName: "getFeed", args: [f] })),
      ...rows.map((r) => ({ address: r.long, abi: erc20Abi, functionName: "symbol" })),
      ...books.map((r) => ({ address: r.book, abi: kuruBookAbi, functionName: "bestBidAsk" })),
    ],
  });
  const feeds = new Map(feedIds.map((f, i) => [f, extra[i].result as unknown as Feed]));
  const symbols = rows.map((_, i) => (extra[feedIds.length + i].result as string | undefined) ?? "");
  const quotes = new Map(
    books.map((r, i) => {
      const q = extra[feedIds.length + rows.length + i].result as readonly [bigint, bigint] | undefined;
      return [r.series, q ? { bid: bookPrice(q[0]), ask: bookPrice(q[1]) } : { bid: null, ask: null }];
    }),
  );

  return rows.map((r, i) => {
    const f = feeds.get(r.feedId);
    const len = f ? BigInt(f.epochLength) : 3600n;
    const genesis = f ? f.genesis : 0n;
    const start = Number(genesis + r.startEpoch * len);
    const end = Number(genesis + (r.endEpoch + 1n) * len);
    const q = quotes.get(r.series) ?? { bid: null, ask: null };
    return {
      ...r,
      symbol: symbols[i],
      gpu: symbols[i].replace(/^rr/, "").match(/^[A-Z]\d+/)?.[0] ?? "H100",
      week: r.isDemo ? "Demo" : weekLabel(start),
      epochs: Number(r.endEpoch - r.startEpoch + 1n),
      start,
      end,
      bid: q.bid,
      ask: q.ask,
    };
  });
}

export function useMarkets() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["markets"],
    queryFn: () => loadMarkets(client as PublicClient),
    enabled: !!client,
    refetchInterval: 20_000,
  });
}

/** Weekly (non-demo) markets that are still trading, soonest first. */
export function liveWeekly(markets: Market[] | undefined, now: number): Market[] {
  return (markets ?? []).filter((m) => !m.isDemo && !m.settled && m.end > now && m.book).sort((a, b) => a.start - b.start);
}

/** The most recent demo series that is still trading (demo.sh creates one per session), if any. */
export function liveDemo(markets: Market[] | undefined, now: number): Market | undefined {
  return (markets ?? []).filter((m) => m.isDemo && !m.settled && m.end > now && m.book).sort((a, b) => b.start - a.start)[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------------------------------------------

export const EPOCH_STATUS = ["Open", "Printed", "Missing", "Out of bounds", "Jump rejected"] as const;

export interface EpochPoint {
  epoch: number;
  time: number; // epoch start, unix seconds
  status: number;
  submissions: number;
  price: number | null; // $/GPU-hour, printed epochs only
  submitted: boolean[]; // per PUBLISHERS entry
}

export interface OracleState {
  genesis: number;
  epochLength: number;
  nextEpoch: number; // first epoch not yet finalized
  lastPrice: number;
  minPublishers: number;
  publisherCount: number;
  maxJumpBps: number;
  minPrice: number;
  maxPrice: number;
  points: EpochPoint[]; // oldest first
  avg24h: number | null;
  avg7d: number | null;
}

async function loadOracle(client: PublicClient, hours: number): Promise<OracleState> {
  const oracle = deployment.RackOracle as Address;
  const feedId = FEEDS.H100;
  const f = await client.readContract({ address: oracle, abi: rackOracleAbi, functionName: "getFeed", args: [feedId] });
  const last = f.nextEpoch - 1n;
  const from = last - BigInt(hours) + 1n > f.firstEpoch ? last - BigInt(hours) + 1n : f.firstEpoch;
  const epochs: bigint[] = [];
  for (let e = from; e <= last; e++) epochs.push(e);

  const res = await client.multicall({
    batchSize: MULTICALL_BYTES,
    allowFailure: true,
    contracts: [
      ...epochs.map((e) => ({ address: oracle, abi: rackOracleAbi, functionName: "getEpoch", args: [feedId, e] })),
      ...epochs.flatMap((e) =>
        PUBLISHERS.map((p) => ({ address: oracle, abi: rackOracleAbi, functionName: "hasSubmitted", args: [feedId, e, p.address] })),
      ),
      ...[24n, 168n].map((n) => ({
        address: oracle,
        abi: rackOracleAbi,
        functionName: "windowStats",
        args: [feedId, last - n + 1n > f.firstEpoch ? last - n + 1n : f.firstEpoch, last],
      })),
    ],
  });

  const points: EpochPoint[] = epochs.map((e, i) => {
    const r = res[i].result as readonly [number, number, bigint] | undefined;
    const status = r ? Number(r[0]) : 0;
    return {
      epoch: Number(e),
      time: Number(f.genesis + e * BigInt(f.epochLength)),
      status,
      submissions: r ? Number(r[1]) : 0,
      price: status === 1 && r ? Number(r[2]) / 1e6 : null,
      submitted: PUBLISHERS.map((_, j) => (res[epochs.length + i * PUBLISHERS.length + j].result as unknown) === true),
    };
  });
  const avg = (k: number) => {
    const r = res[epochs.length * (PUBLISHERS.length + 1) + k].result as readonly [bigint, bigint, bigint] | undefined;
    return r && r[1] > 0n ? Number(r[0] / r[1]) / 1e6 : null;
  };

  return {
    genesis: Number(f.genesis),
    epochLength: f.epochLength,
    nextEpoch: Number(f.nextEpoch),
    lastPrice: Number(f.lastPrice) / 1e6,
    minPublishers: f.minPublishers,
    publisherCount: f.publisherCount,
    maxJumpBps: f.maxJumpBps,
    minPrice: Number(f.minPrice) / 1e6,
    maxPrice: Number(f.maxPrice) / 1e6,
    points,
    avg24h: avg(0),
    avg7d: avg(1),
  };
}

export function useOracle(hours = 72) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["oracle", hours],
    queryFn: () => loadOracle(client as PublicClient, hours),
    enabled: !!client,
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------------------------------------------

const DUST = 100n;

export interface Holdings {
  usd: bigint;
  faucetReadyAt: number; // unix seconds; 0 = ready now
  positions: Map<Address, { long: bigint; short: bigint }>; // keyed by series
}

async function loadHoldings(client: PublicClient, account: Address, markets: Market[]): Promise<Holdings> {
  const usdAddr = deployment.rrUSD as Address;
  const res = await client.multicall({
    batchSize: MULTICALL_BYTES,
    allowFailure: false,
    contracts: [
      { address: usdAddr, abi: erc20Abi, functionName: "balanceOf", args: [account] },
      { address: usdAddr, abi: rRUSDAbi, functionName: "lastClaim", args: [account] },
      ...markets.flatMap((m) => [
        { address: m.long, abi: erc20Abi, functionName: "balanceOf", args: [account] },
        { address: m.short, abi: erc20Abi, functionName: "balanceOf", args: [account] },
      ]),
    ] as ContractFunctionParameters[],
  });
  const last = Number(res[1] as bigint);
  const positions = new Map<Address, { long: bigint; short: bigint }>();
  markets.forEach((m, i) => {
    const long = res[2 + i * 2] as bigint;
    const short = res[3 + i * 2] as bigint;
    // Leftovers under 0.0001 (e.g. from closing a position) are not shown.
    if (long >= DUST || short >= DUST) positions.set(m.series, { long, short });
  });
  return { usd: res[0] as bigint, faucetReadyAt: last === 0 ? 0 : last + 86_400, positions };
}

export function useHoldings(markets: Market[] | undefined) {
  const client = usePublicClient();
  const { address } = useAccount();
  return useQuery({
    queryKey: ["holdings", address, markets?.map((m) => m.series).join()],
    queryFn: () => loadHoldings(client as PublicClient, address as Address, markets ?? []),
    enabled: !!client && !!address && !!markets,
    refetchInterval: 15_000,
  });
}
