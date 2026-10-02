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
