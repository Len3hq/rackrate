/**
 * Kuru contract functions used by the bots, as human-readable ABI fragments (signatures from Kuru's public
 * docs/SDK; Kuru's ABI files are not vendored because the SDK repository has no license).
 */
import { parseAbi } from "viem";

export const kuruOrderBookAbi = parseAbi([
  "function batchUpdate(uint32[] buyPrices, uint96[] buySizes, uint32[] sellPrices, uint96[] sellSizes, uint40[] orderIdsToCancel, bool postOnly)",
  "function batchCancelOrders(uint40[] _orderIds)",
  "function s_orders(uint40) view returns (address owner, uint96 size, uint40 prev, uint40 next, uint40 flippedId, uint32 price, uint32 flippedPrice, bool isBuy)",
  "function bestBidAsk() view returns (uint256, uint256)",
  "event OrderCreated(uint40 orderId, address owner, uint96 size, uint32 price, bool isBuy)",
]);

export const kuruMarginAccountAbi = parseAbi([
  "function deposit(address _user, address _token, uint256 _amount) payable",
  "function withdraw(uint256 _amount, address _token)",
  "function getBalance(address _user, address _token) view returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
]);

/** Kuru reports best bid/ask with 1e18 precision; converts to dollars. */
export const kuruBookPriceToUsd = (p: bigint): number => Number(p) / 1e18;
/** Kuru order price units (1e4 precision) to dollars. */
export const kuruPriceToUsd = (p: number | bigint): number => Number(p) / 1e4;
