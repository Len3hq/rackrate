"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

/**
 * Reads from the Rackrate indexer (Envio HyperIndex, ../../indexer), a Hasura-style GraphQL API. Optional: without
 * NEXT_PUBLIC_INDEXER_URL the app runs on chain reads alone and history sections explain that they are off.
 */
export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || "";

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Indexer responded ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

export type ActivityKind = "HEDGE" | "BUY" | "SELL" | "MINT" | "REDEEM" | "CLAIM";

export interface ActivityRow {
  id: string;
  kind: ActivityKind;
  market: string;
  units: string; // BigInt fields arrive as strings
  amountIn: string;
  amountOut: string;
  timestamp: number;
  txHash: string;
}

export function useActivity(account: Address | undefined) {
  return useQuery({
    queryKey: ["indexer", "activity", account],
    enabled: !!INDEXER_URL && !!account,
    refetchInterval: 15_000,
    queryFn: async () =>
      (
        await gql<{ Activity: ActivityRow[] }>(
          `query History($account: String!) {
            Activity(where: { account: { _eq: $account } }, order_by: { timestamp: desc }, limit: 50) {
              id kind market units amountIn amountOut timestamp txHash
            }
          }`,
          { account: account!.toLowerCase() },
        )
      ).Activity,
  });
}

export interface TradeRow {
  id: string;
  takerBuys: boolean;
  price: string; // rrUSD per LONG, 18 decimals
  size: string; // LONG, 6 decimals
  timestamp: number;
  txHash: string;
}

export interface MarketStats {
  tradeCount: number;
  volumeLong: string;
  volumeQuote: string;
}

export function useMarketTrades(series: Address | undefined) {
  return useQuery({
    queryKey: ["indexer", "trades", series],
    enabled: !!INDEXER_URL && !!series,
    refetchInterval: 15_000,
    queryFn: () =>
      gql<{ Trade: TradeRow[]; Market_by_pk: MarketStats | null }>(
        `query Trades($market: String!) {
          Trade(where: { market: { _eq: $market } }, order_by: { timestamp: desc }, limit: 8) {
            id takerBuys price size timestamp txHash
          }
          Market_by_pk(id: $market) { tradeCount volumeLong volumeQuote }
        }`,
        { market: series!.toLowerCase() },
      ),
  });
}

export interface ProtocolStats {
  tradeCount: number;
  volumeQuote: string; // rrUSD, 6 decimals
  hedgeCount: number;
  hedgedUnits: string; // GPU-weeks, 6 decimals
  buyCount: number;
  traderCount: number;
}

/** Running protocol totals kept by the indexer (one row). */
export function useProtocolStats() {
  return useQuery({
    queryKey: ["indexer", "protocol"],
    enabled: !!INDEXER_URL,
    refetchInterval: 30_000,
    queryFn: async () =>
      (
        await gql<{ Protocol_by_pk: ProtocolStats | null }>(
          `query Protocol { Protocol_by_pk(id: "rackrate") { tradeCount volumeQuote hedgeCount hedgedUnits buyCount traderCount } }`,
          {},
        )
      ).Protocol_by_pk,
  });
}

export interface OraclePrintRow {
  epoch: string;
  status: number;
  price: string; // micro-dollars per GPU-hour
}

/** Finalized oracle hours from `fromEpoch` on, oldest first, in one query. */
export function useOraclePrints(feedId: string, fromEpoch: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ["indexer", "oracle", feedId, fromEpoch],
    enabled: !!INDEXER_URL && enabled && fromEpoch !== undefined,
    refetchInterval: 60_000,
    queryFn: async () =>
      (
        await gql<{ OraclePrint: OraclePrintRow[] }>(
          `query Prints($feed: String!, $from: numeric!) {
            OraclePrint(where: { feedId: { _eq: $feed }, epoch: { _gte: $from } }, order_by: { epoch: asc }, limit: 500) {
              epoch status price
            }
          }`,
          { feed: feedId.toLowerCase(), from: String(fromEpoch) },
        )
      ).OraclePrint,
  });
}
