// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fixed-price stand-in for a Kuru order book, mirroring the units observed on Kuru testnet:
///         sizes in sizePrecision units, market-buy budgets in pricePrecision units, settlement with the
///         caller's wallet, and fill-or-kill against available inventory.
contract MockKuruOrderBook {
    IERC20 public immutable base;
    IERC20 public immutable quote;
    uint32 public immutable pricePrecision;
    uint96 public immutable sizePrecision;
    uint256 public immutable baseDecimals;
    uint256 public immutable quoteDecimals;
    /// Raw quote paid per whole base token (10**baseDecimals raw units).
    uint256 public price;

    error InsufficientLiquidity();
    error SlippageExceeded();

    constructor(IERC20 base_, IERC20 quote_, uint32 pp, uint96 sp, uint256 bd, uint256 qd, uint256 price_) {
        base = base_;
        quote = quote_;
        pricePrecision = pp;
        sizePrecision = sp;
        baseDecimals = bd;
        quoteDecimals = qd;
        price = price_;
    }

    function placeAndExecuteMarketSell(uint96 size, uint256 minOut, bool, bool) external payable returns (uint256 out) {
        uint256 baseRaw = uint256(size) * 10 ** baseDecimals / sizePrecision;
        out = baseRaw * price / 10 ** baseDecimals;
        if (quote.balanceOf(address(this)) < out) revert InsufficientLiquidity();
        if (out < minOut) revert SlippageExceeded();
        base.transferFrom(msg.sender, address(this), baseRaw);
        quote.transfer(msg.sender, out);
    }

    function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minOut, bool, bool)
        external
        payable
        returns (uint256 out)
    {
        uint256 quoteRaw = uint256(quoteSize) * 10 ** quoteDecimals / pricePrecision;
        out = quoteRaw * 10 ** baseDecimals / price;
        if (base.balanceOf(address(this)) < out) revert InsufficientLiquidity();
        if (out < minOut) revert SlippageExceeded();
        quote.transferFrom(msg.sender, address(this), quoteRaw);
        base.transfer(msg.sender, out);
    }

    function getMarketParams()
        external
        view
        returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256)
    {
        return (
            pricePrecision, sizePrecision, address(base), baseDecimals, address(quote), quoteDecimals, 1, 1, 1e18, 0, 0
        );
    }
}
