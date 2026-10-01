// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RackOracle} from "./RackOracle.sol";
import {Series} from "./Series.sol";

/// @title SeriesFactory
/// @notice Creates Rackrate series against one oracle and one collateral token.
///
/// Admin powers (owner, run by the keeper): create series. Each series' parameters are immutable
/// once created, and a feed's real (non-demo) series windows cannot be created twice.
contract SeriesFactory is Ownable2Step {
    RackOracle public immutable oracle;
    IERC20 public immutable collateral;

    address[] public allSeries;
    mapping(bytes32 feedId => mapping(uint64 startEpoch => address)) public seriesByStart;

    struct CreateParams {
        bytes32 feedId;
        uint64 startEpoch;
        uint64 endEpoch;
        uint64 floor;
        uint64 cap;
        uint16 minCoverageBps;
        uint32 settleGrace;
        string label; // e.g. "H100 2026-W42"
        string symbolStem; // e.g. "H100W42"
    }

    event SeriesCreated(
        address indexed series,
        bytes32 indexed feedId,
        uint64 startEpoch,
        uint64 endEpoch,
        uint64 floor,
        uint64 cap,
        bool isDemo,
        address long,
        address short
    );

    error UnknownFeed();
    error StartBeforeFeed();
    error SeriesExists();

    constructor(address initialOwner, RackOracle oracle_, IERC20 collateral_) Ownable(initialOwner) {
        oracle = oracle_;
        collateral = collateral_;
    }

    function createSeries(CreateParams calldata p) external onlyOwner returns (address series) {
        RackOracle.Feed memory feed = oracle.getFeed(p.feedId);
        if (!feed.exists) revert UnknownFeed();
        if (p.startEpoch < feed.firstEpoch) revert StartBeforeFeed();
        if (!feed.isDemo && seriesByStart[p.feedId][p.startEpoch] != address(0)) revert SeriesExists();

        Series s = new Series(
            Series.Params({
                oracle: oracle,
                collateral: collateral,
                feedId: p.feedId,
                startEpoch: p.startEpoch,
                endEpoch: p.endEpoch,
                floor: p.floor,
                cap: p.cap,
                minCoverageBps: p.minCoverageBps,
                settleGrace: p.settleGrace,
                isDemo: feed.isDemo,
                longName: string.concat("Rackrate ", p.label, " LONG"),
                longSymbol: string.concat("rr", p.symbolStem, "L"),
                shortName: string.concat("Rackrate ", p.label, " SHORT"),
                shortSymbol: string.concat("rr", p.symbolStem, "S")
            })
        );
        series = address(s);
        allSeries.push(series);
        seriesByStart[p.feedId][p.startEpoch] = series;
        emit SeriesCreated(
            series, p.feedId, p.startEpoch, p.endEpoch, p.floor, p.cap, feed.isDemo, address(s.long()), address(s.short())
        );
    }

    function seriesCount() external view returns (uint256) {
        return allSeries.length;
    }
}
