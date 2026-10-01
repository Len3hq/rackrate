// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OutcomeToken} from "./OutcomeToken.sol";
import {RackOracle} from "./RackOracle.sol";

/// @title Series
/// @notice One fully collateralized, cash-settled forward on a GPU rental index over a fixed window
///         of oracle epochs (e.g. one week of hourly epochs).
///
/// Units: LONG/SHORT have 6 decimals; 1e6 units cover 1 GPU for every epoch in the window.
/// Prices: USD per GPU-epoch with 6 decimals (rrUSD has 6 decimals).
///
///   mint(units)       deposit ceil(units * (cap - floor) * epochs / 1e6) -> units LONG + units SHORT
///   redeemPair(units) burn units LONG + SHORT before settlement -> floor(units * (cap - floor) * epochs / 1e6)
///   settle()          after the window: average of printed epochs, clamped to [floor, cap]
///   claim(l, s)       LONG pays (avg - floor) * epochs, SHORT pays (cap - avg) * epochs, per 1e6 units
///
/// Settlement validity (gap rule):
///   - coverage (printed / total epochs) >= minCoverageBps: settle on the printed average;
///   - otherwise wait until `settleGrace` after the window ends, then settle on whatever was printed;
///   - if nothing was printed at all, settle at the midpoint of [floor, cap] (both legs get half back).
/// Rounding always favours the contract, so it can never owe more than it holds.
contract Series is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant UNIT = 1e6;
    uint16 internal constant BPS = 10_000;

    enum SettlementKind {
        None,
        Full,
        Partial,
        NoData
    }

    RackOracle public immutable oracle;
    IERC20 public immutable collateral;
    OutcomeToken public immutable long;
    OutcomeToken public immutable short;

    bytes32 public immutable feedId;
    uint64 public immutable startEpoch;
    uint64 public immutable endEpoch; // inclusive
    uint64 public immutable floor;
    uint64 public immutable cap;
    uint16 public immutable minCoverageBps;
    uint32 public immutable settleGrace;
    bool public immutable isDemo;

    bool public settled;
    SettlementKind public settlementKind;
    uint64 public settlementPrice;
    uint256 public longPayoutPerUnit;
    uint256 public shortPayoutPerUnit;

    event Minted(address indexed account, uint256 units, uint256 collateralIn);
    event PairRedeemed(address indexed account, uint256 units, uint256 collateralOut);
    event Settled(SettlementKind kind, uint64 settlementPrice, uint256 printed, uint256 total);
    event Claimed(address indexed account, uint256 longUnits, uint256 shortUnits, uint256 collateralOut);

    error InvalidParams();
    error ZeroAmount();
    error AlreadySettled();
    error NotSettled();
    error WindowNotEnded();
    error OracleNotFinalized();
    error CoverageTooLow(uint256 printed, uint256 total, uint256 retryAt);

    struct Params {
        RackOracle oracle;
        IERC20 collateral;
        bytes32 feedId;
        uint64 startEpoch;
        uint64 endEpoch;
        uint64 floor;
        uint64 cap;
        uint16 minCoverageBps;
        uint32 settleGrace;
        bool isDemo;
        string longName;
        string longSymbol;
        string shortName;
        string shortSymbol;
    }

    constructor(Params memory p) {
        if (p.endEpoch < p.startEpoch || p.cap <= p.floor || p.minCoverageBps > BPS) revert InvalidParams();
        oracle = p.oracle;
        collateral = p.collateral;
        feedId = p.feedId;
        startEpoch = p.startEpoch;
        endEpoch = p.endEpoch;
        floor = p.floor;
        cap = p.cap;
        minCoverageBps = p.minCoverageBps;
        settleGrace = p.settleGrace;
        isDemo = p.isDemo;
        long = new OutcomeToken(p.longName, p.longSymbol);
        short = new OutcomeToken(p.shortName, p.shortSymbol);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function epochCount() public view returns (uint256) {
        return uint256(endEpoch - startEpoch) + 1;
    }

    /// @notice Collateral backing 1e6 units (one GPU for the full window).
    function collateralPerUnit() public view returns (uint256) {
        return uint256(cap - floor) * epochCount();
    }

    function collateralForMint(uint256 units) public view returns (uint256) {
        return _mulDivUp(units, collateralPerUnit(), UNIT);
    }

    /// @notice Timestamp after which the window has ended and settlement may be attempted.
    function windowEnd() public view returns (uint256) {
        return oracle.epochStart(feedId, endEpoch + 1);
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    function mint(uint256 units) external nonReentrant returns (uint256 collateralIn) {
        return _mint(msg.sender, units);
    }

    /// @notice Mint on behalf of `to`, paid by the caller. Used by routers.
    function mintTo(address to, uint256 units) external nonReentrant returns (uint256 collateralIn) {
        return _mint(to, units);
    }

    function redeemPair(uint256 units) external nonReentrant returns (uint256 collateralOut) {
        if (units == 0) revert ZeroAmount();
        if (settled) revert AlreadySettled();
        long.burn(msg.sender, units);
        short.burn(msg.sender, units);
        collateralOut = units * collateralPerUnit() / UNIT;
        collateral.safeTransfer(msg.sender, collateralOut);
        emit PairRedeemed(msg.sender, units, collateralOut);
    }

    function settle() external {
        if (settled) revert AlreadySettled();
        uint256 end = windowEnd();
        if (block.timestamp < end) revert WindowNotEnded();
        if (oracle.getFeed(feedId).nextEpoch <= endEpoch) revert OracleNotFinalized();

        (uint256 sum, uint256 printed, uint256 total) = oracle.windowStats(feedId, startEpoch, endEpoch);

        SettlementKind kind;
        uint256 avg;
        if (printed * BPS >= total * minCoverageBps && printed > 0) {
            kind = SettlementKind.Full;
            avg = sum / printed;
        } else if (block.timestamp < end + settleGrace) {
            revert CoverageTooLow(printed, total, end + settleGrace);
        } else if (printed > 0) {
            kind = SettlementKind.Partial;
            avg = sum / printed;
        } else {
            kind = SettlementKind.NoData;
            avg = (uint256(floor) + cap) / 2;
        }

        if (avg < floor) avg = floor;
        if (avg > cap) avg = cap;

        uint256 epochs = epochCount();
        settled = true;
        settlementKind = kind;
        settlementPrice = uint64(avg);
        longPayoutPerUnit = (avg - floor) * epochs;
        shortPayoutPerUnit = (cap - avg) * epochs;
        emit Settled(kind, uint64(avg), printed, total);
    }

    function claim(uint256 longUnits, uint256 shortUnits) external nonReentrant returns (uint256 collateralOut) {
        if (!settled) revert NotSettled();
        if (longUnits == 0 && shortUnits == 0) revert ZeroAmount();
        if (longUnits > 0) long.burn(msg.sender, longUnits);
        if (shortUnits > 0) short.burn(msg.sender, shortUnits);
        collateralOut = longUnits * longPayoutPerUnit / UNIT + shortUnits * shortPayoutPerUnit / UNIT;
        if (collateralOut > 0) collateral.safeTransfer(msg.sender, collateralOut);
        emit Claimed(msg.sender, longUnits, shortUnits, collateralOut);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _mint(address to, uint256 units) internal returns (uint256 collateralIn) {
        if (units == 0) revert ZeroAmount();
        if (settled) revert AlreadySettled();
        collateralIn = collateralForMint(units);
        collateral.safeTransferFrom(msg.sender, address(this), collateralIn);
        long.mint(to, units);
        short.mint(to, units);
        emit Minted(to, units, collateralIn);
    }

    function _mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        uint256 prod = a * b;
        return prod == 0 ? 0 : (prod - 1) / d + 1;
    }
}
