/**
 * Rackrate event handlers. Builds markets with live trading statistics, every fill on the weekly Kuru books,
 * a per-wallet activity history, and the finalized oracle hours. Addresses are lowercase (config.yaml).
 */
import { type EvmOnEventContext, indexer } from "envio";

/** The deployed HedgeRouter: fills it takes are already recorded as HEDGE / BUY activity from its own events. */
const HEDGE_ROUTER = "0xe5eb6018cedc90204a7b27ff5df083dfa781226c";

const fields = { transaction: ["hash"], block: ["timestamp"] } as const;
const PROTOCOL_ID = "rackrate";

type Ctx = EvmOnEventContext;

/** Applies a change to the protocol totals, creating the row on first use. */
async function bumpProtocol(
  context: Ctx,
  change: Partial<{ tradeCount: number; volumeQuote: bigint; hedgeCount: number; hedgedUnits: bigint; buyCount: number; traderCount: number }>,
) {
  const p = (await context.Protocol.get(PROTOCOL_ID)) ?? {
    id: PROTOCOL_ID,
    tradeCount: 0,
    volumeQuote: 0n,
    hedgeCount: 0,
    hedgedUnits: 0n,
    buyCount: 0,
    traderCount: 0,
  };
  context.Protocol.set({
    ...p,
    tradeCount: p.tradeCount + (change.tradeCount ?? 0),
    volumeQuote: p.volumeQuote + (change.volumeQuote ?? 0n),
    hedgeCount: p.hedgeCount + (change.hedgeCount ?? 0),
    hedgedUnits: p.hedgedUnits + (change.hedgedUnits ?? 0n),
    buyCount: p.buyCount + (change.buyCount ?? 0),
    traderCount: p.traderCount + (change.traderCount ?? 0),
  });
}

/** Counts a wallet once, the first time it hedges, buys or sells. Returns 1 for a new trader. */
async function seeTrader(context: Ctx, account: string, timestamp: number): Promise<number> {
  if (await context.Trader.get(account)) return 0;
  context.Trader.set({ id: account, firstSeen: timestamp });
  return 1;
}
const eventId = (hash: string, logIndex: number) => `${hash}_${logIndex}`;

// ---------------------------------------------------------------------------------------------------------------
// Discovery: each new series, and each series' Kuru book, is indexed from the block it appears in.
// ---------------------------------------------------------------------------------------------------------------

indexer.contractRegister({ contract: "SeriesFactory", event: "SeriesCreated" }, async ({ event, context }) => {
  context.chain.Series.add(event.params.series);
});

indexer.contractRegister({ contract: "MarketRegistry", event: "MarketCreated" }, async ({ event, context }) => {
  context.chain.KuruBook.add(event.params.book);
});

indexer.onEvent({ contract: "SeriesFactory", event: "SeriesCreated", fields }, async ({ event, context }) => {
  const p = event.params;
  context.Market.set({
    id: p.series,
    feedId: p.feedId,
    startEpoch: p.startEpoch,
    endEpoch: p.endEpoch,
    floor: p.floor,
    cap: p.cap,
    isDemo: p.isDemo,
    long: p.long,
    short: p.short,
    book: undefined,
    pairsMinted: 0n,
    pairsRedeemed: 0n,
    tradeCount: 0,
    volumeLong: 0n,
    volumeQuote: 0n,
    lastPrice: undefined,
    settled: false,
    settlementKind: undefined,
    settlementPrice: undefined,
    createdAt: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "MarketRegistry", event: "MarketCreated" }, async ({ event, context }) => {
  const market = await context.Market.get(event.params.series);
  if (market) context.Market.set({ ...market, book: event.params.book });
  context.Book.set({ id: event.params.book, market: event.params.series });
});

// ---------------------------------------------------------------------------------------------------------------
// Series lifecycle
// ---------------------------------------------------------------------------------------------------------------

indexer.onEvent({ contract: "Series", event: "Minted", fields }, async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress);
  if (market) context.Market.set({ ...market, pairsMinted: market.pairsMinted + event.params.units });
  // Router mints are part of a HEDGE (recorded from Hedged); direct mints are the wallet's own.
  if (event.params.account === HEDGE_ROUTER) return;
  context.Activity.set({
    id: eventId(event.transaction.hash, event.logIndex),
    account: event.params.account,
    market: event.srcAddress,
    kind: "MINT",
    units: event.params.units,
    amountIn: event.params.collateralIn,
    amountOut: 0n,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

indexer.onEvent({ contract: "Series", event: "PairRedeemed", fields }, async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress);
  if (market) context.Market.set({ ...market, pairsRedeemed: market.pairsRedeemed + event.params.units });
  context.Activity.set({
    id: eventId(event.transaction.hash, event.logIndex),
    account: event.params.account,
    market: event.srcAddress,
    kind: "REDEEM",
    units: event.params.units,
    amountIn: 0n,
    amountOut: event.params.collateralOut,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

indexer.onEvent({ contract: "Series", event: "Settled" }, async ({ event, context }) => {
  const market = await context.Market.get(event.srcAddress);
  if (!market) return;
  context.Market.set({
    ...market,
    settled: true,
    settlementKind: Number(event.params.kind),
    settlementPrice: event.params.settlementPrice,
  });
});

indexer.onEvent({ contract: "Series", event: "Claimed", fields }, async ({ event, context }) => {
  context.Activity.set({
    id: eventId(event.transaction.hash, event.logIndex),
    account: event.params.account,
    market: event.srcAddress,
    kind: "CLAIM",
    units: event.params.longUnits + event.params.shortUnits,
    amountIn: 0n,
    amountOut: event.params.collateralOut,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------------------------------------------

indexer.onEvent({ contract: "HedgeRouter", event: "Hedged", fields }, async ({ event, context }) => {
  context.Activity.set({
    id: eventId(event.transaction.hash, event.logIndex),
    account: event.params.account,
    market: event.params.series,
    kind: "HEDGE",
    units: event.params.units,
    amountIn: event.params.collateralIn,
    amountOut: event.params.proceeds,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  const newTrader = await seeTrader(context, event.params.account, event.block.timestamp);
  await bumpProtocol(context, { hedgeCount: 1, hedgedUnits: event.params.units, traderCount: newTrader });
});

indexer.onEvent({ contract: "HedgeRouter", event: "LongBought", fields }, async ({ event, context }) => {
  const book = await context.Book.get(event.params.book);
  context.Activity.set({
    id: eventId(event.transaction.hash, event.logIndex),
    account: event.params.account,
    market: book?.market ?? event.params.book,
    kind: "BUY",
    units: event.params.longOut,
    amountIn: event.params.quoteIn,
    amountOut: event.params.longOut,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  });
  const newTrader = await seeTrader(context, event.params.account, event.block.timestamp);
  await bumpProtocol(context, { buyCount: 1, traderCount: newTrader });
});

/** Kuru prices are rrUSD per LONG with 18 decimals; sizes are LONG units with 6 decimals. */
const quoteOf = (price: bigint, size: bigint) => (price * size) / 10n ** 18n;

indexer.onEvent({ contract: "KuruBook", event: "Trade", fields }, async ({ event, context }) => {
  const p = event.params;
  const book = await context.Book.get(event.srcAddress);
  const marketId = book?.market ?? event.srcAddress;
  const id = eventId(event.transaction.hash, event.logIndex);
  const quote = quoteOf(p.price, p.filledSize);

  context.Trade.set({
    id,
    market: marketId,
    book: event.srcAddress,
    orderId: p.orderId,
    maker: p.makerAddress,
    taker: p.takerAddress,
    trader: p.txOrigin,
    takerBuys: p.isBuy,
    price: p.price,
    size: p.filledSize,
    quote,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    txHash: event.transaction.hash,
  });

  await bumpProtocol(context, {
    tradeCount: 1,
    volumeQuote: quote,
    traderCount: p.takerAddress !== HEDGE_ROUTER ? await seeTrader(context, p.txOrigin, event.block.timestamp) : 0,
  });

  const market = await context.Market.get(marketId);
  if (market) {
    context.Market.set({
      ...market,
      tradeCount: market.tradeCount + 1,
      volumeLong: market.volumeLong + p.filledSize,
      volumeQuote: market.volumeQuote + quote,
      lastPrice: p.price,
    });
  }

  // A wallet trading on the book directly (e.g. closing a position by selling LONG) has no router event. One
  // market order can fill against several resting orders, so its fills are merged into one activity row.
  if (p.takerAddress !== HEDGE_ROUTER) {
    const activityId = `${event.transaction.hash}_${marketId}_${p.isBuy ? "buy" : "sell"}`;
    const prev = await context.Activity.get(activityId);
    context.Activity.set({
      id: activityId,
      account: p.txOrigin,
      market: marketId,
      kind: p.isBuy ? "BUY" : "SELL",
      units: (prev?.units ?? 0n) + p.filledSize,
      amountIn: (prev?.amountIn ?? 0n) + (p.isBuy ? quote : 0n),
      amountOut: (prev?.amountOut ?? 0n) + (p.isBuy ? p.filledSize : quote),
      timestamp: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------------------------------------------

indexer.onEvent({ contract: "RackOracle", event: "EpochFinalized", fields }, async ({ event, context }) => {
  const p = event.params;
  context.OraclePrint.set({
    id: `${p.feedId}_${p.epoch}`,
    feedId: p.feedId,
    epoch: p.epoch,
    status: Number(p.status),
    price: p.price,
    submissions: Number(p.submissions),
    timestamp: event.block.timestamp,
  });
});
