import { parseAbi } from "viem";

/** The Kuru order book functions the app reads (signatures from Kuru's public docs; ABIs are not vendored). */
export const kuruBookAbi = parseAbi([
  "function bestBidAsk() view returns (uint256, uint256)",
  "event Trade(uint40 orderId, address makerAddress, bool isBuy, uint256 price, uint96 updatedSize, address takerAddress, address txOrigin, uint96 filledSize)",
]);

/**
 * Kuru reports prices with 1e18 precision. An empty side comes back as 0 (no ask) or max uint (no bid), so
 * anything outside a sane range is treated as "no quote".
 */
export function bookPrice(raw: bigint): number | null {
  if (raw === 0n || raw > 10n ** 30n) return null;
  return Number(raw) / 1e18;
}

/** Wallet-direct market orders (`_isMargin = false`): the book pulls tokens from and pays the caller. */
export const kuruTradeAbi = parseAbi([
  "function placeAndExecuteMarketSell(uint96 _size, uint256 _minAmountOut, bool _isMargin, bool _isFillOrKill) payable returns (uint256)",
]);

/** Kuru's minimum order size on Rackrate books: 0.01 of a token (MarketRegistry MIN_SIZE). */
export const MIN_SIZE = 10_000n;

export const kuruDepthAbi = parseAbi(["function getL2Book() view returns (bytes)"]);

export interface Level {
  price: number; // $ per LONG
  size: number; // LONG
}

/**
 * Decodes Kuru's `getL2Book()`: a block number, then (price, size) words for each bid level (best first), a zero
 * word, then the ask levels (best first). Prices use the book's 1e4 precision and sizes its 1e6 precision.
 */
export function decodeL2(data: `0x${string}`): { bids: Level[]; asks: Level[] } {
  const words: bigint[] = [];
  for (let i = 2; i + 64 <= data.length; i += 64) words.push(BigInt(`0x${data.slice(i, i + 64)}`));
  const bids: Level[] = [];
  const asks: Level[] = [];
  let side = bids;
  for (let i = 1; i < words.length; ) {
    if (words[i] === 0n && side === bids) {
      side = asks;
      i += 1;
      continue;
    }
    if (i + 1 >= words.length) break;
    side.push({ price: Number(words[i]) / 1e4, size: Number(words[i + 1]) / 1e6 });
    i += 2;
  }
  return { bids, asks };
}
