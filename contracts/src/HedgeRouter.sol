// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Series} from "./Series.sol";
import {IKuruOrderBook} from "./interfaces/IKuru.sol";

/// @title HedgeRouter
/// @notice One-transaction hedges across several weekly series, trading on Kuru's onchain order books.
///
///   hedge     (GPU owner, locks revenue): for each week, deposit collateral, mint LONG + SHORT, keep SHORT and
///             market-sell LONG on that week's Kuru book. Net cost = collateral - proceeds.
///   buyLongs  (AI startup, locks cost): for each week, spend an exact quote budget buying LONG on its Kuru book.
///
/// Every leg is fill-or-kill with a caller-set minimum, so a ladder either executes completely at acceptable
/// prices or reverts as a whole. The router is stateless and ownerless; it never holds funds between transactions.
contract HedgeRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateral;

    struct HedgeLeg {
        Series series;
        IKuruOrderBook book; // LONG/collateral market for this series
        uint256 units; // 1e6 = 1 GPU for the whole series window
        uint256 minProceeds; // minimum collateral received for the LONG (slippage guard)
    }

    struct BuyLeg {
        IKuruOrderBook book; // LONG/collateral market
        uint256 quoteIn; // exact collateral to spend (collateral decimals)
        uint256 minLongOut; // minimum LONG received (slippage guard)
    }

    event Hedged(
        address indexed account, address indexed series, uint256 units, uint256 collateralIn, uint256 proceeds
    );
    event LongBought(address indexed account, address indexed book, uint256 quoteIn, uint256 longOut);

    error EmptyLegs();
    error ZeroAmount();
    error MarketMismatch();
    error InexactAmount();

    constructor(IERC20 collateral_) {
        collateral = collateral_;
    }

    /// @return totalIn collateral pulled from the caller
    /// @return totalProceeds collateral returned to the caller from selling LONG
    function hedge(HedgeLeg[] calldata legs) external nonReentrant returns (uint256 totalIn, uint256 totalProceeds) {
        if (legs.length == 0) revert EmptyLegs();
        for (uint256 i; i < legs.length; ++i) {
            (uint256 cost, uint256 proceeds) = _hedgeLeg(legs[i]);
            totalIn += cost;
            totalProceeds += proceeds;
        }
        if (totalProceeds > 0) collateral.safeTransfer(msg.sender, totalProceeds);
    }

    /// @return totalLong total LONG units delivered to the caller (across all legs)
    function buyLongs(BuyLeg[] calldata legs) external nonReentrant returns (uint256 totalLong) {
        if (legs.length == 0) revert EmptyLegs();
        for (uint256 i; i < legs.length; ++i) {
            totalLong += _buyLeg(legs[i]);
        }
    }

    function _hedgeLeg(HedgeLeg calldata leg) internal returns (uint256 cost, uint256 proceeds) {
        if (leg.units == 0) revert ZeroAmount();
        Series s = leg.series;
        IERC20 longToken = IERC20(address(s.long()));
        if (address(s.collateral()) != address(collateral)) revert MarketMismatch();
        (, uint96 sizePrecision, address base, uint256 baseDecimals, address quote,,,,,,) = leg.book.getMarketParams();
        if (base != address(longToken) || quote != address(collateral)) revert MarketMismatch();

        cost = s.collateralForMint(leg.units);
        collateral.safeTransferFrom(msg.sender, address(this), cost);
        collateral.forceApprove(address(s), cost);
        s.mintTo(address(this), leg.units);

        IERC20(address(s.short())).safeTransfer(msg.sender, leg.units);

        uint96 size = _toSize(leg.units, sizePrecision, baseDecimals);
        longToken.forceApprove(address(leg.book), leg.units);
        proceeds = leg.book.placeAndExecuteMarketSell(size, leg.minProceeds, false, true);

        emit Hedged(msg.sender, address(s), leg.units, cost, proceeds);
    }

    function _buyLeg(BuyLeg calldata leg) internal returns (uint256 longOut) {
        if (leg.quoteIn == 0) revert ZeroAmount();
        (uint32 pricePrecision,, address base,, address quote, uint256 quoteDecimals,,,,,) =
            leg.book.getMarketParams();
        if (quote != address(collateral)) revert MarketMismatch();

        // Kuru takes the market-buy budget in price-precision units, not raw token units.
        uint256 scaled = leg.quoteIn * pricePrecision;
        uint256 unit = 10 ** quoteDecimals;
        if (scaled % unit != 0) revert InexactAmount();
        uint96 quoteSize = uint96(scaled / unit);

        collateral.safeTransferFrom(msg.sender, address(this), leg.quoteIn);
        collateral.forceApprove(address(leg.book), leg.quoteIn);
        longOut = leg.book.placeAndExecuteMarketBuy(quoteSize, leg.minLongOut, false, true);
        IERC20(base).safeTransfer(msg.sender, longOut);

        emit LongBought(msg.sender, address(leg.book), leg.quoteIn, longOut);
    }

    /// @dev Converts raw token units to Kuru size units; reverts unless exact.
    function _toSize(uint256 units, uint96 sizePrecision, uint256 baseDecimals) internal pure returns (uint96) {
        uint256 scaled = units * sizePrecision;
        uint256 unit = 10 ** baseDecimals;
        if (scaled % unit != 0) revert InexactAmount();
        return uint96(scaled / unit);
    }
}
