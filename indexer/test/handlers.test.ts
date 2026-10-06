// Handler tests with simulated events (no network). Run: pnpm -C indexer test
import { describe, it } from "vitest";
import { createTestIndexer } from "envio";

type Hex = `0x${string}`;
/** One simulated event, typed from the generated config so contract, event and params are all checked. */
type Sim = NonNullable<NonNullable<Parameters<ReturnType<typeof createTestIndexer>["process"]>[0]["chains"][10143]>["simulate"]>[number];

const ROUTER: Hex = "0xe5eb6018cedc90204a7b27ff5df083dfa781226c";
const SERIES: Hex = "0x0b3d2221bdcb8a35abe510d70c522e1671d616c9";
const BOOK: Hex = "0x0bbb8ac8189eefb3ab41045c550fb19640fa7b27";
const LONG: Hex = "0x4e44d1f4d02c8861a93d32c8fbd4ed6078c91f74";
const SHORT: Hex = "0x1111111111111111111111111111111111111111";
const MAKER: Hex = "0xfbf0102a17ed91e55aa28bdbf7b69a41c9546232";
const ALICE: Hex = "0xa11ce00000000000000000000000000000000001";
const FEED: Hex = "0x8f1d0e7b54c7c4d6e7fb3e5f8a3c2b1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b";
const B0 = 67_700_000;
const T0 = 1_791_000_000;

const block = (n: number) => ({ number: B0 + n, timestamp: T0 + n });
const tx = (n: number) => ({ hash: `0x${n.toString(16).padStart(64, "0")}` as Hex });

/** A series and its book, created the way the factory and registry emit them. */
const listing: Sim[] = [
  {
    contract: "SeriesFactory",
    event: "SeriesCreated",
    block: block(0),
    transaction: tx(1),
    params: { series: SERIES, feedId: FEED, startEpoch: 210n, endEpoch: 377n, floor: 1_000_000n, cap: 5_000_000n, isDemo: false, long: LONG, short: SHORT },
  },
  {
    contract: "MarketRegistry",
    event: "MarketCreated",
    block: block(1),
    transaction: tx(2),
    params: { series: SERIES, book: BOOK, long: LONG, feedId: FEED },
  },
];

/** A Kuru fill: price is rrUSD per LONG with 18 decimals, sizes have 6 decimals. */
const fill = (n: number, taker: Hex, isBuy: boolean, price: bigint, size: bigint, logIndex = 0): Sim => ({
  contract: "KuruBook",
  event: "Trade",
  srcAddress: BOOK as Hex,
  logIndex,
  block: block(n),
  transaction: tx(n),
  params: { orderId: 25n, makerAddress: MAKER, isBuy, price, updatedSize: 0n, takerAddress: taker, txOrigin: ALICE, filledSize: size },
});

describe("Rackrate indexer", () => {
  it("discovers a series and its Kuru book, then indexes fills with market statistics", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { 10143: { simulate: [...listing, fill(5, ROUTER, false, 440_330_000_000_000_000_000n, 1_500_000n)] } } });

    t.expect(indexer.chains[10143].Series.addresses.map((a: string) => a.toLowerCase())).toContain(SERIES);
    t.expect(indexer.chains[10143].KuruBook.addresses.map((a: string) => a.toLowerCase())).toContain(BOOK);

    const market = await indexer.Market.getOrThrow(SERIES);
    t.expect(market.book).toBe(BOOK);
    t.expect(market.tradeCount).toBe(1);
    t.expect(market.volumeLong).toBe(1_500_000n);
    t.expect(market.volumeQuote).toBe(660_495_000n); // 1.5 x $440.33
    t.expect(market.lastPrice).toBe(440_330_000_000_000_000_000n);

    const trades = await indexer.Trade.getAll();
    t.expect(trades).toHaveLength(1);
    t.expect(trades[0]).toMatchObject({ market: SERIES, maker: MAKER, taker: ROUTER, trader: ALICE, takerBuys: false, size: 1_500_000n, quote: 660_495_000n });
  });

  it("records router hedges and buys once, from the router's events, not again from the fills", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            ...listing,
            { contract: "Series", event: "Minted", srcAddress: SERIES, block: block(5), transaction: tx(5), params: { account: ROUTER, units: 1_000_000n, collateralIn: 672_000_000n } },
            fill(5, ROUTER, false, 466_260_000_000_000_000_000n, 1_000_000n, 7),
            { contract: "HedgeRouter", event: "Hedged", block: block(5), transaction: tx(5), logIndex: 9, params: { account: ALICE, series: SERIES, units: 1_000_000n, collateralIn: 672_000_000n, proceeds: 466_260_000n } },
            fill(6, ROUTER, true, 480_470_000_000_000_000_000n, 208_129n, 3),
            { contract: "HedgeRouter", event: "LongBought", block: block(6), transaction: tx(6), logIndex: 5, params: { account: ALICE, book: BOOK, quoteIn: 100_000_000n, longOut: 208_129n } },
          ],
        },
      },
    });

    const activity = (await indexer.Activity.getAll()).sort((a, b) => a.timestamp - b.timestamp);
    t.expect(activity.map((a) => a.kind)).toEqual(["HEDGE", "BUY"]);
    t.expect(activity[0]).toMatchObject({ account: ALICE, market: SERIES, units: 1_000_000n, amountIn: 672_000_000n, amountOut: 466_260_000n });
    t.expect(activity[1]).toMatchObject({ account: ALICE, market: SERIES, amountIn: 100_000_000n, amountOut: 208_129n });
    t.expect((await indexer.Market.getOrThrow(SERIES)).pairsMinted).toBe(1_000_000n);
    // Totals: two fills, one hedge, one buy, one distinct trader (the router itself is never counted).
    t.expect(await indexer.Protocol.getOrThrow("rackrate")).toMatchObject({ tradeCount: 2, hedgeCount: 1, hedgedUnits: 1_000_000n, buyCount: 1, traderCount: 1, volumeQuote: 466_260_000n + 99_999_740n });
  });

  it("merges a direct wallet sell that fills against several orders into one SELL", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [...listing, fill(8, ALICE, false, 463_380_000_000_000_000_000n, 30_000n, 1), fill(8, ALICE, false, 451_620_000_000_000_000_000n, 10_600n, 2)],
        },
      },
    });
    const activity = await indexer.Activity.getAll();
    t.expect(activity).toHaveLength(1);
    t.expect(activity[0]).toMatchObject({ kind: "SELL", account: ALICE, units: 40_600n, amountOut: 13_901_400n + 4_787_172n });
    t.expect((await indexer.Market.getOrThrow(SERIES)).tradeCount).toBe(2);
    t.expect(await indexer.Protocol.getOrThrow("rackrate")).toMatchObject({ tradeCount: 2, traderCount: 1, hedgeCount: 0, buyCount: 0 });
  });

  it("tracks redemptions, settlement, claims and oracle prints", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        10143: {
          simulate: [
            ...listing,
            { contract: "Series", event: "Minted", srcAddress: SERIES, block: block(3), transaction: tx(3), params: { account: ALICE, units: 2_000_000n, collateralIn: 1_344_000_000n } },
            { contract: "Series", event: "PairRedeemed", srcAddress: SERIES, block: block(4), transaction: tx(4), params: { account: ALICE, units: 1_000_000n, collateralOut: 672_000_000n } },
            { contract: "RackOracle", event: "EpochFinalized", block: block(5), transaction: tx(7), params: { feedId: FEED, epoch: 377n, status: 1n, price: 3_400_000n, submissions: 3n } },
            { contract: "Series", event: "Settled", srcAddress: SERIES, block: block(6), transaction: tx(8), params: { kind: 1n, settlementPrice: 3_400_000n, printed: 168n, total: 168n } },
            { contract: "Series", event: "Claimed", srcAddress: SERIES, block: block(7), transaction: tx(9), params: { account: ALICE, longUnits: 1_000_000n, shortUnits: 1_000_000n, collateralOut: 672_000_000n } },
          ],
        },
      },
    });

    const market = await indexer.Market.getOrThrow(SERIES);
    t.expect(market).toMatchObject({ pairsMinted: 2_000_000n, pairsRedeemed: 1_000_000n, settled: true, settlementKind: 1, settlementPrice: 3_400_000n });
    const kinds = (await indexer.Activity.getAll()).sort((a, b) => a.timestamp - b.timestamp).map((a) => a.kind);
    t.expect(kinds).toEqual(["MINT", "REDEEM", "CLAIM"]);
    t.expect(await indexer.OraclePrint.getOrThrow(`${FEED}_377`)).toMatchObject({ status: 1, price: 3_400_000n, submissions: 3 });
  });
});
